/**
 * Append-only audit log. Never UPDATE or DELETE rows here. The application
 * database role should have INSERT-only on this table.
 */

import { Prisma, AuditAction } from "@prisma/client";
import { db } from "./db";

export interface AuditEntry {
  userId?: string | null;
  action: AuditAction;
  payload?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
}

export async function audit(entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      payload: entry.payload ?? Prisma.JsonNull,
      ip: entry.ip,
      userAgent: entry.userAgent,
    },
  });
}
