import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaPragmaApplied?: boolean };

function createClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  // SQLite: sem WAL, escrita de telemetria concorrente com a fila gera SQLITE_BUSY.
  // "PRAGMA journal_mode" devolve uma linha com o modo resultante — exige $queryRawUnsafe.
  if (!globalForPrisma.prismaPragmaApplied) {
    globalForPrisma.prismaPragmaApplied = true;
    client
      .$queryRawUnsafe("PRAGMA journal_mode=WAL;")
      .then(() => client.$queryRawUnsafe("PRAGMA busy_timeout=5000;"))
      .catch((err) => console.error("Falha ao aplicar PRAGMA no SQLite:", err));
  }

  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Campos JSON são armazenados como string no SQLite. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
