/**
 * Provably Fair RNG for RushSol (devnet build)
 * ─────────────────────────────────────────────
 *
 * MODEL: Hedged seed-chain. server_seed_n is fully determined by the previous
 * round's committed (server_seed, client_seed) pair, so the server has no
 * degrees of freedom at round n and cannot grind outcomes.
 *
 *   server_seed_n    = HMAC-SHA256(server_seed_(n-1), client_seed_(n-1))
 *   server_seed_hash = SHA-256(server_seed)
 *   outcome          = HMAC-SHA256(server_seed, client_seed || nonce)
 *
 * Client commitment: the player commits SHA-256(client_seed) BEFORE the
 * server reveals server_seed_hash. This prevents the server from adapting
 * to the client's seed choice.
 *
 * NOTE: This implementation runs entirely in the browser for the devnet build.
 * In a production deployment, server_seed must live on the server only and
 * be revealed to the player AFTER the round resolves. For devnet, we keep
 * everything client-side so the math is easy to inspect.
 */

const enc = new TextEncoder();

// ─── Hash primitives ───────────────────────────────────────────────────────

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", input as BufferSource);
  return new Uint8Array(buf);
}

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, message as BufferSource);
  return new Uint8Array(sig);
}

function bytesToHex(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// ─── Seed helpers ──────────────────────────────────────────────────────────

/** Generate a fresh 32-byte seed from the platform CSPRNG. */
export function generateServerSeed(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** SHA-256 hash of a seed, in hex. This is what's published as the commitment. */
export async function hashSeed(seedHex: string): Promise<string> {
  return bytesToHex(await sha256(hexToBytes(seedHex)));
}

/**
 * Advance the seed chain by one round. This MUST be deterministic and depend
 * only on the previous (server_seed, client_seed) pair. The server cannot
 * choose server_seed_n freely.
 */
export async function advanceSeedChain(
  prevServerSeedHex: string,
  prevClientSeed: string,
): Promise<string> {
  const out = await hmacSha256(
    hexToBytes(prevServerSeedHex),
    enc.encode(prevClientSeed),
  );
  return bytesToHex(out);
}

/**
 * Derive a deterministic outcome from a committed (server_seed, client_seed,
 * nonce) triple. Both parties can recompute this independently.
 */
export async function deriveOutcome(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
): Promise<Uint8Array> {
  const msg = enc.encode(`${clientSeed}|${nonce}`);
  return hmacSha256(hexToBytes(serverSeedHex), msg);
}

// ─── Game-specific outcome buckets ─────────────────────────────────────────

export interface CoinflipParams {
  houseEdgeBps: number; // basis points; 200 = 2.00%
}

export interface CoinflipResult {
  playerWon: boolean;
  bucket: number; // [0, 10000)
  threshold: number;
  // For audit-grade reproducibility we expose the underlying 8-byte window.
  rawWindow: number;
}

/**
 * Coinflip with rejection sampling for unbiased bucketing.
 *
 * Player picks a side (Heads or Tails). On a win, they receive 2x their
 * bet (even money). The house edge is implemented by reducing the win
 * probability below 50%.
 *
 * Naive `v mod 10000` introduces a bias of up to ~1.8e-15 because 2^64
 * doesn't divide evenly by 10000. Rejection sampling discards windows
 * outside the largest multiple of 10000 ≤ 2^64, giving a perfectly uniform
 * distribution. The discard rate is negligible (~1.8e-13).
 *
 * Win probability: P(win) = 0.5 * (1 - houseEdgeBps/10000)
 *   h=0.04 (4% edge)  →  48% win rate  →  EV = 0.48*2 - 1 = -0.04
 *   h=0.02 (2% edge)  →  49% win rate  →  EV = 0.49*2 - 1 = -0.02
 *   h=0.01 (1% edge)  →  49.5% win rate
 */
export async function coinflip(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  params: CoinflipParams,
): Promise<CoinflipResult> {
  const out = await deriveOutcome(serverSeedHex, clientSeed, nonce);

  // Use 8 bytes for a 64-bit window.
  let window = 0n;
  for (let i = 0; i < 8; i++) {
    window = (window << 8n) | BigInt(out[i]);
  }

  // Rejection sampling window: max value v such that v mod 10000 is uniform.
  const maxAcceptable = (1n << 64n) - ((1n << 64n) % 10000n);
  if (window >= maxAcceptable) {
    return coinflip(serverSeedHex, clientSeed, nonce + 1, params);
  }

  const bucket = Number(window % 10000n);

  // Player wins on bucket < threshold. Threshold is 5000 - houseEdgeBps/2,
  // which gives a 0.5 * (1 - h) win rate.
  //   h=400 (4%): threshold = 5000 - 200 = 4800  →  48% wins
  //   h=200 (2%): threshold = 5000 - 100 = 4900  →  49% wins
  //   h=100 (1%): threshold = 5000 - 50  = 4950  →  49.5% wins
  const threshold = 5000 - Math.floor(params.houseEdgeBps / 2);

  return {
    playerWon: bucket < threshold,
    bucket,
    threshold,
    rawWindow: Number(window),
  };
}

// ─── Crash ─────────────────────────────────────────────────────────────────

export interface CrashParams {
  houseEdgeBps: number; // e.g. 400 = 4.00%
  maxMultiplier: number; // cap, e.g. 1000
}

export interface CrashResult {
  crashPoint: number; // multiplier at which the round crashes
}

/**
 * Crash point derivation.
 *
 * Distribution property: P(crash >= k) = (1 - h) / k for k in [1, max].
 *   h = houseEdgeBps / 10000
 *   e = uniform on [0, 2^52)
 *   crash = (100 * (1 - h)) / (1 - e / 2^52)
 *
 * The crash point is bounded by `maxMultiplier` for treasury safety.
 */
export async function crash(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  params: CrashParams,
): Promise<CrashResult> {
  const out = await deriveOutcome(serverSeedHex, clientSeed, nonce);

  // Use top 52 bits for IEEE 754 double precision.
  let e = 0n;
  for (let i = 0; i < 7; i++) {
    // 7 bytes = 56 bits; mask off the low 4 to get 52.
    e = (e << 8n) | BigInt(out[i]);
  }
  e = e >> 4n; // now e ∈ [0, 2^52)

  const h = params.houseEdgeBps / 10000;
  const denom = 1 - Number(e) / Math.pow(2, 52);
  let crashPoint = (100 * (1 - h)) / denom / 100; // = (1-h) / denom
  // The /100 /100 is to express in display units (1.00x = 1.00).

  if (crashPoint < 1) crashPoint = 1;
  if (crashPoint > params.maxMultiplier) crashPoint = params.maxMultiplier;

  return { crashPoint: Number(crashPoint.toFixed(2)) };
}

// ─── Blackjack ─────────────────────────────────────────────────────────────

export interface BlackjackResult {
  deck: number[]; // 52 entries, values 0..51, drawn in order
}

/**
 * Deterministic byte stream of arbitrary length derived from
 * (serverSeed, clientSeed, nonce). We extend the HMAC chain so the
 * caller can pull as many bytes as needed without re-deriving the
 * commit.
 *
 * Why needed: blackjackShuffle consumes one byte per Fisher-Yates swap
 * for a 52-card deck → 51 swaps → 51 bytes. A single HMAC-SHA-256 only
 * yields 32, so we chain a second HMAC keyed on the first output.
 */
export async function deriveByteStream(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  length: number,
): Promise<Uint8Array> {
  const first = await deriveOutcome(serverSeedHex, clientSeed, nonce);
  if (length <= first.length) return first.slice(0, length);
  const second = await deriveOutcome(serverSeedHex, clientSeed, nonce + 1);
  const out = new Uint8Array(length);
  out.set(first, 0);
  out.set(second.slice(0, length - first.length), first.length);
  return out;
}

/**
 * Standard 52-card deck shuffle using Fisher-Yates with an HMAC byte stream.
 *
 * The HMAC chain produces 64 bytes per round, which gives 64 swaps per pair
 * of HMAC calls. For a 52-card shuffle we need 51 swaps, so a single chain
 * step (two HMAC calls) suffices with 13 bytes of headroom.
 */
export async function blackjackShuffle(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
): Promise<BlackjackResult> {
  const stream = await deriveByteStream(serverSeedHex, clientSeed, nonce, 51);
  const deck = Array.from({ length: 52 }, (_, i) => i);

  for (let i = 51; i > 0; i--) {
    const byte = stream[51 - i];
    const j = byte % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return { deck };
}

// ─── Verification helper ───────────────────────────────────────────────────

export interface VerifiableRound {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  clientSeedHash: string;
  nonce: number;
}

export async function verifyRound(round: VerifiableRound): Promise<{
  serverSeedHashMatches: boolean;
  clientSeedHashMatches: boolean;
}> {
  const serverSeedHashMatches = (await hashSeed(round.serverSeed)) === round.serverSeedHash;
  const clientSeedHashMatches = (await hashSeed(round.clientSeed)) === round.clientSeedHash;
  return { serverSeedHashMatches, clientSeedHashMatches };
}