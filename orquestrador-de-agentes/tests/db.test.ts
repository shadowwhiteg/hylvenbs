import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

const { cleanup } = setupTestDb();
const { prisma } = await import("../src/lib/db.ts");

test("WAL aplicado e 4 escritas concorrentes não geram SQLITE_BUSY", async () => {
  // dá tempo do PRAGMA assíncrono do db.ts terminar antes da corrida
  await new Promise((r) => setTimeout(r, 50));

  const mode = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode;");
  assert.equal(mode[0].journal_mode, "wal");

  await assert.doesNotReject(
    Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        prisma.setting.upsert({
          where: { key: `concurrent-${i}` },
          create: { key: `concurrent-${i}`, value: "1" },
          update: { value: "2" },
        }),
      ),
    ),
  );
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
