import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Cria um SQLite descartável em /tmp, aplica as migrações e aponta DATABASE_URL
 * para ele. Precisa rodar antes de qualquer import de src/lib/db.ts (o Prisma
 * Client lê DATABASE_URL na construção do singleton).
 */
export function setupTestDb(): { dir: string; cleanup: () => void } {
  const dir = mktempDbDir();
  const dbPath = path.join(dir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64url");
  }
  execSync("npx prisma migrate deploy", { cwd: projectRoot(), stdio: "pipe" });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function mktempDbDir(): string {
  return mkdtempSync(path.join(tmpdir(), "orq-test-"));
}

function projectRoot(): string {
  // tests/helpers/testdb.ts -> raiz do projeto
  return path.resolve(import.meta.dirname, "../..");
}
