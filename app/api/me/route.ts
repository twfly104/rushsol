import { NextResponse } from "next/server";

/**
 * GET /api/me
 *
 * Returns the player's balance in the form expected by a wallet-balance UI.
 *
 * Mock path (devnet, ENABLE_MOCK_BALANCE=true):
 *   - Returns the per-user stub from lib/balance.ts. No DB access, no
 *     network. Intended for UI iteration only.
 *
 * Real path (ENABLE_MOCK_BALANCE=false):
 *   - Reads the user id from the session cookie (TODO once session
 *     middleware is wired) and aggregates the ledger via lib/balance.ts.
 *   - If session middleware is not yet present, returns 503 so callers
 *     know to wire auth before they can ship.
 *
 * Intentionally does not deposit, withdraw, or otherwise move money. This
 * endpoint is read-only. It exists to (a) give the wallet-balance UI a
 * single source of truth once the session layer exists, and (b) keep the
 * devnet UI honest about where the number came from.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mockBalance = process.env.ENABLE_MOCK_BALANCE === "true";

  if (mockBalance) {
    const { getBalance } = await import("@/lib/balance");
    const balance = await getBalance("devnet-anonymous");
    return NextResponse.json({
      balance,
      mode: "mock",
      warning:
        "Mock balance. No real SOL is held. See project memory before going to production.",
    });
  }

  // Real path. Until session lookup is wired, we refuse — we don't want to
  // serve a "balance" without knowing whose it is.
  return NextResponse.json(
    {
      error: "session_not_wired",
      message:
        "ENABLE_MOCK_BALANCE=false but session middleware is not yet implemented. " +
        "Wire auth before calling this endpoint in production.",
    },
    { status: 503 },
  );
}