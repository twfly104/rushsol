"use client";

import { useEffect, useRef, useState } from "react";
import {
  generateServerSeed,
  hashSeed,
  crash,
  type CrashResult,
} from "@/lib/provablyFair";
import { useMockBalance } from "@/components/MockBalanceProvider";
import { logRound } from "@/lib/roundLog";
import { audit } from "@/lib/clientAudit";

const HOUSE_EDGE_BPS = 400; // 4%
const TICK_MS = 100;

// ─── Round pacing ─────────────────────────────────────────────────────────
//
// Crash multiplier grows exponentially. m(t) = 1.05^(t*k).
//
// Solve 2x = 1.05^(10 * k): k = log(2) / (10 * log(1.05)) ≈ 1.42
//
// → 1.5x crash lands at ~5.8s
// → 2x   crash lands at ~10s   (target median)
// → 5x   crash lands at ~22.6s
// → 10x  crash lands at ~33s
//
const GROWTH_PER_SEC = Math.log(2) / 10 / Math.log(1.05);
const MULT_PER_TICK = Math.pow(1.05, (TICK_MS / 1000) * GROWTH_PER_SEC);

interface RoundInfo {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  clientSeedHash: string;
  nonce: number;
  crashPoint: number;
}

// Live position state for a round the player is in. Persisted across the
// chart so partial cash-outs are visualized.
interface PositionState {
  bet: number;          // original bet
  remaining: number;    // amount still riding in the round
  cashedOutSoFar: number; // sum of all prior partial cash-outs
  partials: { t: number; m: number; payout: number }[]; // markers on chart
}

export default function CrashPage() {
  const { balance, credit, debit } = useMockBalance();
  const [bet, setBet] = useState(0.1);
  const [cashoutPct, setCashoutPct] = useState(100); // 0-100 slider

  const [phase, setPhase] = useState<"idle" | "running" | "crashed">("idle");
  const [multiplier, setMultiplier] = useState(1.0);
  const [elapsed, setElapsed] = useState(0);
  const [crashPoint, setCrashPoint] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [error, setError] = useState<string>("");
  const [position, setPosition] = useState<PositionState | null>(null);

  const chartRef = useRef<HTMLDivElement | null>(null);
  const pointsRef = useRef<{ t: number; m: number }[]>([{ t: 0, m: 1 }]);
  const startedAtRef = useRef<number>(0);
  const multRef = useRef(1);
  const positionRef = useRef<PositionState | null>(null);

  // Keep ref in sync with state for use inside the interval closure.
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Resolve position when round crashes (no more cash-outs possible)
  useEffect(() => {
    if (phase !== "crashed") return;
    setPosition((p) => {
      if (!p) return null;
      // Remaining bet is lost - mark remaining as 0
      return { ...p, remaining: 0 };
    });
  }, [phase]);

  // Animation loop — driven entirely by `Date.now()` so a single setInterval
  // tick can never get the game stuck in an inconsistent phase. The interval
  // is created when phase becomes "running" and is cleared via the cleanup
  // function when phase leaves "running" OR when crashPoint changes.
  useEffect(() => {
    if (phase !== "running" || crashPoint === null) return;

    const id = setInterval(() => {
      const t = (Date.now() - startedAtRef.current) / 1000;
      const next = multRef.current * MULT_PER_TICK;

      // Crash check first — if we've blown past the crash point, settle.
      if (next >= crashPoint) {
        clearInterval(id); // Immediately clear interval to prevent stuck state
        multRef.current = crashPoint;
        setMultiplier(crashPoint);
        setElapsed(t);
        pointsRef.current.push({ t, m: crashPoint });
        // Round ends by crash — emit one round-log + audit entry. Partial
        // cash-outs already credited the player, so payout here = cashed
        // out so far; the remainder is implicitly lost.
        const r = round;
        if (r) {
          const pos = positionRef.current;
          const payout = pos?.cashedOutSoFar ?? 0;
          logRound({
            game: "crash",
            crashPoint: r.crashPoint,
            serverSeed: r.serverSeed,
            serverSeedHash: r.serverSeedHash,
            clientSeed: r.clientSeed,
            clientSeedHash: r.clientSeedHash,
            nonce: r.nonce,
            betAmount: pos?.bet ?? bet,
            payout,
            resolvedAt: Date.now(),
          });
          audit({
            action: "BET_RESOLVED",
            payload: {
              game: "crash",
              nonce: r.nonce,
              outcome: "crashed",
              crashPoint: r.crashPoint,
              payout,
            },
          });
        }
        setPhase("crashed");
        setHistory((h) => [crashPoint, ...h].slice(0, 12));
        // Position will be resolved by the phase change effect
        return;
      }

      multRef.current = next;
      setMultiplier(next);
      setElapsed(t);
      pointsRef.current.push({ t, m: next });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [phase, crashPoint, round, bet]);

  async function startRound() {
    setError("");
    if (phase === "running") return;
    if (bet <= 0) return setError("Bet must be > 0");
    if (bet > balance) return setError("Insufficient mock balance");
    if (!debit(bet)) return setError("Insufficient mock balance");

    audit({
      action: "BET_PLACED",
      payload: { game: "crash", betAmount: bet },
    });

    const serverSeed = generateServerSeed();
    const serverSeedHash = await hashSeed(serverSeed);
    const clientSeed = crypto.randomUUID();
    const clientSeedHash = await hashSeed(clientSeed);
    const nonce = history.length;
    const r: CrashResult = await crash(serverSeed, clientSeed, nonce, {
      houseEdgeBps: HOUSE_EDGE_BPS,
      maxMultiplier: 1000,
    });

    setRound({
      serverSeed,
      serverSeedHash,
      clientSeed,
      clientSeedHash,
      nonce,
      crashPoint: r.crashPoint,
    });
    setCrashPoint(r.crashPoint);
    pointsRef.current = [{ t: 0, m: 1 }];
    startedAtRef.current = Date.now();
    multRef.current = 1;
    setMultiplier(1.0);
    setElapsed(0);
    const newPos: PositionState = {
      bet,
      remaining: bet,
      cashedOutSoFar: 0,
      partials: [],
    };
    setPosition(newPos);
    setPhase("running");
  }

  /**
   * Cash out `pct`% of the position at the current multiplier.
   * - 100% = full cash out (ends the round)
   * - < 100% = partial cash out, leaves the rest riding
   */
  function cashOut(pct: number = 100) {
    if (phase !== "running") return;
    const pos = positionRef.current;
    if (!pos || pos.remaining <= 0) return;

    const fraction = Math.min(1, Math.max(0, pct / 100));
    const slice = pos.remaining * fraction;
    const payout = slice * multRef.current;
    const t = (Date.now() - startedAtRef.current) / 1000;
    const at = multRef.current;

    credit(payout);

    const newRemaining = pos.remaining - slice;
    const newCashedSoFar = pos.cashedOutSoFar + payout;
    const newPartials = [...pos.partials, { t, m: at, payout }];

    const newPos: PositionState = {
      bet: pos.bet,
      remaining: newRemaining,
      cashedOutSoFar: newCashedSoFar,
      partials: newPartials,
    };
    setPosition(newPos);

    if (fraction >= 0.999 || newRemaining < 0.0001) {
      // Full exit — round ends with a successful cash-out.
      const r = round;
      const payout = newCashedSoFar;
      if (r) {
        logRound({
          game: "crash",
          crashPoint: r.crashPoint,
          serverSeed: r.serverSeed,
          serverSeedHash: r.serverSeedHash,
          clientSeed: r.clientSeed,
          clientSeedHash: r.clientSeedHash,
          nonce: r.nonce,
          betAmount: newPos.bet,
          payout,
          resolvedAt: Date.now(),
        });
        audit({
          action: "BET_RESOLVED",
          payload: {
            game: "crash",
            nonce: r.nonce,
            outcome: "cashed_out",
            crashPoint: r.crashPoint,
            payout,
          },
        });
      }
      setPhase("idle");
    }
  }

  function newRound() {
    setMultiplier(1.0);
    setElapsed(0);
    setCrashPoint(null);
    setPosition(null);
    setPhase("idle");
    pointsRef.current = [{ t: 0, m: 1 }];
  }

  // Derived: realized + unrealized PNL for the live round.
  const livePnl = (() => {
    if (!position) return 0;
    const unrealized = (multiplier - 1) * position.remaining;
    return position.cashedOutSoFar - (position.bet - position.remaining) + unrealized;
  })();

  // Final realized PNL once round settles (no position left).
  const finalPnl = position ? position.cashedOutSoFar - position.bet : 0;

  // X-axis range. Use the larger of (a) the predicted crash time, (b) the
  // current elapsed time + small headroom. This way labels grow dynamically
  // when the round runs long.
  const predictedCrashT =
    crashPoint !== null
      ? Math.log(crashPoint) / (GROWTH_PER_SEC * Math.log(1.05))
      : 0;
  const xMax = Math.max(predictedCrashT + 2, elapsed + 2, 10);

  // Choose x-step so we show ~6-10 labels.
  const xStep = xMax > 30 ? 5 : xMax > 15 ? 2 : 1;

  // Build the list of x ticks but only show those that are visible (≤ xMax).
  const xTicks: number[] = [];
  for (let t = 0; t <= xMax + 0.001; t += xStep) {
    xTicks.push(parseFloat(t.toFixed(2)));
  }

  // Y-axis labels adapt to the max multiplier shown.
  const yMax = Math.max(multiplier * 1.5, crashPoint ? crashPoint * 1.1 : 10, 10);
  const yTicks = [1, 2, 5, 10, 20].filter((v) => v <= yMax + 0.01);

  // Current chart mark position for the live "YOU" marker.
  const liveCashOutMarker = position?.partials[position.partials.length - 1] ?? null;

  return (
    <div className="space-y-4 animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="chip chip-warning">4% edge</span>
            <span className="chip chip-muted">~10s median round</span>
          </div>
          <h1 className="font-display text-3xl font-bold">Crash</h1>
        </div>
        {history.length > 0 && <PastRounds values={history} />}
      </header>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* CHART + CONTROLS */}
        <div className="space-y-4">
          <div className="panel overflow-hidden">
            <div
              ref={chartRef}
              className="relative w-full h-[380px]"
              style={{
                background:
                  phase === "crashed"
                    ? "linear-gradient(180deg, color-mix(in srgb, var(--danger) 20%, var(--surface)) 0%, var(--surface) 60%)"
                    : phase === "running"
                    ? "linear-gradient(180deg, color-mix(in srgb, var(--accent) 10%, var(--surface)) 0%, var(--surface) 70%)"
                    : "var(--surface)",
                transition: "background 0.3s",
              }}
            >
              {/* Starfield */}
              <div className="starfield" />

              {/* Grid lines + axis labels */}
              <GridAndAxis
                multiplier={multiplier}
                yMax={yMax}
                xMax={xMax}
                xTicks={xTicks}
                yTicks={yTicks}
              />

              {/* Visible curve */}
              <CurvePath
                points={pointsRef.current}
                xMax={xMax}
                yMax={yMax}
                phase={phase}
              />

              {/* Crash target line */}
              {crashPoint !== null && phase === "running" && (
                <CrashTargetLine
                  multiplier={multiplier}
                  crashPoint={crashPoint}
                  xMax={xMax}
                  yMax={yMax}
                />
              )}

              {/* Rocket */}
              {phase === "running" && (
                <Rocket
                  points={pointsRef.current}
                  xMax={xMax}
                  yMax={yMax}
                />
              )}

              {/* YOUR partial cash-out markers */}
              {position?.partials.map((p, i) => (
                <CashoutMarker
                  key={i}
                  t={p.t}
                  m={p.m}
                  xMax={xMax}
                  yMax={yMax}
                  label={`+${p.payout.toFixed(3)}`}
                  highlight={i === position.partials.length - 1}
                />
              ))}

              {/* Big multiplier readout */}
              <div className="absolute top-4 left-4 z-10">
                <div className="stat-label">Multiplier</div>
                <div
                  className="font-display text-5xl sm:text-6xl font-bold tracking-tight leading-none mt-1"
                  style={{
                    color:
                      phase === "crashed"
                        ? "var(--danger)"
                        : phase === "running"
                        ? "var(--accent)"
                        : "var(--text)",
                    textShadow:
                      phase === "running"
                        ? "0 0 30px color-mix(in srgb, var(--accent) 40%, transparent)"
                        : "none",
                  }}
                >
                  {multiplier.toFixed(2)}x
                </div>
                <div className="font-mono text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {elapsed.toFixed(1)}s
                </div>
              </div>

              {/* Outcome banner */}
              <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between z-10">
                <div>
                  {phase === "crashed" && crashPoint !== null && (
                    <div className="animate-pop">
                      <div className="font-display text-3xl sm:text-4xl font-bold" style={{ color: "var(--danger)" }}>
                        💥 {crashPoint.toFixed(2)}x
                      </div>
                      <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                        Crashed at {elapsed.toFixed(1)}s
                      </div>
                    </div>
                  )}
                  {phase === "idle" && !position && (
                    <div className="text-sm" style={{ color: "var(--muted)" }}>
                      Place a bet to start
                    </div>
                  )}
                </div>
                <div>
                  {phase === "idle" && position && (
                    <div className="text-right animate-pop">
                      <div className="text-xs" style={{ color: "var(--muted)" }}>
                        Round complete
                      </div>
                      <div
                        className="font-display text-2xl font-bold"
                        style={{ color: finalPnl >= 0 ? "var(--accent)" : "var(--danger)" }}
                      >
                        {finalPnl >= 0 ? "+" : ""}{finalPnl.toFixed(4)} SOL
                      </div>
                      {position.cashedOutSoFar > 0 && position.remaining === 0 && (
                        <div className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
                          cashed out fully
                        </div>
                      )}
                      {position.remaining > 0 && (
                        <div className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
                          lost remaining {position.remaining.toFixed(4)} SOL
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* PNL ROW */}
            <PnlRow
              bet={bet}
              multiplier={multiplier}
              phase={phase}
              pnl={phase === "running" ? livePnl : finalPnl}
              position={position}
            />
          </div>

          {/* CONTROL PANEL — moves below the chart, full width */}
          <ControlPanel
            bet={bet}
            setBet={setBet}
            balance={balance}
            phase={phase}
            cashoutPct={cashoutPct}
            setCashoutPct={setCashoutPct}
            multiplier={multiplier}
            livePnl={livePnl}
            onStart={startRound}
            onCashOut={() => cashOut(cashoutPct)}
            onNextRound={newRound}
            error={error}
          />
        </div>

        {/* LIVE STATE PANEL — left rail (instant chart) */}
        <LiveStatePanel
          phase={phase}
          multiplier={multiplier}
          elapsed={elapsed}
          crashPoint={crashPoint}
          position={position}
          livePnl={livePnl}
          finalPnl={finalPnl}
          predictedCrashT={predictedCrashT}
          balance={balance}
        />
      </div>

      {round && <CrashRoundLog round={round} />}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function ControlPanel({
  bet, setBet, balance, phase, cashoutPct, setCashoutPct, multiplier, livePnl, onStart, onCashOut, onNextRound, error,
}: {
  bet: number; setBet: (v: number) => void;
  balance: number; phase: "idle" | "running" | "crashed";
  cashoutPct: number; setCashoutPct: (v: number) => void;
  multiplier: number; livePnl: number;
  onStart: () => void; onCashOut: () => void; onNextRound: () => void;
  error: string;
}) {
  const isRunning = phase === "running";
  const settled = phase !== "running" && (phase === "crashed" || true);

  // The cash-out button label shows the *slice* being cashed out at the
  // current multiplier. For 100% that's the whole position; for partial,
  // it's the percentage slice.
  const slice = bet * (cashoutPct / 100);
  const slicePayout = slice * multiplier;
  const sliceGain = slicePayout - slice;

  return (
    <div className="panel p-6 space-y-5">
      <div>
        <label className="stat-label block mb-2">Bet amount</label>
        <BetStepper
          value={bet}
          onChange={setBet}
          max={balance}
          disabled={isRunning}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="stat-label">Partial cash-out</label>
          <span className="font-mono text-sm font-semibold" style={{ color: "var(--accent)" }}>
            {cashoutPct}%
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="100"
          step="1"
          value={cashoutPct}
          onChange={(e) => setCashoutPct(parseInt(e.target.value, 10))}
          disabled={isRunning}
          className="w-full accent-current"
          style={{ accentColor: "var(--accent)" }}
        />
        <div className="flex gap-1.5 mt-2">
          {[25, 50, 75, 100].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setCashoutPct(v)}
              disabled={isRunning}
              className="btn btn-ghost py-1 text-xs flex-1 disabled:opacity-40"
            >
              {v}%
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          className="text-sm px-3 py-2 rounded-lg"
          style={{
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            color: "var(--danger)",
            border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
          }}
        >
          {error}
        </div>
      )}

      {isRunning ? (
        <button
          onClick={onCashOut}
          className="btn btn-warning w-full py-4 text-base"
          style={{ animation: "pulseGlow 1.4s ease-in-out infinite" }}
        >
          <div className="flex flex-col items-center leading-tight">
            <span className="font-display text-lg">
              Cash out {cashoutPct}% @ {multiplier.toFixed(2)}x
            </span>
            <span className="font-mono text-xs mt-1" style={{ color: "#08080d", opacity: 0.8 }}>
              +{sliceGain.toFixed(4)} SOL  →  {slicePayout.toFixed(4)} SOL
            </span>
          </div>
        </button>
      ) : (
        <button onClick={onStart} className="btn btn-primary w-full py-4 text-base">
          Place bet
        </button>
      )}

      <div
        className="rounded-lg p-3 text-xs space-y-1.5"
        style={{
          background: "var(--surface2)",
          border: "1px solid var(--border)",
        }}
      >
        <Row label="House edge" value="4.00%" />
        <Row label="Max multiplier" value="1000x" />
        <Row label="P(RTP)" value="96.00%" />
      </div>
    </div>
  );
}

function BetStepper({
  value, onChange, max, disabled,
}: { value: number; onChange: (v: number) => void; max: number; disabled?: boolean }) {
  const adjust = (delta: number) => {
    const next = Math.max(0, +(value + delta).toFixed(2));
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="stepper-btn"
          onClick={() => adjust(-0.1)}
          disabled={disabled || value <= 0}
          aria-label="Decrease"
        >
          −
        </button>
        <div className="relative flex-1">
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            disabled={disabled}
            className="input pr-14 text-lg font-semibold text-center"
          />
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono"
            style={{ color: "var(--muted)" }}
          >
            SOL
          </span>
        </div>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => adjust(0.1)}
          disabled={disabled}
          aria-label="Increase"
        >
          +
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {[0.05, 0.1, 0.5, 1].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              disabled={disabled}
              className="btn btn-ghost py-1 text-xs flex-1 disabled:opacity-40"
            >
              {v}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange(+(max).toFixed(2))}
          disabled={disabled}
          className="btn btn-ghost py-1 text-xs px-3"
        >
          MAX
        </button>
        <button
          type="button"
          onClick={() => onChange(+(value / 2).toFixed(2))}
          disabled={disabled}
          className="btn btn-ghost py-1 text-xs px-3"
        >
          ½
        </button>
      </div>
    </div>
  );
}

function PnlRow({
  bet, multiplier, phase, pnl, position,
}: { bet: number; multiplier: number; phase: string; pnl: number; position: PositionState | null }) {
  const remaining = position?.remaining ?? 0;
  const realized = position?.cashedOutSoFar ?? 0;
  const labels: { label: string; value: string; color: string }[] = [
    { label: "Bet", value: `${bet.toFixed(2)} SOL`, color: "var(--text)" },
    {
      label: phase === "running" ? "Live PNL" : "Realized PNL",
      value: `${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL`,
      color: pnl >= 0 ? "var(--accent)" : "var(--danger)",
    },
    {
      label: "Riding",
      value: `${remaining.toFixed(4)} SOL`,
      color: remaining > 0 ? "var(--text)" : "var(--muted)",
    },
    {
      label: "Multiplier",
      value: `${multiplier.toFixed(2)}x`,
      color: "var(--accent)",
    },
  ];

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 border-t"
      style={{ borderColor: "var(--border)" }}
    >
      {labels.map((l, i) => (
        <div
          key={l.label}
          className="px-4 py-3"
          style={{
            borderRight: i < labels.length - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <div className="stat-label">{l.label}</div>
          <div
            className="font-mono font-semibold text-base mt-0.5"
            style={{ color: l.color }}
          >
            {l.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveStatePanel({
  phase, multiplier, elapsed, crashPoint, position, livePnl, finalPnl, predictedCrashT, balance,
}: {
  phase: "idle" | "running" | "crashed";
  multiplier: number;
  elapsed: number;
  crashPoint: number | null;
  position: PositionState | null;
  livePnl: number;
  finalPnl: number;
  predictedCrashT: number;
  balance: number;
}) {
  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="chip chip-accent">Live</span>
        <span className="text-sm font-semibold">Your state</span>
      </div>

      <div className="space-y-2">
        <Row label="Status" value={
          phase === "idle" && !position ? "Idle" :
          phase === "running" ? "In round" :
          phase === "crashed" ? "Crashed" :
          "Round complete"
        } />
        <Row label="Multiplier" value={`${multiplier.toFixed(2)}x`} accent />
        <Row label="Elapsed" value={`${elapsed.toFixed(1)}s`} />
        {crashPoint !== null && phase === "running" && (
          <Row label="Crash target" value={`${crashPoint.toFixed(2)}x`} accent />
        )}
      </div>

      <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--border)" }}>
        <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--muted)" }}>
          Position
        </div>
        {position ? (
          <>
            <Row label="Bet" value={`${position.bet.toFixed(4)} SOL`} />
            <Row label="Riding" value={`${position.remaining.toFixed(4)} SOL`} />
            <Row label="Realized" value={`${position.cashedOutSoFar.toFixed(4)} SOL`} />
            <Row
              label={phase === "running" ? "Live PNL" : "Realized PNL"}
              value={`${(phase === "running" ? livePnl : finalPnl) >= 0 ? "+" : ""}${(phase === "running" ? livePnl : finalPnl).toFixed(4)} SOL`}
              accent
            />
            <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
              {position.partials.length === 0
                ? "No partials yet"
                : `${position.partials.length} partial cash-out${position.partials.length === 1 ? "" : "s"} so far`}
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            No active position
          </div>
        )}
      </div>

      <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--border)" }}>
        <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--muted)" }}>
          Wallet
        </div>
        <Row label="Balance" value={`${balance.toFixed(4)} SOL`} accent />
      </div>
    </div>
  );
}

function GridAndAxis({
  multiplier, yMax, xMax, xTicks, yTicks,
}: { multiplier: number; yMax: number; xMax: number; xTicks: number[]; yTicks: number[] }) {
  const border = "var(--border)";
  const muted = "var(--muted)";

  return (
    <>
      {/* Y-axis labels (left) */}
      <div className="absolute left-2 top-0 bottom-8 flex flex-col-reverse justify-between pointer-events-none z-[1] py-2">
        {yTicks.map((v) => (
          <span key={v} className="text-[10px] font-mono leading-none" style={{ color: muted }}>
            {v}x
          </span>
        ))}
      </div>
      {/* X-axis labels (bottom) */}
      <div className="absolute left-0 right-0 bottom-1 flex justify-between px-12 pointer-events-none z-[1]">
        {xTicks.map((t) => (
          <span key={t} className="text-[10px] font-mono" style={{ color: muted }}>
            {t}s
          </span>
        ))}
      </div>
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-[1]" preserveAspectRatio="none">
        {xTicks.map((t) => {
          const x = (t / xMax) * 100;
          return (
            <line
              key={t}
              x1={`${x}%`}
              y1="0"
              x2={`${x}%`}
              y2="calc(100% - 28px)"
              stroke={border}
              strokeWidth="1"
              strokeDasharray="2 4"
              opacity="0.5"
            />
          );
        })}
        {yTicks.map((v) => {
          const y = 100 - (v / yMax) * 100;
          return (
            <line
              key={`h-${v}`}
              x1="0"
              y1={`${y}%`}
              x2="100%"
              y2={`${y}%`}
              stroke={border}
              strokeWidth="1"
              strokeDasharray="2 4"
              opacity="0.4"
            />
          );
        })}
      </svg>
    </>
  );
}

function CurvePath({
  points, xMax, yMax, phase,
}: { points: { t: number; m: number }[]; xMax: number; yMax: number; phase: string }) {
  if (points.length < 2) return null;
  const top = 0, bottom = 28;
  const w = 1000, h = 600;
  const pathD = points.map((p, i) => {
    const x = (p.t / xMax) * w;
    const y = top + (1 - Math.min(0.98, p.m / yMax)) * (h - bottom - top);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const fillD = pathD + ` L ${w} ${h} L 0 ${h} Z`;
  const color = phase === "crashed" ? "var(--danger)" : "var(--accent)";
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-[2]"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#curve-fill)" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Rocket({
  points, xMax, yMax,
}: { points: { t: number; m: number }[]; xMax: number; yMax: number }) {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];

  const xPct = Math.min(100, (last.t / xMax) * 100);
  const yPct = 100 - Math.min(98, (last.m / yMax) * 100);

  // Tangent: angle between prev and last points along the curve.
  const dy = last.m - prev.m;
  const dt = Math.max(last.t - prev.t, 0.01);
  const angleRad = Math.atan2(dy / yMax, dt / xMax);
  const angleDeg = -angleRad * (180 / Math.PI);

  return (
    <div
      className="rocket"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: `rotate(${angleDeg}deg)`,
      }}
    >
      🚀
    </div>
  );
}

function CrashTargetLine({
  crashPoint, xMax, yMax,
}: { multiplier: number; crashPoint: number; xMax: number; yMax: number }) {
  const tCrash = Math.log(crashPoint) / (GROWTH_PER_SEC * Math.log(1.05));
  const xPct = Math.min(100, (tCrash / xMax) * 100);
  const yPct = 100 - Math.min(98, (crashPoint / yMax) * 100);

  return (
    <>
      <div
        className="absolute z-[2] pointer-events-none"
        style={{
          left: `${xPct}%`,
          top: 0,
          bottom: 28,
          borderLeft: "2px dashed var(--danger)",
          opacity: 0.7,
        }}
      />
      <div
        className="absolute z-[3] pointer-events-none font-mono text-xs px-1.5 py-0.5 rounded"
        style={{
          left: `calc(${xPct}% - 22px)`,
          top: `calc(${yPct}% - 22px)`,
          background: "var(--danger)",
          color: "#08080d",
          fontWeight: 700,
        }}
      >
        {crashPoint.toFixed(2)}x
      </div>
    </>
  );
}

function CashoutMarker({
  t, m, xMax, yMax, label, highlight,
}: { t: number; m: number; xMax: number; yMax: number; label: string; highlight?: boolean }) {
  const xPct = Math.min(100, (t / xMax) * 100);
  const yPct = 100 - Math.min(98, (m / yMax) * 100);
  return (
    <div
      className="absolute z-[5] flex flex-col items-center pointer-events-none"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className="cashout-marker"
        style={{
          background: highlight ? "var(--warning)" : "var(--accent)",
          width: highlight ? 26 : 22,
          height: highlight ? 26 : 22,
        }}
      >
        {highlight ? "★" : "✓"}
      </div>
      <span
        className="text-[10px] mt-0.5 font-mono font-bold whitespace-nowrap"
        style={{ color: highlight ? "var(--warning)" : "var(--accent)" }}
      >
        {label}
      </span>
    </div>
  );
}

function PastRounds({ values }: { values: number[] }) {
  const display = values.slice(-10).reverse();
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="chip chip-accent">Past 10</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Most recent rounds (newest first)
          </span>
        </div>
        <div className="text-xs font-mono" style={{ color: "var(--muted)" }}>
          total = {values.length}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {display.map((v, i) => (
          <div
            key={i}
            className={`history-pill ${v < 2 ? "cold" : "hot"}`}
            title={`Round ${values.length - i}: ${v.toFixed(2)}x`}
          >
            {v.toFixed(2)}x
          </div>
        ))}
      </div>
    </div>
  );
}

function CrashRoundLog({ round }: { round: RoundInfo }) {
  return (
    <div className="panel p-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="chip chip-accent">Verifiable</span>
        <span className="text-sm font-semibold">Last round — seed chain</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs font-mono">
        <Row label="server_seed" value={round.serverSeed} accent />
        <Row label="server_hash (commit)" value={round.serverSeedHash} accent />
        <Row label="client_seed" value={round.clientSeed} accent />
        <Row label="client_hash" value={round.clientSeedHash} accent />
        <Row label="nonce" value={String(round.nonce)} />
        <Row label="crash_point" value={round.crashPoint.toFixed(2) + "x"} accent />
      </div>
      <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
        Verify by computing{" "}
        <code
          className="font-mono px-1.5 py-0.5 rounded"
          style={{ background: "var(--surface2)" }}
        >
          HMAC-SHA-256(server_seed, client_seed || nonce)
        </code>{" "}
        and applying the crash formula in <code>lib/provablyFair.ts</code>.
      </p>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="stat-label">{label}</span>
      <span
        className="font-mono text-sm font-semibold break-all text-right"
        title={value}
        style={{ color: accent ? "var(--accent)" : "var(--text)" }}
      >
        {value}
      </span>
    </div>
  );
}