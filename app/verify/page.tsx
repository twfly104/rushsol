"use client";

import { useEffect, useState } from "react";
import {
  hashSeed,
  coinflip,
  crash,
  blackjackShuffle,
} from "@/lib/provablyFair";
import { getRounds, type GameKind, type RoundEntry } from "@/lib/roundLog";

/**
 * Independent verification page.
 *
 * Paste a server seed, client seed, nonce, and game type. We recompute the
 * outcome from scratch and show whether (a) the server hash matches, and
 * (b) the outcome reproduces.
 *
 * The point of provably fair: the user shouldn't need to trust *our* UI to
 * tell them the answer. They should be able to compute it themselves.
 */
export default function VerifyPage() {
  const [serverSeed, setServerSeed] = useState("");
  const [serverSeedHash, setServerSeedHash] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [nonce, setNonce] = useState("0");
  const [game, setGame] = useState<"coinflip" | "crash" | "blackjack">("coinflip");
  const [houseEdgeBps, setHouseEdgeBps] = useState("200");
  const [result, setResult] = useState<string>("");
  const [hashOk, setHashOk] = useState<boolean | null>(null);

  // Recent rounds (per game) from localStorage. Empty array on SSR / when
  // nothing is logged yet. Re-read whenever the active game changes.
  const [recent, setRecent] = useState<RoundEntry[]>([]);
  useEffect(() => {
    setRecent(getRounds(game as GameKind, 10));
  }, [game]);

  function loadRound(r: RoundEntry) {
    setServerSeed(r.serverSeed);
    setServerSeedHash(r.serverSeedHash);
    setClientSeed(r.clientSeed);
    setNonce(String(r.nonce));
    setGame(r.game);
    setResult("");
    setHashOk(null);
  }

  async function run() {
    setResult("");
    const n = parseInt(nonce, 10);
    if (!serverSeed || !clientSeed || Number.isNaN(n)) {
      setResult("All fields required.");
      return;
    }
    const computed = await hashSeed(serverSeed);
    const ok = computed === serverSeedHash;
    setHashOk(ok);

    if (game === "coinflip") {
      const r = await coinflip(serverSeed, clientSeed, n, {
        houseEdgeBps: parseInt(houseEdgeBps, 10),
      });
      setResult(
        `Bucket ${r.bucket} / threshold ${r.threshold} → ${
          r.playerWon ? "WIN" : "LOSS"
        }`,
      );
    } else if (game === "crash") {
      const r = await crash(serverSeed, clientSeed, n, {
        houseEdgeBps: parseInt(houseEdgeBps, 10),
        maxMultiplier: 1000,
      });
      setResult(`Crash point: ${r.crashPoint.toFixed(2)}x`);
    } else {
      const r = await blackjackShuffle(serverSeed, clientSeed, n);
      setResult(`First 8 cards of shuffled deck: ${r.deck.slice(0, 8).join(", ")}`);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header>
        <div className="flex items-center gap-2 mb-1">
          <span className="chip chip-accent">Audit tool</span>
          <span className="chip chip-purple">Independent</span>
        </div>
        <h1 className="font-display text-3xl font-bold">Verify a round</h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: "var(--muted)" }}>
          Recompute any round{"'"}s outcome from its seed-chain. Useful for
          auditing specific hands, confirming crash points, or just to see
          how the math works.
        </p>
      </header>

      <div className="panel p-5 sm:p-6">
        <div className="grid lg:grid-cols-2 gap-6">
          {/* INPUTS */}
          <div className="space-y-4">
            <Field label="Server seed (revealed)">
              <input
                value={serverSeed}
                onChange={(e) => setServerSeed(e.target.value)}
                className="input"
                placeholder="hex string from the round log"
              />
            </Field>
            <Field label="Server seed hash (commit)">
              <input
                value={serverSeedHash}
                onChange={(e) => setServerSeedHash(e.target.value)}
                className="input"
                placeholder="hex string from the round log"
              />
            </Field>
            <Field label="Client seed">
              <input
                value={clientSeed}
                onChange={(e) => setClientSeed(e.target.value)}
                className="input"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nonce">
                <input
                  value={nonce}
                  onChange={(e) => setNonce(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="House edge (bps)">
                <input
                  value={houseEdgeBps}
                  onChange={(e) => setHouseEdgeBps(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
            <Field label="Game">
              <select
                value={game}
                onChange={(e) => setGame(e.target.value as typeof game)}
                className="input"
              >
                <option value="coinflip">Coinflip</option>
                <option value="crash">Crash</option>
                <option value="blackjack">Blackjack</option>
              </select>
            </Field>
            <button onClick={run} className="btn btn-primary w-full py-3">
              Recompute outcome
            </button>
          </div>

          {/* RESULT */}
          <div
            className="rounded-lg p-5 space-y-3 self-start"
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="text-sm font-semibold">Result</div>
            {!result && (
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                Paste any round{"'"}s seeds and click Recompute.
              </div>
            )}
            {result && (
              <div className="space-y-2 text-sm font-mono">
                <div
                  className="px-3 py-2 rounded-md flex items-center gap-2"
                  style={{
                    background: hashOk
                      ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                      : "color-mix(in srgb, var(--danger) 15%, transparent)",
                    color: hashOk ? "var(--accent)" : "var(--danger)",
                    border: `1px solid color-mix(in srgb, ${hashOk ? "var(--accent)" : "var(--danger)"} 30%, transparent)`,
                  }}
                >
                  {hashOk ? "✓" : "✗"}{" "}
                  {hashOk
                    ? "Server hash matches commit"
                    : "Server hash DOES NOT match — possible manipulation"}
                </div>
                <div
                  className="px-3 py-2 rounded-md"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {result}
                </div>
              </div>
            )}

            {/* RECENT ROUNDS */}
            <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
                Recent rounds — {game}
              </div>
              {recent.length === 0 ? (
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  No rounds logged in this browser yet. Play a round on the
                  {" "}
                  <code className="font-mono">{game}</code> page and it{"'"}ll
                  appear here.
                </div>
              ) : (
                <ul className="space-y-1">
                  {recent.map((r) => (
                    <li key={r.nonce}>
                      <button
                        type="button"
                        onClick={() => loadRound(r)}
                        className="w-full text-left px-2 py-1.5 rounded text-xs font-mono hover:opacity-80 transition"
                        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                        title={`nonce ${r.nonce} — click to load`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ color: "var(--muted)" }}>#{r.nonce}</span>
                          <span
                            style={{
                              color:
                                "payout" in r && r.payout > 0
                                  ? "var(--accent)"
                                  : "var(--danger)",
                            }}
                          >
                            {"payout" in r && r.payout > 0 ? "+" : ""}
                            {"payout" in r ? r.payout.toFixed(3) : "—"} SOL
                          </span>
                        </div>
                        <div className="truncate" style={{ color: "var(--muted)" }}>
                          {r.serverSeed.slice(0, 24)}…
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="text-xs pt-2" style={{ color: "var(--muted)" }}>
              The math here runs entirely in your browser using the Web
              Crypto API. Nothing is sent to a server.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="stat-label block mb-1.5">{label}</label>
      {children}
    </div>
  );
}