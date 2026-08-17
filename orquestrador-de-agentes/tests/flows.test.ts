import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const { resolveFlowGraph, snapshotContentHash, validateSnapshot } = await import("../src/lib/flows/snapshot.ts");
const { diffSnapshots } = await import("../src/lib/flows/diff.ts");
const { computeDrift } = await import("../src/lib/flows/drift.ts");
const { applyFlowSnapshot } = await import("../src/lib/flows/rollback.ts");
const { computeConfigHash } = await import("../src/lib/mcp.ts");

const provider = await prisma.provider.create({ data: { name: "Anthropic", kind: "anthropic" } });

async function makeAgent(overrides: {
  name: string;
  role?: string;
  providerId?: string | null;
  model?: string;
  temperature?: number;
}) {
  return prisma.agent.create({
    data: {
      role: "subagent",
      providerId: provider.id,
      model: "claude-opus-4-8",
      ...overrides,
    },
  });
}

test("resolveFlowGraph monta agentes, arestas e servidores MCP a partir da raiz", async () => {
  const child = await makeAgent({ name: "Pesquisador" });
  const root = await makeAgent({ name: "Coordenador", role: "orchestrator" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: child.id } });

  const mcp = await prisma.mcpServer.create({
    data: { name: "fs", transport: "stdio", command: "npx", args: "[]", envKeys: "[]", headerKeys: "[]" },
  });
  await prisma.agentMcpServer.create({ data: { agentId: child.id, mcpServerId: mcp.id } });

  const snapshot = await resolveFlowGraph(root.id);
  assert.ok(snapshot);
  assert.equal(snapshot!.agents.length, 2);
  assert.deepEqual(snapshot!.edges, [{ from: root.id, to: child.id, kind: "delegate" }]);
  assert.equal(snapshot!.mcpServers.length, 1);
  const childSnapshot = snapshot!.agents.find((a) => a.id === child.id)!;
  assert.deepEqual(childSnapshot.mcpServerIds, [mcp.id]);
});

test("resolveFlowGraph ignora agentes e servidores excluídos logicamente (RQ-VER-11)", async () => {
  const child = await makeAgent({ name: "Vai sumir" });
  const root = await makeAgent({ name: "Raiz", role: "orchestrator" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: child.id } });
  await prisma.agent.update({ where: { id: child.id }, data: { deletedAt: new Date() } });

  const snapshot = await resolveFlowGraph(root.id);
  assert.equal(snapshot!.agents.length, 1);
  assert.equal(snapshot!.edges.length, 0);
});

test("snapshotContentHash é estável e muda quando um parâmetro muda", async () => {
  const root = await makeAgent({ name: "Estável", role: "orchestrator" });
  const s1 = (await resolveFlowGraph(root.id))!;
  const s2 = (await resolveFlowGraph(root.id))!;
  assert.equal(snapshotContentHash(s1), snapshotContentHash(s2));

  await prisma.agent.update({ where: { id: root.id }, data: { temperature: 0.1 } });
  const s3 = (await resolveFlowGraph(root.id))!;
  assert.notEqual(snapshotContentHash(s1), snapshotContentHash(s3));
});

test("validateSnapshot recusa agente sem provedor/modelo e raiz que não é orchestrator", async () => {
  const root = await makeAgent({ name: "Sem modelo", role: "orchestrator", model: "", providerId: null });
  const snapshot = (await resolveFlowGraph(root.id))!;
  const errors = validateSnapshot(snapshot);
  assert.ok(errors.length > 0);

  const notOrchestrator = await makeAgent({ name: "Não é raiz válida" });
  const badRootSnapshot = (await resolveFlowGraph(notOrchestrator.id))!;
  const rootErrors = validateSnapshot(badRootSnapshot);
  assert.ok(rootErrors.some((e) => e.message.includes("orchestrator")));
});

test("diffSnapshots: mudar só a temperature gera exatamente uma entrada agent.changed", async () => {
  const root = await makeAgent({ name: "Diff", role: "orchestrator" });
  const before = (await resolveFlowGraph(root.id))!;

  await prisma.agent.update({ where: { id: root.id }, data: { temperature: 0.42 } });
  const after = (await resolveFlowGraph(root.id))!;

  const entries = diffSnapshots(before, after);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "agent.changed");
  assert.equal((entries[0] as { field: string }).field, "params.temperature");
});

test("diffSnapshots detecta agente adicionado, removido e vínculo MCP", async () => {
  const root = await makeAgent({ name: "Base", role: "orchestrator" });
  const before = (await resolveFlowGraph(root.id))!;

  const child = await makeAgent({ name: "Novo subagente" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: child.id } });
  const mcp = await prisma.mcpServer.create({
    data: { name: "novo-mcp", transport: "stdio", command: "npx", args: "[]", envKeys: "[]", headerKeys: "[]" },
  });
  await prisma.agentMcpServer.create({ data: { agentId: root.id, mcpServerId: mcp.id } });
  const after = (await resolveFlowGraph(root.id))!;

  const entries = diffSnapshots(before, after);
  assert.ok(entries.some((e) => e.type === "agent.added" && e.agentId === child.id));
  assert.ok(entries.some((e) => e.type === "edge.added"));
  assert.ok(entries.some((e) => e.type === "mcp.bound" && e.agentId === root.id));
});

test("computeDrift sinaliza divergência sem bloquear (RQ-VER-10)", async () => {
  const root = await makeAgent({ name: "Drift", role: "orchestrator" });
  const mcp = await prisma.mcpServer.create({
    data: { name: "drift-mcp", transport: "stdio", command: "npx", args: '["-y"]', envKeys: "[]", headerKeys: "[]" },
  });
  await prisma.mcpServer.update({
    where: { id: mcp.id },
    data: { configHash: computeConfigHash({ transport: "stdio", command: "npx", args: ["-y"], url: null, envKeys: [], headerKeys: [] }) },
  });
  await prisma.agentMcpServer.create({ data: { agentId: root.id, mcpServerId: mcp.id } });

  const snapshot = (await resolveFlowGraph(root.id))!;
  const noDrift = await computeDrift(snapshot);
  assert.equal(noDrift.configDrift, false);

  await prisma.mcpServer.update({ where: { id: mcp.id }, data: { args: '["-y", "--changed"]' } });
  const drift = await computeDrift(snapshot);
  assert.equal(drift.configDrift, true);
  assert.match(drift.driftDetail ?? "", /drift-mcp/);
});

test("applyFlowSnapshot (rollback) recria agente soft-deleted e soft-deleta o que não está no alvo", async () => {
  const child = await makeAgent({ name: "Volta depois" });
  const root = await makeAgent({ name: "Rollback raiz", role: "orchestrator" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: child.id } });
  const flow = await prisma.flow.create({ data: { name: "Fluxo", slug: `fluxo-${randomBytes(3).toString("hex")}`, rootAgentId: root.id } });
  await prisma.agent.update({ where: { id: root.id }, data: { flowId: flow.id } });

  const target = (await resolveFlowGraph(root.id))!; // v1: root + child

  // v2 ao vivo: remove o child (soft delete) e adiciona outro
  await prisma.agent.update({ where: { id: child.id }, data: { deletedAt: new Date() } });
  const other = await makeAgent({ name: "Substituto" });
  await prisma.agentLink.create({ data: { parentId: root.id, childId: other.id } });

  await applyFlowSnapshot(flow.id, root.id, target, null);

  const revived = await prisma.agent.findUnique({ where: { id: child.id } });
  assert.equal(revived?.deletedAt, null);
  const removed = await prisma.agent.findUnique({ where: { id: other.id } });
  assert.ok(removed?.deletedAt, "agente fora do snapshot alvo deve ser soft-deleted");

  const rebuilt = (await resolveFlowGraph(root.id))!;
  assert.deepEqual(
    rebuilt.agents.map((a) => a.id).sort(),
    [root.id, child.id].sort(),
  );
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
