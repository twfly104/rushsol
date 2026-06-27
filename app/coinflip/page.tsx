"use client";

import { useState } from "react";
import {
  generateServerSeed,
  hashSeed,
  coinflip,
  type CoinflipResult,
} from "@/lib/provablyFair";
import { useMockBalance } from "@/components/MockBalanceProvider";
import { logRound, type RoundEntry } from "@/lib/roundLog";
import { audit } from "@/lib/clientAudit";

const HOUSE_EDGE_BPS = 400; // 4% — house wins 4% of bets long-term
const SIDE = { HEADS: "Heads", TAILS: "Tails" } as const;
type Side = typeof SIDE[keyof typeof SIDE];

const SIDE_STYLE: Record<Side, { color: string; faceFront: string; faceBack: string; settledWon: string; settledWonBack: string; settledLost: string; settledLostBack: string; }> = {
  Heads: {
    color: "var(--accent)",
    faceFront: "linear-gradient(135deg, #6ee7b7 0%, #14f195 50%, #047857 100%)",
    faceBack: "linear-gradient(135deg, #34d399 0%, #10b981 50%, #064e3b 100%)",
    settledWon: "linear-gradient(135deg, #6ee7b7 0%, #10b981 50%, #065f46 100%)",
    settledWonBack: "linear-gradient(135deg, #34d399 0%, #059669 50%, #064e3b 100%)",
    settledLost: "linear-gradient(135deg, #f87171 0%, #dc2626 50%, #7f1d1d 100%)",
    settledLostBack: "linear-gradient(135deg, #fb923c 0%, #ea580c 50%, #7c2d12 100%)",
  },
  Tails: {
    color: "var(--accent2)",
    faceFront: "linear-gradient(135deg, #d8b4fe 0%, #a855f7 50%, #6b21a8 100%)",
    faceBack: "linear-gradient(135deg, #c084fc 0%, #9333ea 50%, #581c87 100%)",
    settledWon: "linear-gradient(135deg, #d8b4fe 0%, #a855f7 50%, #6b21a8 100%)",
    settledWonBack: "linear-gradient(135deg, #c084fc 0%, #9333ea 50%, #581c87 100%)",
    settledLost: "linear-gradient(135deg, #f87171 0%, #dc2626 50%, #7f1d1d 100%)",
    settledLostBack: "linear-gradient(135deg, #fb923c 0%, #ea580c 50%, #7c2d12 100%)",
  },
};

type RoundLog = Extract<RoundEntry, { game: "coinflip" }>;

export default function CoinflipPage() {
  const { balance, credit, debit } = useMockBalance();
  const [bet, setBet] = useState(0.1);
  const [side, setSide] = useState<Side>(SIDE.HEADS);
  const [serverSeed, setServerSeed] = useState<string>("");
  const [serverSeedHash, setServerSeedHash] = useState<string>("");
  const [clientSeed] = useState<string>(() => crypto.randomUUID());
  const [clientSeedHash, setClientSeedHash] = useState<string>("");
  const [result, setResult] = useState<CoinflipResult | null>(null);
  const [flipping, setFlipping] = useState(false);
  const [history, setHistory] = useState<RoundLog[]>([]);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string>("");
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);

  async function newRound() {
    const newServer = generateServerSeed();
    const newServerHash = await hashSeed(newServer);
    const newClientHash = await hashSeed(clientSeed);
    setServerSeed(newServer);
    setServerSeedHash(newServerHash);
    setClientSeedHash(newClientHash);
    setNonce((n) => n + 1);
    setResult(null);
    setError("");
  }

  async function flip() {
    setError("");
    if (bet <= 0) return setError("Bet must be greater than 0");
    if (bet > balance) return setError("Insufficient mock balance");
    if (!debit(bet)) return setError("Insufficient mock balance");

    audit({
      action: "BET_PLACED",
      payload: { game: "coinflip", betAmount: bet, side },
    });

    setFlipping(true);
    // Ensure we have fresh seeds for this round.
    let s = serverSeed, sh = serverSeedHash, ch = clientSeedHash;
    if (!s) {
      s = generateServerSeed();
      sh = await hashSeed(s);
      ch = await hashSeed(clientSeed);
      setServerSeed(s);
      setServerSeedHash(sh);
      setClientSeedHash(ch);
    }
    const r = await coinflip(s, clientSeed, nonce, { houseEdgeBps: HOUSE_EDGE_BPS });
    await new Promise((res) => setTimeout(res, 1600));
    setResult(r);
    setFlipping(false);

    const won = r.playerWon;
    const payout = won ? bet * 2 : 0;
    if (won) credit(bet * 2);
    setWins((w) => w + (won ? 1 : 0));
    setLosses((l) => l + (won ? 0 : 1));
    const entry = {
      game: "coinflip" as const,
      side,
      won,
      payout,
      serverSeed: s,
      serverSeedHash: sh,
      clientSeed,
      clientSeedHash: ch,
      nonce,
      bucket: r.bucket,
      threshold: r.threshold,
      betAmount: bet,
      resolvedAt: Date.now(),
    };
    setHistory((h) => [entry, ...h.slice(0, 9)]);
    logRound(entry);
    audit({
      action: "BET_RESOLVED",
      payload: { game: "coinflip", nonce, won, payout, bucket: r.bucket },
    });
    // Auto-advance to next round.
    await newRound();
  }

  const totalRounds = wins + losses;
  const empiricalEdge = totalRounds > 0 ? ((losses / totalRounds) * 100).toFixed(2) : "—";

  return (
    <div className="space-y-6 animate-fade-in">
      <header>
        <h1 className="font-display text-3xl font-bold">Coinflip</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Pick a side, place a bet, watch the SHA-256 commit resolve. Every
          round logs the seed-chain so you can verify any outcome.
        </p>
      </header>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* LEFT: bet panel — Bet button at top so it's always reachable. */}
        <div className="lg:col-span-2 panel p-6 space-y-5">
          {/* BET BUTTON — first thing visible, sticky so it stays put while
              the amount/side controls scroll within the panel. */}
          <button
            onClick={flip}
            disabled={flipping}
            className="btn btn-primary w-full py-4 text-base sticky top-2 z-10"
          >
            {flipping ? "Flipping…" : `Bet ${bet} SOL on ${side}`}
          </button>

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

          <div>
            <label className="stat-label block mb-2">Bet amount</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setBet(Math.max(0, +(bet - 0.1).toFixed(2)))}
                disabled={flipping || bet <= 0}
                aria-label="Decrease"
              >
                ↓
              </button>
              <div className="relative flex-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={bet}
                  onChange={(e) => setBet(parseFloat(e.target.value) || 0)}
                  className="input pr-14 text-lg font-semibold text-center"
                  disabled={flipping}
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
                onClick={() => setBet(+(bet + 0.1).toFixed(2))}
                disabled={flipping}
                aria-label="Increase"
              >
                ↑
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex gap-1 flex-1">
                {[0.05, 0.1, 0.5, 1].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBet(v)}
                    disabled={flipping}
                    className="btn btn-ghost py-1 text-xs flex-1 disabled:opacity-40"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setBet(+balance.toFixed(2))}
                disabled={flipping}
                className="btn btn-ghost py-1 text-xs px-3"
              >
                MAX
              </button>
              <button
                type="button"
                onClick={() => setBet(+(bet / 2).toFixed(2))}
                disabled={flipping}
                className="btn btn-ghost py-1 text-xs px-3"
              >
                ½
              </button>
            </div>
          </div>

          <div>
            <label className="stat-label block mb-2">Pick a side</label>
            <div className="grid grid-cols-2 gap-2">
              <SideButton
                active={side === SIDE.HEADS}
                onClick={() => setSide(SIDE.HEADS)}
                label="Heads"
                symbol="H"
                disabled={flipping}
                accent="var(--accent)"
              />
              <SideButton
                active={side === SIDE.TAILS}
                onClick={() => setSide(SIDE.TAILS)}
                label="Tails"
                symbol="T"
                disabled={flipping}
                accent="var(--accent2)"
              />
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

          {/* Bet button moved to the top of the panel so it's always visible
              without scrolling. See above. */}

          {/* STATS */}
          <div
            className="rounded-lg p-3 grid grid-cols-3 gap-2 text-center text-xs"
            style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}
          >
            <Stat label="Wins" value={wins.toString()} color="var(--accent)" />
            <Stat label="Losses" value={losses.toString()} color="var(--danger)" />
            <Stat
              label="Empirical edge"
              value={totalRounds > 0 ? `${empiricalEdge}%` : "—"}
              color="var(--warning)"
            />
          </div>
        </div>

        {/* RIGHT: coin display */}
        <div className="lg:col-span-3 panel p-8 flex flex-col items-center justify-center min-h-[360px] relative overflow-hidden">
          {/* Decorative background ring */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 60%)`,
            }}
          />
          <div className="relative">
            <Coin flipping={flipping} result={result} side={side} />
          </div>
          {result && !flipping && (
            <div className="mt-8 text-center animate-pop">
              <div
                className="font-display text-3xl font-bold mb-1"
                style={{ color: result.playerWon ? "var(--accent)" : "var(--danger)" }}
              >
                {result.playerWon ? "You won" : "You lost"}
              </div>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                {result.playerWon ? `+${bet.toFixed(2)} SOL` : `-${bet.toFixed(2)} SOL`}
              </div>
              <div className="mt-3 inline-flex items-center gap-2 text-xs font-mono">
                <span style={{ color: "var(--muted)" }}>bucket</span>
                <span
                  className="px-2 py-0.5 rounded"
                  style={{
                    background: result.playerWon
                      ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                      : "color-mix(in srgb, var(--danger) 15%, transparent)",
                    color: result.playerWon ? "var(--accent)" : "var(--danger)",
                  }}
                >
                  {result.bucket}
                </span>
                <span style={{ color: "var(--muted)" }}>/ threshold {result.threshold}</span>
              </div>
            </div>
          )}
          {!result && !flipping && (
            <div className="mt-8 text-center text-sm" style={{ color: "var(--muted)" }}>
              Place a bet to flip
            </div>
          )}
        </div>
      </div>

      {/* ROUND LOG */}
      <div className="panel p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="chip chip-accent">Verifiable</span>
            <span className="text-sm font-semibold">Round log</span>
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {history.length === 0 ? "No rounds yet" : `Last ${history.length} rounds`}
          </span>
        </div>
        {history.length === 0 ? (
          <div className="text-sm py-6 text-center" style={{ color: "var(--muted)" }}>
            Your round history will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead style={{ color: "var(--muted)" }}>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="text-left py-2 pr-4">#</th>
                  <th className="text-left py-2 pr-4">Result</th>
                  <th className="text-left py-2 pr-4">Bucket</th>
                  <th className="text-left py-2 pr-4">Server seed</th>
                  <th className="text-left py-2 pr-4">Commit hash</th>
                  <th className="text-right py-2">Payout</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr
                    key={h.nonce}
                    className="border-b last:border-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="py-2 pr-4" style={{ color: "var(--muted)" }}>
                      {h.nonce}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className="chip"
                        style={{
                          background: h.won
                            ? "color-mix(in srgb, var(--accent) 18%, transparent)"
                            : "color-mix(in srgb, var(--danger) 18%, transparent)",
                          color: h.won ? "var(--accent)" : "var(--danger)",
                        }}
                      >
                        {h.won ? "WIN" : "LOSS"} · {h.side}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span style={{ color: "var(--muted)" }}>{h.bucket}</span>
                      <span style={{ color: "var(--muted)" }}> / </span>
                      <span>{h.threshold}</span>
                    </td>
                    <td className="py-2 pr-4 truncate max-w-[180px]" title={h.serverSeed}>
                      {h.serverSeed.slice(0, 16)}…
                    </td>
                    <td className="py-2 pr-4 truncate max-w-[180px]" title={h.serverSeedHash}>
                      {h.serverSeedHash.slice(0, 16)}…
                    </td>
                    <td className="py-2 text-right font-semibold" style={{ color: h.won ? "var(--accent)" : "var(--danger)" }}>
                      {h.won ? `+${h.payout.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
          Verify each row:{" "}
          <code
            className="font-mono px-1.5 py-0.5 rounded"
            style={{ background: "var(--surface2)" }}
          >
            SHA-256(server_seed) == commit
          </code>{" "}
          then HMAC-SHA-256(server_seed, client_seed || nonce) → confirm bucket.
        </p>
      </div>
    </div>
  );
}

function SideButton({
  active, onClick, label, symbol, disabled, accent,
}: { active: boolean; onClick: () => void; label: string; symbol: string; disabled?: boolean; accent: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative py-4 rounded-lg font-display font-semibold transition-all duration-200 disabled:opacity-50"
      style={{
        background: active
          ? `color-mix(in srgb, ${accent} 18%, var(--surface2))`
          : "var(--surface2)",
        border: `1px solid ${active ? accent : "var(--border)"}`,
        color: active ? accent : "var(--text)",
        boxShadow: active ? `0 0 24px -6px color-mix(in srgb, ${accent} 50%, transparent)` : "none",
      }}
    >
      <span
        className="block text-2xl mb-0.5"
        style={{ color: active ? accent : "var(--text)" }}
      >
        {symbol}
      </span>
      <span className="text-xs uppercase tracking-wider">{label}</span>
    </button>
  );
}

function Coin({ flipping, result, side }: { flipping: boolean; result: CoinflipResult | null; side: Side }) {
  const settled = !flipping && result !== null;
  const won = result?.playerWon;
  const style = SIDE_STYLE[side];
  const wonSide = result ? (result.playerWon ? side : side === SIDE.HEADS ? SIDE.TAILS : SIDE.HEADS) : side;
  const wonStyle = SIDE_STYLE[wonSide];

  return (
    <div className="coin-stage" style={{ width: 200, height: 200 }}>
      <div
        className={`coin-3d ${flipping ? "spinning" : ""} ${settled ? (won ? "settled-won" : "settled-lost") : ""}`}
      >
        <div
          className="coin-face coin-front"
          style={{
            background: settled
              ? won
                ? wonStyle.settledWon
                : wonStyle.settledLost
              : style.faceFront,
            boxShadow: settled
              ? won
                ? `inset 0 -8px 24px rgba(0,0,0,0.35), inset 0 8px 16px rgba(255,255,255,0.4), 0 20px 60px -20px ${wonStyle.color}`
                : `inset 0 -8px 24px rgba(0,0,0,0.35), inset 0 8px 16px rgba(255,255,255,0.4), 0 20px 60px -20px var(--danger)`
              : `inset 0 -8px 24px rgba(0,0,0,0.35), inset 0 8px 16px rgba(255,255,255,0.3), 0 20px 60px -20px ${style.color}`,
          }}
        >
          <div
            className="coin-inner"
            style={{
              borderColor: `${wonStyle.color}66`,
            }}
          >
            {flipping ? (
              <span
                className="font-display text-6xl font-bold animate-pulse"
                style={{ color: style.color === "var(--accent)" ? "#08080d" : "#fff" }}
              >
                {side === SIDE.HEADS ? "H" : "T"}
              </span>
            ) : settled ? (
              <div className="flex flex-col items-center animate-pop">
                <span
                  className="font-display text-7xl font-bold"
                  style={{ color: won ? "#fff" : "#fff" }}
                >
                  {won ? "✓" : "✗"}
                </span>
                <span
                  className="font-display text-sm font-bold mt-1 uppercase tracking-wider"
                  style={{ color: won ? "#08080d" : "#fff" }}
                >
                  {wonSide}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <span
                  className="font-display text-5xl font-bold"
                  style={{ color: style.color === "var(--accent)" ? "#08080d" : "#fff" }}
                >
                  {side === SIDE.HEADS ? "H" : "T"}
                </span>
                <span
                  className="font-display text-[10px] font-bold mt-1 uppercase tracking-widest opacity-60"
                  style={{ color: style.color === "var(--accent)" ? "#08080d" : "#fff" }}
                >
                  Your pick
                </span>
              </div>
            )}
          </div>
        </div>
        <div
          className="coin-face coin-back"
          style={{
            background: settled
              ? won
                ? wonStyle.settledWonBack
                : wonStyle.settledLostBack
              : style.faceBack,
          }}
        >
          <div className="coin-inner">
            <span
              className="font-display text-5xl font-bold"
              style={{ color: "#fff" }}
            >
              {flipping ? (side === SIDE.HEADS ? "T" : "H") : wonSide}
            </span>
          </div>
        </div>
      </div>
      {/* Decorative ring */}
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          border: `2px dashed color-mix(in srgb, ${style.color} 30%, transparent)`,
          animation: "spin 12s linear infinite",
          margin: "-14px",
        }}
      />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="font-mono font-bold text-lg mt-0.5" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
