import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const { API_ENDPOINTS } = await import("../src/lib/api-registry.ts");
const { TUTORIAL_STEPS } = await import("../src/lib/tutorial/content.ts");
const { resolveTutorialProgress } = await import("../src/lib/tutorial/progress.ts");

const ROOT = path.resolve(import.meta.dirname, "..");

/** Todo ProgressCheck que existe no tipo — espelha src/lib/tutorial/types.ts (RQ-TUT-03). */
const ALL_PROGRESS_CHECKS = [
  "has_provider",
  "has_mcp_server",
  "has_subagent",
  "has_intermediate_agent",
  "has_orchestrator",
  "has_published_flow",
  "has_routing_chain",
  "has_successful_run",
  "has_token",
] as const;

/** Permissões válidas — mesma lista de tests/auth.test.ts (design 001). */
const VALID_PERMISSIONS = new Set([
  "public",
  "authenticated",
  "user.manage",
  "audit.read",
  "settings.manage",
  "provider.write",
  "secret.write",
  "provider.read",
  "mcp.write",
  "mcp.probe",
  "mcp.read",
  "agent.write",
  "agent.read",
  "flow.read",
  "flow.write",
  "flow.publish",
  "flow.rollback",
  "policy.read",
  "policy.write",
  "run.create",
  "run.cancel",
  "run.read",
  "token.self",
]);

/** IDs congelados — a lista muda só se um passo for adicionado/removido deliberadamente. */
const FROZEN_STEP_IDS = [
  "provider",
  "mcp",
  "subagents",
  "intermediate-agent",
  "orchestrator",
  "publish-flow",
  "routing",
  "run",
  "token",
];

/** Resolve "/providers" -> existe src/app/providers/page.tsx (rotas dinâmicas não usadas aqui). */
function pageExistsFor(href: string): boolean {
  const segments = href.split("/").filter(Boolean);
  const file = path.join(ROOT, "src/app", ...segments, "page.tsx");
  return existsSync(file);
}

test("todo screen.href do tutorial corresponde a uma página existente (RQ-TUT-02)", () => {
  for (const step of TUTORIAL_STEPS) {
    assert.ok(pageExistsFor(step.screen.href), `${step.id}: página ausente para ${step.screen.href}`);
  }
});

test("todo endpoint citado no tutorial existe no api-registry com o mesmo método e caminho (RQ-TUT-02)", () => {
  for (const step of TUTORIAL_STEPS) {
    for (const endpoint of step.endpoints) {
      const found = API_ENDPOINTS.some((e) => e.method === endpoint.method && e.path === endpoint.path);
      assert.ok(found, `${step.id}: endpoint ${endpoint.method} ${endpoint.path} não está no api-registry`);
    }
  }
});

test("toda permission do tutorial é uma Permission válida", () => {
  for (const step of TUTORIAL_STEPS) {
    assert.ok(VALID_PERMISSIONS.has(step.permission), `${step.id}: permissão inválida ${step.permission}`);
  }
});

test("todo ProgressCheck citado no conteúdo tem resolvedor, e todo resolvedor é citado por algum passo (RQ-TUT-03)", async () => {
  const citedChecks = new Set(TUTORIAL_STEPS.flatMap((s) => s.checks));
  const resolved = await resolveTutorialProgress();
  const resolverKeys = new Set(Object.keys(resolved));

  for (const check of citedChecks) {
    assert.ok(resolverKeys.has(check), `check "${check}" citado no conteúdo sem resolvedor`);
  }
  for (const key of ALL_PROGRESS_CHECKS) {
    assert.ok(citedChecks.has(key), `resolvedor "${key}" não é citado por nenhum passo do tutorial`);
  }
});

test("ids de passo são únicos e estáveis", () => {
  const ids = TUTORIAL_STEPS.map((s) => s.id);
  assert.deepEqual(ids, FROZEN_STEP_IDS);
  assert.equal(new Set(ids).size, ids.length);
});

test("resolveTutorialProgress: banco vazio devolve tudo pendente; cadastrar provedor conclui o passo 1 (RQ-TUT-03)", async () => {
  const empty = await resolveTutorialProgress();
  assert.ok(Object.values(empty).every((v) => v === false));

  await prisma.provider.create({ data: { name: "Anthropic", kind: "anthropic" } });
  const afterProvider = await resolveTutorialProgress();
  assert.equal(afterProvider.has_provider, true);
  assert.equal(afterProvider.has_subagent, false);
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
