/**
 * Browser-side audit logger (devnet-safe stand-in).
 *
 * Mirrors the call signature of lib/audit.ts (audit({action, payload, ...}))
 * so the production swap-in is one-file: replace these functions with a
 * POST to /api/audit that calls into the real server logger.
 *
 * The action enum here is a subset of the server AuditAction enum, narrowed
 * to events the client can legitimately observe (bet placement / resolution,
 * geofence blocks). Events that only the server should ever log (KYC, KYC
 * provider callbacks, withdrawal broadcast, admin actions) are deliberately
 * absent from this client enum.
 *
 * Storage: a capped ring buffer in localStorage. Per the schema.prisma
 * comments, AuditLog on the server is INSERT-only and append-only; we match
 * that on the client (entries are never mutated or deleted, only rotated
 * when capacity is hit).
 */

import type { Prisma } from "@prisma/client";

// Re-export only the actions a client may legitimately emit.
export type ClientAuditAction =
  | "BET_PLACED"
  | "BET_RESOLVED"
  | "BET_VOIDED"
  | "GEO_BLOCKED";

export interface ClientAuditEntry {
  action: ClientAuditAction;
  payload?: Prisma.InputJsonValue;
  // userId intentionally omitted — the client doesn't know its own server
  // id. Server-side, the user is looked up from the session cookie.
  ts: number; // epoch ms
}

const STORAGE_KEY = "rushsol:audit";
const MAX_ENTRIES = 500;

function read(): ClientAuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClientAuditEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: ClientAuditEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best effort — see lib/roundLog.ts for the same trade-off.
  }
}

/**
 * Append an audit entry. Never throws; failures degrade silently because
 * client-side audit is best-effort diagnostics, not a compliance system.
 */
export function audit(entry: Omit<ClientAuditEntry, "ts">): void {
  const next: ClientAuditEntry = { ...entry, ts: Date.now() };
  const all = [next, ...read()].slice(0, MAX_ENTRIES);
  write(all);
}

/** Read-only view for debugging — not used by any UI today. */
export function getAuditLog(limit = 50): ClientAuditEntry[] {
  return read().slice(0, limit);
}

export function clearAuditLog(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
