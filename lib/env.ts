/**
 * Typed env access. Every required key is read once at boot, in one place,
 * so a missing/invalid value fails the request rather than crashing mid-hand.
 *
 * Convention: NEXT_PUBLIC_* keys are inlined at build time and exposed to the
 * browser. Everything else stays server-only.
 */

import { z } from "zod";

const isServer = typeof window === "undefined";

const serverSchema = z.object({
  // Core
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),

  // Solana
  MAINNET_RPC_URL: z.string().url(),
  DEVNET_RPC_URL: z.string().url().optional(),
  SOLANA_NETWORK: z.enum(["mainnet-beta", "devnet"]).default("mainnet-beta"),
  // Platform treasury public key — the address withdrawals originate from.
  PLATFORM_TREASURY_PUBKEY: z.string().min(32),

  // Helius (deposit indexer webhooks + RPC)
  HELIUS_API_KEY: z.string().min(1),
  HELIUS_WEBHOOK_SECRET: z.string().min(16),

  // Session signing
  SESSION_JWT_SECRET: z.string().min(32),

  // Game service (Fly.io)
  GAME_SERVICE_URL: z.string().url(),
  GAME_SERVICE_API_KEY: z.string().min(16),

  // Treasury / Fireblocks (Phase 5 — required before production)
  FIREBLOCKS_API_KEY: z.string().optional(),
  FIREBLOCKS_API_SECRET: z.string().optional(),
  FIREBLOCKS_VAULT_ACCOUNT_ID: z.string().optional(),

  // KYC provider (Phase 6)
  KYC_PROVIDER: z.enum(["sumsub", "onfido"]).default("sumsub"),
  SUMSUB_APP_TOKEN: z.string().optional(),
  SUMSUB_SECRET_KEY: z.string().optional(),
  SUMSUB_WEBHOOK_SECRET: z.string().optional(),

  // Geofencing (Phase 7). ISO 3166-1 alpha-2 codes, comma-separated, lowercase.
  BLOCKED_COUNTRIES: z.string().default("us,gb,au,jp"),

  // Devnet-only toggle. When true, the app stays in mock-balance mode and
  // the deposit/withdrawal flows are disabled. See lib/balance.ts.
  ENABLE_MOCK_BALANCE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SOLANA_NETWORK: z.enum(["mainnet-beta", "devnet"]).default("mainnet-beta"),
  NEXT_PUBLIC_RPC_URL: z.string().url().optional(),
  NEXT_PUBLIC_PLATFORM_NAME: z.string().default("RushSol"),
});

function loadServer() {
  if (!isServer) return null;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // Print a readable summary, then throw. Failing loud at boot is the
    // whole point of this module.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  return parsed.data;
}

function loadPublic() {
  // Inlined at build time for the client bundle.
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_PLATFORM_NAME: process.env.NEXT_PUBLIC_PLATFORM_NAME,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid public env: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  }
  return parsed.data;
}

// Lazy: only call loadServer() when something on the server reads it.
export const serverEnv = loadServer();
export const publicEnv = loadPublic();
