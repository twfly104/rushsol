import { describe, it, expect } from "vitest";
import {
  generateServerSeed,
  hashSeed,
  advanceSeedChain,
  deriveOutcome,
  coinflip,
  crash,
  blackjackShuffle,
  verifyRound,
} from "@/lib/provablyFair";

// ─── Seed generation ─────────────────────────────────────────────────────

describe("generateServerSeed", () => {
  it("returns a 64-char hex string (32 bytes)", () => {
    const seed = generateServerSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces distinct seeds across many calls", () => {
    const n = 1000;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(generateServerSeed());
    // Birthday paradox at n=1000 is irrelevant; collision probability is
    // ~ 1.7e-58. We allow a small slack only to detect a broken RNG, not
    // noise. Expect n distinct.
    expect(seen.size).toBe(n);
  });
});

// ─── hashSeed ─────────────────────────────────────────────────────────────

describe("hashSeed", () => {
  it("is deterministic", async () => {
    const a = await hashSeed("00".repeat(32));
    const b = await hashSeed("00".repeat(32));
    expect(a).toBe(b);
  });

  it("returns 64 hex chars", async () => {
    const h = await hashSeed("ff".repeat(32));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SHA-256 matches the known test vector for empty input", async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const h = await hashSeed("");
    expect(h).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("different seeds hash to different digests", async () => {
    const a = await hashSeed("aa".repeat(32));
    const b = await hashSeed("bb".repeat(32));
    expect(a).not.toBe(b);
  });
});

// ─── Seed chain ───────────────────────────────────────────────────────────

describe("advanceSeedChain", () => {
  it("is deterministic for a given (prevServer, prevClient) pair", async () => {
    const a = await advanceSeedChain("11".repeat(32), "alice");
    const b = await advanceSeedChain("11".repeat(32), "alice");
    expect(a).toBe(b);
  });

  it("changes if the client seed changes", async () => {
    const a = await advanceSeedChain("11".repeat(32), "alice");
    const b = await advanceSeedChain("11".repeat(32), "bob");
    expect(a).not.toBe(b);
  });

  it("changes if the server seed changes", async () => {
    const a = await advanceSeedChain("11".repeat(32), "alice");
    const b = await advanceSeedChain("22".repeat(32), "alice");
    expect(a).not.toBe(b);
  });
});

// ─── deriveOutcome ────────────────────────────────────────────────────────

describe("deriveOutcome", () => {
  it("is deterministic across (server, client, nonce)", async () => {
    const a = await deriveOutcome("33".repeat(32), "alice", 7);
    const b = await deriveOutcome("33".repeat(32), "alice", 7);
    expect(a).toEqual(b);
  });

  it("nonce 0 vs nonce 1 produce different 32-byte outputs", async () => {
    const a = await deriveOutcome("33".repeat(32), "alice", 0);
    const b = await deriveOutcome("33".repeat(32), "alice", 1);
    expect(a).not.toEqual(b);
  });

  it("returns exactly 32 bytes", async () => {
    const out = await deriveOutcome("33".repeat(32), "alice", 0);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(32);
  });
});

// ─── coinflip ─────────────────────────────────────────────────────────────

describe("coinflip", () => {
  const server = "44".repeat(32);
  const client = "client-seed";

  it("threshold follows houseEdgeBps: 0% → 5000, 4% → 4800, 2% → 4900", async () => {
    const a = await coinflip(server, client, 1, { houseEdgeBps: 0 });
    const b = await coinflip(server, client, 2, { houseEdgeBps: 400 });
    const c = await coinflip(server, client, 3, { houseEdgeBps: 200 });
    expect(a.threshold).toBe(5000);
    expect(b.threshold).toBe(4800);
    expect(c.threshold).toBe(4900);
  });

  it("bucket is in [0, 10000)", async () => {
    for (let i = 0; i < 50; i++) {
      const r = await coinflip(server, client, i + 10, { houseEdgeBps: 400 });
      expect(r.bucket).toBeGreaterThanOrEqual(0);
      expect(r.bucket).toBeLessThan(10000);
    }
  });

  it("win rate at 4% house edge lands near 48% (within 5pp over 5000 rounds)", async () => {
    let wins = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      const r = await coinflip(server, client, i, { houseEdgeBps: 400 });
      if (r.playerWon) wins++;
    }
    const rate = wins / n;
    // Expected: 0.48. Allow 5pp slack because n=5000 has a stddev of
    // sqrt(0.48*0.52/5000) ≈ 0.0071 → 99.99% CI within ~0.04.
    expect(rate).toBeGreaterThan(0.43);
    expect(rate).toBeLessThan(0.53);
  });

  it("win/loss decisions are deterministic for the same (server, client, nonce)", async () => {
    const a = await coinflip(server, client, 42, { houseEdgeBps: 400 });
    const b = await coinflip(server, client, 42, { houseEdgeBps: 400 });
    expect(a.playerWon).toBe(b.playerWon);
    expect(a.bucket).toBe(b.bucket);
  });
});

// ─── crash ────────────────────────────────────────────────────────────────

describe("crash", () => {
  const server = "55".repeat(32);
  const client = "client-seed";

  it("crash point is always ≥ 1.00", async () => {
    for (let i = 0; i < 200; i++) {
      const r = await crash(server, client, i, {
        houseEdgeBps: 400,
        maxMultiplier: 1000,
      });
      expect(r.crashPoint).toBeGreaterThanOrEqual(1);
    }
  });

  it("crash point respects maxMultiplier", async () => {
    const n = 200;
    for (let i = 0; i < n; i++) {
      const r = await crash(server, client, i, {
        houseEdgeBps: 400,
        maxMultiplier: 10,
      });
      expect(r.crashPoint).toBeLessThanOrEqual(10);
    }
  });

  it("is deterministic for fixed inputs", async () => {
    const a = await crash(server, client, 99, {
      houseEdgeBps: 400,
      maxMultiplier: 1000,
    });
    const b = await crash(server, client, 99, {
      houseEdgeBps: 400,
      maxMultiplier: 1000,
    });
    expect(a.crashPoint).toBe(b.crashPoint);
  });

  it("median crash is around the target (~10s = ~2x for the default growth)", async () => {
    // Default per-page settings: 4% edge, 1000x cap. Sample many nonces;
    // the median should sit near the design median of ~2x.
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const r = await crash(server, client, i, {
        houseEdgeBps: 400,
        maxMultiplier: 1000,
      });
      samples.push(r.crashPoint);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    // 4% edge → P(crash ≥ 2) = 0.96 / 2 = 0.48 → median sits near 2x.
    // Allow a wide slack (1.0–3.0) — the spec is "around the median".
    expect(median).toBeGreaterThan(1.0);
    expect(median).toBeLessThan(3.0);
  });
});

// ─── blackjackShuffle ─────────────────────────────────────────────────────

describe("blackjackShuffle", () => {
  const server = "66".repeat(32);
  const client = "client-seed";

  it("returns a permutation of [0..51]", async () => {
    const { deck } = await blackjackShuffle(server, client, 1);
    expect(deck).toHaveLength(52);
    const sorted = [...deck].sort((a, b) => a - b);
    for (let i = 0; i < 52; i++) expect(sorted[i]).toBe(i);
  });

  it("is deterministic for fixed inputs", async () => {
    const a = await blackjackShuffle(server, client, 5);
    const b = await blackjackShuffle(server, client, 5);
    expect(a.deck).toEqual(b.deck);
  });

  it("different nonces produce different shuffles (collision unlikely over 100 trials)", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { deck } = await blackjackShuffle(server, client, i + 100);
      seen.add(deck.join(","));
    }
    // 100 random 52-permutations: collisions astronomically unlikely.
    expect(seen.size).toBe(100);
  });
});

// ─── verifyRound ──────────────────────────────────────────────────────────

describe("verifyRound", () => {
  it("returns true/true when the seeds and hashes match", async () => {
    const serverSeed = generateServerSeed();
    const serverSeedHash = await hashSeed(serverSeed);
    // clientSeed is also hex-decoded inside hashSeed, so it must be a
    // valid hex string (the verify page validates input before recomputing).
    const clientSeed = "aa".repeat(32);
    const clientSeedHash = await hashSeed(clientSeed);
    const r = await verifyRound({
      serverSeed,
      serverSeedHash,
      clientSeed,
      clientSeedHash,
      nonce: 0,
    });
    expect(r.serverSeedHashMatches).toBe(true);
    expect(r.clientSeedHashMatches).toBe(true);
  });

  it("returns false when the server seed has been swapped", async () => {
    const realSeed = generateServerSeed();
    const fakeSeed = generateServerSeed();
    const commit = await hashSeed(realSeed);
    const clientSeed = "bb".repeat(32);
    const r = await verifyRound({
      serverSeed: fakeSeed,
      serverSeedHash: commit,
      clientSeed,
      clientSeedHash: await hashSeed(clientSeed),
      nonce: 0,
    });
    expect(r.serverSeedHashMatches).toBe(false);
    expect(r.clientSeedHashMatches).toBe(true);
  });
});

// ─── End-to-end commitment check ──────────────────────────────────────────

describe("end-to-end: commitment integrity", () => {
  it("the same outcome reproduces from (serverSeed, clientSeed, nonce) — provably fair invariant", async () => {
    const serverSeed = generateServerSeed();
    const clientSeed = "audit-round";
    const nonce = 17;

    // Both "player" and "auditor" compute the crash outcome independently
    // from the published seeds. They must agree.
    const auditor = await crash(serverSeed, clientSeed, nonce, {
      houseEdgeBps: 400,
      maxMultiplier: 1000,
    });
    const player = await crash(serverSeed, clientSeed, nonce, {
      houseEdgeBps: 400,
      maxMultiplier: 1000,
    });
    expect(auditor.crashPoint).toBe(player.crashPoint);
  });
});