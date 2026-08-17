import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { globSync } from "node:fs";

/**
 * decrypt() só pode ser chamado nos dois adaptadores que falam com o mundo
 * externo (providers.ts, mcp.ts) e nos scripts de manutenção de segredos.
 * Qualquer outro chamador é um vazamento em potencial — ver design 005.
 */
const ROOT = path.resolve(import.meta.dirname, "..");

const ALLOWED = [
  "src/lib/providers.ts",
  "src/lib/mcp.ts",
  "src/lib/crypto/secrets.ts", // definição, não chamada
  "scripts/migrate-secrets.ts",
  "scripts/rotate-keys.ts",
].map((p) => path.join(ROOT, p));

test("decrypt( só aparece nos arquivos permitidos", () => {
  const files = globSync("{src,scripts}/**/*.{ts,tsx}", { cwd: ROOT }).map((f) => path.join(ROOT, f));

  const offenders: string[] = [];
  for (const file of files) {
    if (ALLOWED.includes(file)) continue;
    const content = readFileSync(file, "utf8");
    if (/\bdecrypt\(/.test(content)) offenders.push(path.relative(ROOT, file));
  }

  assert.deepEqual(offenders, []);
});

/**
 * `role === "orchestrator"` empacotava três decisões diferentes até o design 008
 * (descer no grafo, poder delegar, ser raiz de fluxo). Fora de `roles.ts`, comparar
 * `role` com um literal é o acoplamento voltando — a intenção deve passar por
 * `canDelegate`/`canBeRoot`/`canBeChild`. Rotulagem de UI (`.tsx`) fica de fora: ali
 * o literal só decide texto/estilo, nunca comportamento.
 */
const ROLE_PREDICATE_ALLOWED = ["src/lib/agents/roles.ts"].map((p) => path.join(ROOT, p));

test("comparação de role com literal só existe em roles.ts (fora de .tsx)", () => {
  const files = globSync("src/**/*.ts", { cwd: ROOT }).map((f) => path.join(ROOT, f));

  const offenders: string[] = [];
  for (const file of files) {
    if (ROLE_PREDICATE_ALLOWED.includes(file)) continue;
    const content = readFileSync(file, "utf8");
    if (/\brole\s*(===|!==)\s*["'](orchestrator|agent|subagent)["']/.test(content)) {
      offenders.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(offenders, []);
});
