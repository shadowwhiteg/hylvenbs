import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const { resolveFlowGraph, validateSnapshot } = await import("../src/lib/flows/snapshot.ts");
const { snapshotToGraph } = await import("../src/lib/graph/build.ts");
const { AGENT_ROLES, canDelegate, canBeRoot, canBeChild, roleNoun } = await import("../src/lib/agents/roles.ts");

const provider = await prisma.provider.create({ data: { name: "Anthropic", kind: "anthropic" } });

async function makeAgent(overrides: { name: string; role?: string }) {
  return prisma.agent.create({
    data: { role: "subagent", providerId: provider.id, model: "claude-opus-4-8", ...overrides },
  });
}

test("AGENT_ROLES tem exatamente os três papéis, orquestrador -> agente -> subagente", () => {
  assert.deepEqual(AGENT_ROLES, ["orchestrator", "agent", "subagent"]);
});

test("canDelegate: orquestrador e agente delegam; subagente não (RQ-HIER-01, RQ-HIER-04)", () => {
  assert.equal(canDelegate("orchestrator"), true);
  assert.equal(canDelegate("agent"), true);
  assert.equal(canDelegate("subagent"), false);
});

test("canBeRoot: só orquestrador (RQ-HIER-03)", () => {
  assert.equal(canBeRoot("orchestrator"), true);
  assert.equal(canBeRoot("agent"), false);
  assert.equal(canBeRoot("subagent"), false);
});

test("canBeChild: qualquer papel exceto orquestrador (RQ-HIER-03)", () => {
  assert.equal(canBeChild("orchestrator"), false);
  assert.equal(canBeChild("agent"), true);
  assert.equal(canBeChild("subagent"), true);
});

test("roleNoun nomeia o papel do filho na descrição da tool de delegação", () => {
  assert.equal(roleNoun("agent"), "agente");
  assert.equal(roleNoun("subagent"), "subagente");
});

test("resolveFlowGraph desce por um agente intermediário: cadeia de três níveis entra inteira (RQ-HIER-02)", async () => {
  const leaf = await makeAgent({ name: "Especialista" });
  const middle = await makeAgent({ name: "Coordenador de domínio", role: "agent" });
  const root = await makeAgent({ name: "Raiz", role: "orchestrator" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: middle.id } });
  await prisma.agentLink.create({ data: { parentId: middle.id, childId: leaf.id } });

  const snapshot = await resolveFlowGraph(root.id);
  assert.ok(snapshot);
  assert.equal(snapshot!.agents.length, 3);
  assert.deepEqual(
    snapshot!.edges.map((e) => [e.from, e.to]),
    [
      [root.id, middle.id],
      [middle.id, leaf.id],
    ],
  );
});

test("resolveFlowGraph corta ciclo entre dois agentes intermediários mas preserva as duas arestas (RQ-HIER-06)", async () => {
  const a = await makeAgent({ name: "A", role: "agent" });
  const b = await makeAgent({ name: "B", role: "agent" });
  const root = await makeAgent({ name: "Raiz do ciclo", role: "orchestrator" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: a.id } });
  await prisma.agentLink.create({ data: { parentId: a.id, childId: b.id } });
  await prisma.agentLink.create({ data: { parentId: b.id, childId: a.id } });

  const snapshot = await resolveFlowGraph(root.id);
  assert.ok(snapshot);
  assert.equal(snapshot!.agents.length, 3);
  assert.equal(snapshot!.edges.length, 3);
});

test("um subagente com filho vinculado não desce na travessia — a capacidade vem do papel, não da topologia (RQ-HIER-04)", async () => {
  const grandchild = await makeAgent({ name: "Neto" });
  const leafWithChild = await makeAgent({ name: "Folha com vínculo herdado" });
  const root = await makeAgent({ name: "Raiz", role: "orchestrator" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: leafWithChild.id } });
  await prisma.agentLink.create({ data: { parentId: leafWithChild.id, childId: grandchild.id } });

  const snapshot = await resolveFlowGraph(root.id);
  assert.ok(snapshot);
  // A travessia não desceu a partir do subagente: só root + leafWithChild entram.
  assert.equal(snapshot!.agents.length, 2);
  assert.equal(snapshot!.edges.length, 1);
});

test("validateSnapshot recusa aresta apontando para um agente que pode ser raiz (RQ-HIER-03)", async () => {
  const innerOrchestrator = await makeAgent({ name: "Órfão de outro fluxo", role: "orchestrator" });
  const root = await makeAgent({ name: "Raiz", role: "orchestrator" });

  const snapshot = (await resolveFlowGraph(root.id))!;
  // Simula uma aresta que a API já teria recusado — validateSnapshot é a rede de segurança.
  snapshot.agents.push({ ...snapshot.agents[0]!, id: innerOrchestrator.id, name: innerOrchestrator.name, role: "orchestrator" });
  snapshot.edges.push({ from: root.id, to: innerOrchestrator.id, kind: "delegate" });

  const errors = validateSnapshot(snapshot);
  assert.ok(errors.some((e) => e.agentId === innerOrchestrator.id));
});

test("snapshotToGraph mapeia o papel agent para o tipo de nó agent, distinto de orchestrator e subagent (RQ-HIER-07)", async () => {
  const leaf = await makeAgent({ name: "Folha" });
  const middle = await makeAgent({ name: "Meio", role: "agent" });
  const root = await makeAgent({ name: "Raiz", role: "orchestrator" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: middle.id } });
  await prisma.agentLink.create({ data: { parentId: middle.id, childId: leaf.id } });

  const snapshot = (await resolveFlowGraph(root.id))!;
  const graph = snapshotToGraph(snapshot);
  const byId = new Map(graph.nodes.map((n) => [n.id, n.type]));
  assert.equal(byId.get(root.id), "orchestrator");
  assert.equal(byId.get(middle.id), "agent");
  assert.equal(byId.get(leaf.id), "subagent");
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
