/**
 * Per-game round log store (devnet-safe).
 *
 * Persists the last N rounds the player played in this browser. The store is
 * purely client-side because the devnet build has no server-backed bet
 * ledger. The shape of stored entries mirrors what a future server-backed
 * `Bet` table would hold (see prisma/schema.prisma), so swapping this out
 * for a real fetch later is a one-file change.
 *
 * Scope note: this is *audit data for the player* (so they can verify their
 * own rounds via /verify) — it is NOT the system-wide audit log. Use
 * lib/clientAudit.ts for that.
 */

const STORAGE_KEY_PREFIX = "rushsol:rounds:";
const MAX_ROUNDS_PER_GAME = 50;

export type GameKind = "coinflip" | "crash" | "blackjack";

export interface BaseRoundEntry {
  game: GameKind;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  clientSeedHash: string;
  nonce: number;
  betAmount: number; // SOL
  payout: number; // SOL (0 if lost)
  resolvedAt: number; // epoch ms
}

export type RoundEntry = BaseRoundEntry &
  (
    | { game: "coinflip"; side: "Heads" | "Tails"; bucket: number; threshold: number; won: boolean }
    | { game: "crash"; crashPoint: number }
    | { game: "blackjack"; deckHead: number[]; outcome: "win" | "lose" | "push" | "bust" | "bj" }
  );

function key(game: GameKind) {
  return `${STORAGE_KEY_PREFIX}${game}`;
}

function read(game: GameKind): RoundEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(game));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RoundEntry[]) : [];
  } catch {
    return [];
  }
}

function write(game: GameKind, entries: RoundEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(game), JSON.stringify(entries));
  } catch {
    // localStorage may be full or disabled (private mode). Round log is
    // best-effort; failure here is non-fatal.
  }
}

/**
 * Append a round to the front of the log. Dedupes on (nonce, game) so a
 * double-submit from a flaky network only counts once.
 */
export function logRound(entry: RoundEntry): void {
  const existing = read(entry.game);
  const filtered = existing.filter((e) => e.nonce !== entry.nonce);
  const next = [entry, ...filtered].slice(0, MAX_ROUNDS_PER_GAME);
  write(entry.game, next);
}

export function getRounds(game: GameKind, limit = 10): RoundEntry[] {
  return read(game).slice(0, limit);
}

export function getLatestRound(game: GameKind): RoundEntry | null {
  const all = read(game);
  return all[0] ?? null;
}

export function clearRounds(game: GameKind): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(game));
}
