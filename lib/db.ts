import { PrismaClient } from "@prisma/client";

/**
 * Single PrismaClient per Node process. Next.js dev mode hot-reloads modules,
 * so we cache on globalThis to avoid spawning dozens of clients.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
