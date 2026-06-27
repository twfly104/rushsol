import { NextResponse } from "next/server";

/**
 * Health check. Used by Vercel and Fly.io for readiness probes and by
 * uptime monitors (Better Stack, etc.). Returns env + build info so you
 * can tell at a glance whether the deployment is pointing at the right
 * network.
 *
 * No auth — this is intentionally public. Don't put secrets in the
 * response body; only env names.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    name: "rushsol-web",
    network: process.env.SOLANA_NETWORK ?? "unknown",
    mockBalance: process.env.ENABLE_MOCK_BALANCE === "true",
    build: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    },
    time: new Date().toISOString(),
  });
}
