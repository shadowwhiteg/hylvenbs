import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const { resolveChain } = await import("../src/lib/routing/resolve.ts");
const { isFailoverable } = await import("../src/lib/routing/failover.ts");
const { orderByAvailability, recordFailure, recordSuccess, loadHealth, healthKey } = await import("../src/lib/routing/health.ts");
const { resolveFlowGraph, chainFor } = await import("../src/lib/flows/snapshot.ts");
const { diffSnapshots } = await import("../src/lib/flows/diff.ts");

function candidate(over: {
  id: string;
  taskType?: string;
  rank?: number;
  providerId?: string;
  model: string;
  enabled?: boolean;
}) {
  return {
    id: over.id,
    taskType: over.taskType ?? "default",
    rank: over.rank ?? 0,
    providerId: over.providerId ?? "prov1",
    model: over.model,
    maxTokens: null,
    temperature: null,
    enabled: over.enabled ?? true,
  };
}

test("resolveChain ordena por rank e resolve empate pelo id (RQ-ROT-05)", () => {
  const chain = resolveChain(
    {
      agentCandidates: [
        candidate({ id: "b", rank: 1, model: "segundo" }),
        candidate({ id: "a", rank: 0, model: "primeiro" }),
        // Empate de rank com "a" — o id desempata, de forma determinística.
        candidate({ id: "aa", rank: 0, model: "empatado" }),
      ],
      policyCandidates: [],
      fallbackProviderId: null,
      fallbackModel: "",
    },
    "default",
  );
  assert.deepEqual(chain.map((c) => c.model), ["primeiro", "empatado", "segundo"]);
});

test("resolveChain: candidatos do agente prevalecem sobre a política (RQ-ROT-03)", () => {
  const chain = resolveChain(
    {
      agentCandidates: [candidate({ id: "a", model: "do-agente" })],
      policyCandidates: [candidate({ id: "p", model: "da-politica" })],
      fallbackProviderId: null,
      fallbackModel: "",
    },
    "default",
  );
  assert.deepEqual(chain.map((c) => c.model), ["do-agente"]);
});

test("resolveChain escolhe a cadeia do tipo de tarefa pedido (RQ-ROT-04)", () => {
  const input = {
    agentCandidates: [],
    policyCandidates: [
      candidate({ id: "r", taskType: "reasoning", model: "opus" }),
      candidate({ id: "d", taskType: "default", model: "haiku" }),
    ],
    fallbackProviderId: null,
    fallbackModel: "",
  };
  assert.deepEqual(resolveChain(input, "reasoning").map((c) => c.model), ["opus"]);
  assert.deepEqual(resolveChain(input, undefined).map((c) => c.model), ["haiku"]);
  // Tipo não declarado cai para "default".
  assert.deepEqual(resolveChain(input, "inexistente").map((c) => c.model), ["haiku"]);
});

test("resolveChain: agente sem candidatos usa o modelo único (RQ-ROT-12)", () => {
  const chain = resolveChain(
    { agentCandidates: [], policyCandidates: [], fallbackProviderId: "prov1", fallbackModel: "unico" },
    "default",
  );
  assert.deepEqual(chain.map((c) => c.model), ["unico"]);
  assert.equal(chain[0]!.candidateId, null);
});

test("resolveChain anexa o modelo único ao fim, sem duplicar", () => {
  const withDuplicate = resolveChain(
    {
      agentCandidates: [candidate({ id: "a", model: "mesmo", providerId: "prov1" })],
      policyCandidates: [],
      fallbackProviderId: "prov1",
      fallbackModel: "mesmo",
    },
    "default",
  );
  assert.equal(withDuplicate.length, 1, "não duplica o mesmo par provedor+modelo");

  const withFallback = resolveChain(
    {
      agentCandidates: [candidate({ id: "a", model: "outro", providerId: "prov1" })],
      policyCandidates: [],
      fallbackProviderId: "prov1",
      fallbackModel: "unico",
    },
    "default",
  );
  assert.deepEqual(withFallback.map((c) => c.model), ["outro", "unico"]);
});

test("resolveChain ignora candidatos desabilitados", () => {
  const chain = resolveChain(
    {
      agentCandidates: [
        candidate({ id: "a", rank: 0, model: "desligado", enabled: false }),
        candidate({ id: "b", rank: 1, model: "ligado" }),
      ],
      policyCandidates: [],
      fallbackProviderId: null,
      fallbackModel: "",
    },
    "default",
  );
  assert.deepEqual(chain.map((c) => c.model), ["ligado"]);
});

test("isFailoverable: só indisponibilidade troca de candidato (RQ-ROT-06/07)", () => {
  assert.equal(isFailoverable("provider_rate_limit"), true);
  assert.equal(isFailoverable("provider_error", 503), true);
  assert.equal(isFailoverable("provider_error", 404), true, "modelo inexistente → próximo candidato");
  assert.equal(isFailoverable("provider_error", 401), true, "credencial inválida → próximo candidato");
  assert.equal(isFailoverable("provider_error", 400), false, "requisição malformada falha igual no próximo");
  assert.equal(isFailoverable("cancelled"), false);
  assert.equal(isFailoverable("timeout"), false);
  assert.equal(isFailoverable("validation_error"), false);
});

test("orderByAvailability desprioriza sem remover, preservando a ordem (RQ-ROT-08)", () => {
  const chain = [
    { candidateId: "a", providerId: "p", model: "primeiro", maxTokens: null, temperature: null, rank: 0 },
    { candidateId: "b", providerId: "p", model: "segundo", maxTokens: null, temperature: null, rank: 1 },
    { candidateId: "c", providerId: "p", model: "terceiro", maxTokens: null, temperature: null, rank: 2 },
  ];
  const future = new Date(Date.now() + 60_000);
  const health = new Map([
    [healthKey("p", "primeiro"), { providerId: "p", model: "primeiro", consecutiveFailures: 3, cooldownUntil: future }],
  ]);

  const ordered = orderByAvailability(chain, health);
  assert.deepEqual(ordered.map((c) => c.model), ["segundo", "terceiro", "primeiro"]);
  assert.equal(ordered.length, chain.length, "nenhum candidato é descartado");

  // Carência vencida devolve o candidato à posição original.
  const past = new Map([
    [healthKey("p", "primeiro"), { providerId: "p", model: "primeiro", consecutiveFailures: 3, cooldownUntil: new Date(Date.now() - 1) }],
  ]);
  assert.deepEqual(orderByAvailability(chain, past).map((c) => c.model), ["primeiro", "segundo", "terceiro"]);
});

test("recordFailure abre carência após falhas seguidas; recordSuccess fecha", async () => {
  const provider = await prisma.provider.create({ data: { name: "P", kind: "anthropic" } });
  const chain = [
    { candidateId: null, providerId: provider.id, model: "m1", maxTokens: null, temperature: null, rank: 0 },
  ];

  await recordFailure(provider.id, "m1", "provider_error", "500");
  let health = await loadHealth(chain);
  assert.equal(health.get(healthKey(provider.id, "m1"))?.cooldownUntil, null, "uma falha ainda não abre carência");

  await recordFailure(provider.id, "m1", "provider_error", "500");
  health = await loadHealth(chain);
  const cooldown = health.get(healthKey(provider.id, "m1"))?.cooldownUntil;
  assert.ok(cooldown && cooldown.getTime() > Date.now(), "segunda falha abre carência");

  await recordSuccess(provider.id, "m1");
  health = await loadHealth(chain);
  assert.equal(health.get(healthKey(provider.id, "m1"))?.cooldownUntil, null);
  assert.equal(health.get(healthKey(provider.id, "m1"))?.consecutiveFailures, 0);
});

test("snapshot congela a cadeia por tipo de tarefa e o diff detecta a mudança (RQ-ROT-10)", async () => {
  const provider = await prisma.provider.create({ data: { name: "Anthropic", kind: "anthropic" } });
  const policy = await prisma.modelPolicy.create({
    data: {
      name: "Pesada",
      slug: `pesada-${randomBytes(3).toString("hex")}`,
      candidates: {
        create: [
          { taskType: "default", rank: 0, providerId: provider.id, model: "opus" },
          { taskType: "default", rank: 1, providerId: provider.id, model: "sonnet" },
        ],
      },
    },
  });
  const root = await prisma.agent.create({
    data: {
      name: "Raiz",
      role: "orchestrator",
      providerId: provider.id,
      model: "opus",
      modelPolicyId: policy.id,
    },
  });

  const before = (await resolveFlowGraph(root.id))!;
  const agentBefore = before.agents[0]!;
  assert.deepEqual(chainFor(agentBefore, "default").map((c) => c.model), ["opus", "sonnet"]);

  // Inverter a prioridade na política precisa aparecer como mudança estrutural.
  await prisma.modelCandidate.updateMany({ where: { policyId: policy.id, model: "opus" }, data: { rank: 5 } });
  const after = (await resolveFlowGraph(root.id))!;
  assert.deepEqual(chainFor(after.agents[0]!, "default").map((c) => c.model), ["sonnet", "opus"]);

  const entries = diffSnapshots(before, after);
  assert.ok(
    entries.some((e) => e.type === "agent.changed" && (e as { field: string }).field === "routing.chains"),
    "diff precisa registrar a troca de prioridade",
  );
});

test("chainFor cai para default quando o tipo pedido não existe no snapshot", async () => {
  const provider = await prisma.provider.create({ data: { name: "P2", kind: "anthropic" } });
  const root = await prisma.agent.create({
    data: { name: "Solo", role: "orchestrator", providerId: provider.id, model: "unico" },
  });
  const snapshot = (await resolveFlowGraph(root.id))!;
  const agent = snapshot.agents[0]!;

  assert.deepEqual(chainFor(agent, "inexistente").map((c) => c.model), ["unico"]);
  assert.deepEqual(chainFor(agent, null).map((c) => c.model), ["unico"]);
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
