/**
 * Balance computation. The single source of truth is the ledger (deposits
 * minus withdrawals minus net loss to the house over time). The browser
 * never sees this number directly; it queries /api/me which calls us.
 *
 * Mock mode: when ENABLE_MOCK_BALANCE=true we return a per-user mock value
 * stored on the user record. This is what the devnet demo uses.
 */

import { db } from "./db";

export interface Balance {
  available: number; // SOL, can be wagered
  pendingDeposits: number; // SOL in `pending` deposits
  pendingWithdrawals: number; // SOL in `pending` withdrawals
  currency: "SOL";
}

export async function getBalance(userId: string): Promise<Balance> {
  // Mock mode for devnet.
  if (process.env.ENABLE_MOCK_BALANCE === "true") {
    // The mock is per-user but stored in-memory for now. Real prod runs
    // ENABLE_MOCK_BALANCE=false and never enters this branch.
    return {
      available: 10,
      pendingDeposits: 0,
      pendingWithdrawals: 0,
      currency: "SOL",
    };
  }

  // Aggregate ledger in a single query. The casts are safe: Decimal -> string
  // -> number is fine for SOL precision in this app (9 decimals max).
  const [depositsConfirmed, withdrawalsConfirmed, betsNet] = await Promise.all([
    db.deposit.aggregate({
      where: { userId, status: "CONFIRMED" },
      _sum: { amount: true },
    }),
    db.withdrawal.aggregate({
      where: { userId, status: "CONFIRMED" },
      _sum: { amount: true, fee: true },
    }),
    db.bet.aggregate({
      where: { userId, status: "RESOLVED" },
      _sum: { betAmount: true, payout: true },
    }),
  ]);

  const [pendingDeps, pendingWdrs] = await Promise.all([
    db.deposit.aggregate({
      where: { userId, status: "PENDING" },
      _sum: { amount: true },
    }),
    db.withdrawal.aggregate({
      where: { userId, status: "PENDING" },
      _sum: { amount: true },
    }),
  ]);

  const totalIn = Number(depositsConfirmed._sum.amount ?? 0);
  const totalOut = Number(withdrawalsConfirmed._sum.amount ?? 0) +
    Number(withdrawalsConfirmed._sum.fee ?? 0);
  const totalWagered = Number(betsNet._sum.betAmount ?? 0);
  const totalPaidOut = Number(betsNet._sum.payout ?? 0);

  // House net loss to this user = amount paid out - amount wagered.
  // Available = money in - money out - house net gain on this user.
  //   = totalIn - totalOut - (totalWagered - totalPaidOut)
  const available = totalIn - totalOut - (totalWagered - totalPaidOut);

  return {
    available: Math.max(0, available),
    pendingDeposits: Number(pendingDeps._sum.amount ?? 0),
    pendingWithdrawals: Number(pendingWdrs._sum.amount ?? 0),
    currency: "SOL",
  };
}
