"use client";

import { createContext, useContext, useState, ReactNode } from "react";

/**
 * Devnet-only mock balance store.
 *
 * This is intentionally NOT a real deposit system. It exists so the games
 * have something to deduct from and credit to during UI development. The
 * real deposit/withdrawal flow that accepts actual SOL is explicitly out of
 * scope for the devnet build (see README and project memory).
 *
 * Production note: when we wire up real custody, this module is replaced
 * with a server-backed balance ledger tied to verified deposit transactions.
 */

interface MockBalanceContext {
  balance: number;
  credit: (amount: number) => void;
  debit: (amount: number) => boolean;
  reset: () => void;
}

const Ctx = createContext<MockBalanceContext | null>(null);

export function MockBalanceProvider({ children }: { children: ReactNode }) {
  const [balance, setBalance] = useState(10); // 10 SOL starting balance for devnet play

  const credit = (amount: number) => setBalance((b) => b + amount);
  const debit = (amount: number) => {
    if (balance < amount) return false;
    setBalance((b) => b - amount);
    return true;
  };
  const reset = () => setBalance(10);

  return (
    <Ctx.Provider value={{ balance, credit, debit, reset }}>{children}</Ctx.Provider>
  );
}

export function useMockBalance() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMockBalance must be used inside MockBalanceProvider");
  return ctx;
}