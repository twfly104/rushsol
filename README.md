# RushSol

Devnet-only Next.js UI scaffold for a Solana gaming platform with three games:
Coinflip, Crash, and Blackjack. Built against the Solana wallet adapter on
**devnet** — no real SOL, no custodial wallet, no production deposit flow.

## What's in scope

- Provably fair math (seed-chain model) — see `lib/provablyFair.ts`.
- Three game pages — `app/coinflip/page.tsx`, `app/crash/page.tsx`, `app/blackjack/page.tsx`.
- Wallet adapter wired to devnet RPC (Phantom + Solflare).
- Round log + audit trail helpers — `lib/roundLog.ts`, `lib/clientAudit.ts`.
- Independent verification UI at `/verify`.
- Mock balance provider so the games have something to debit/credit during devnet play.

## What's explicitly out of scope (for now)

- A production deposit/withdrawal flow that accepts real SOL.
- KYC, geofencing, RNG audit docs, license application drafting.
- Operator anonymization or jurisdictional evasion of any kind.

The licensing path (Anjouan/Curacao) is on hold until the devnet product is
solid and we revisit the discussion. **Do not point this build at mainnet or
accept real SOL until the gambling-class license is verified.**

## Run it locally

```bash
npm install
npm run dev
```

Connect Phantom (or Solflare) in **devnet** mode. The "balance" you see in the
UI is an in-memory mock — refreshing the page resets it. Set rounds and audit
entries persist in `localStorage` so they survive page refreshes.

`.env.local` is already created in this repo with `ENABLE_MOCK_BALANCE=true`
and `NEXT_PUBLIC_SOLANA_NETWORK=devnet`. To start over, edit that file.

## Tests

```bash
npm test           # one-shot vitest run
npm run test:watch # interactive
npm run test:cov   # with v8 coverage
npm run typecheck  # tsc --noEmit
```

The test suite covers the provably-fair math end-to-end: seed generation,
hash determinism, the hedged seed-chain, coinflip bucket distribution, crash
multiplier bounds, blackjack shuffle permutation invariant, and the
verify-round roundtrip. **A real bug in the blackjack shuffle was caught by
this suite on first run** — the original implementation read bytes 32–50 of a
32-byte HMAC output, silently corrupting ~37% of cards per shuffle.

## Provably fair model

This project uses a **hedged seed-chain** model, not the naive "commit server
seed hash, then reveal" pattern. The naive pattern is grindable: the server
can precompute many server seeds and pick the one whose hash combines with
the user's eventual client seed to produce a winning outcome for a bet it
knows is coming.

The hedged model:

```
server_seed_n   = HMAC-SHA256(server_seed_(n-1), client_seed_(n-1))
server_seed_hash_n = SHA-256(server_seed_n)
outcome_n       = HMAC-SHA256(server_seed_n, client_seed_n || nonce_n)
```

The player commits `SHA-256(client_seed_n)` *before* the server reveals
`server_seed_hash_n`. The server has no degrees of freedom at round n because
`server_seed_n` is fully determined by previous committed values.

Audit math, rejection-sampling variants for unbiased bucketing, and the
game-specific outcome derivations are documented inline in `lib/provablyFair.ts`.

## Deploy to Vercel

The devnet build deploys to **Vercel Hobby** (free tier) on every push to
`main`. The deploy is non-money-moving — it serves the devnet UI to anyone
with the URL, but `ENABLE_MOCK_BALANCE=true` keeps every real-money code
path dormant.

### One-time setup

1. Push this repo to GitHub.
2. Create a new Vercel project at <https://vercel.com/new> and import the
   repo. Vercel auto-detects Next.js; the framework preset is already set
   in `vercel.json`.
3. In the Vercel dashboard → **Settings → Environment Variables**, set:

   | Name | Value | Required for devnet? |
   |---|---|---|
   | `ENABLE_MOCK_BALANCE` | `true` | **Yes** — keeps every DB and money path off |
   | `NEXT_PUBLIC_SOLANA_NETWORK` | `devnet` | **Yes** — Phantom/Solflare connect to devnet |
   | `NEXT_PUBLIC_PLATFORM_NAME` | `RushSol` | Optional |
   | `SESSION_JWT_SECRET` | (random 32+ chars) | Optional — only when session middleware is wired |
   | `DATABASE_URL`, `HELIUS_API_KEY`, `FIREBLOCKS_*`, `SUMSUB_*`, `BLOCKED_COUNTRIES`, `PLATFORM_TREASURY_PUBKEY` | — | **No.** Leave blank for devnet. Adding these will not move money (the mock path doesn't use them) but they signal you're pointing at prod. |

4. Deploy. Vercel runs the build command from `vercel.json`, which is
   `next build` (no `prisma generate`). The devnet deploy doesn't need
   the Prisma client generated — `ENABLE_MOCK_BALANCE=true` keeps every
   DB code path dormant, and the default `@prisma/client` runtime exports
   the stubs `lib/db.ts` references. To switch to a real-money build,
   prefix `buildCommand` with `prisma generate &&` and provision
   `DATABASE_URL` (Neon / Supabase / Vercel Postgres) in the dashboard.

### What Vercel serves

- **Static pages** (`/`, `/coinflip`, `/crash`, `/blackjack`, `/verify`) are
  pre-rendered and served from Vercel's global CDN.
- **API routes** (`/api/health`, `/api/me`) run as serverless functions in
  `sin1` (Singapore). Hobby is single-region for Functions; static pages
  are still global. Switch region by editing `vercel.json`.

### Verifying a live deploy

Once you have the URL (e.g. `rushsol-dev.vercel.app`):

```bash
curl https://<your-url>/api/health
# → {"ok":true, ..., "mockBalance": true, "network":"devnet"}

curl https://<your-url>/api/me
# → {"balance":{"available":10,"pendingDeposits":0,...,"currency":"SOL"},
#    "mode":"mock",
#    "warning":"Mock balance. No real SOL is held. ..."}
```

If `mockBalance` is anything but `true`, you have pointed a deploy at
production env and the safety gate is off. Roll back immediately via
`vercel rollback` in the dashboard.

### What stays mocked (do not remove)

- Balance: in-memory mock starting at 10 SOL. No deposits are detected.
- Audit log: `localStorage`-backed client only. No server-side writes.
- Round log: `localStorage`-backed client only.
- RNG: client-computed; the server sees nothing.

The Prisma schema, `lib/balance.ts`, `lib/audit.ts`, and `lib/db.ts` exist as
production scaffolds but are not wired in. Once the gambling-class license
is verified and you intend to accept real SOL, the wiring path is documented
inline in each module — start by setting `ENABLE_MOCK_BALANCE=false`,
provisioning a Postgres instance, and running `prisma migrate deploy`.

## CI

`.github/workflows/ci.yml` runs on every PR and every push to `main`:

1. **Test & lint** — `tsc --noEmit`, `next lint`, `vitest run`.
2. **Production build** — `next build` (gated on test passing).

Both jobs use Node 22 to match the dev environment. Failures here block
merge to `main`, so the Vercel deploy never sees a broken commit.