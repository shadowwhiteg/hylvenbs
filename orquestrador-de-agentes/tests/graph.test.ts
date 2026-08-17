import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutGraph } from "../src/lib/graph/layout.ts";
import { buildRuntime } from "../src/lib/graph/runtime.ts";

test("layoutGraph: mesma topologia produz coordenadas idênticas (RQ-VIS-02)", () => {
  const nodeIds = ["root", "a", "b", "mcp"];
  const edges = [
    { id: "e1", from: "root", to: "a", kind: "delegate" },
    { id: "e2", from: "root", to: "b", kind: "delegate" },
    { id: "e3", from: "a", to: "mcp", kind: "tool" },
  ];

  const l1 = layoutGraph(nodeIds, edges, "root");
  const l2 = layoutGraph(nodeIds, edges, "root");

  for (const id of nodeIds) {
    assert.deepEqual(l1.positions.get(id), l2.positions.get(id));
  }
});

test("layoutGraph: sem sobreposição entre nós", () => {
  const nodeIds = ["root", "a", "b", "c"];
  const edges = [
    { id: "e1", from: "root", to: "a", kind: "delegate" },
    { id: "e2", from: "root", to: "b", kind: "delegate" },
    { id: "e3", from: "root", to: "c", kind: "delegate" },
  ];
  const layout = layoutGraph(nodeIds, edges, "root");
  const positions = [...layout.positions.values()];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i]!;
      const b = positions[j]!;
      const overlapsX = a.x < b.x + 200 && b.x < a.x + 200;
      const overlapsY = a.y < b.y + 72 && b.y < a.y + 72;
      assert.ok(!(overlapsX && overlapsY), `nós sobrepostos: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
});

test("layoutGraph: adicionar um subagente não embaralha os demais", () => {
  const nodeIds = ["root", "a", "b"];
  const edges = [
    { id: "e1", from: "root", to: "a", kind: "delegate" },
    { id: "e2", from: "root", to: "b", kind: "delegate" },
  ];
  const before = layoutGraph(nodeIds, edges, "root");

  const nodeIds2 = ["root", "a", "b", "c"];
  const edges2 = [...edges, { id: "e3", from: "root", to: "c", kind: "delegate" }];
  const after = layoutGraph(nodeIds2, edges2, "root");

  assert.deepEqual(before.positions.get("a"), after.positions.get("a"));
  assert.deepEqual(before.positions.get("b"), after.positions.get("b"));
});

test("layoutGraph: um MCP compartilhado não embaralha os filhos de cada agente", () => {
  // Nomes escolhidos para que a ordem alfabética contradiga o agrupamento por pai:
  // se o empate de baricentro (todos apontam para o mesmo MCP) voltar a ser
  // resolvido por id, os dois ramos se intercalam e as arestas se cruzam.
  const nodeIds = ["root", "ag1", "ag2", "a-vendas", "c-financ", "b-posvenda", "d-pecas", "mcp"];
  const edges = [
    { id: "e1", from: "root", to: "ag1", kind: "delegate" },
    { id: "e2", from: "root", to: "ag2", kind: "delegate" },
    { id: "e3", from: "ag1", to: "a-vendas", kind: "delegate" },
    { id: "e4", from: "ag1", to: "c-financ", kind: "delegate" },
    { id: "e5", from: "ag2", to: "b-posvenda", kind: "delegate" },
    { id: "e6", from: "ag2", to: "d-pecas", kind: "delegate" },
    ...["a-vendas", "c-financ", "b-posvenda", "d-pecas"].map((from, i) => ({
      id: `t${i}`,
      from,
      to: "mcp",
      kind: "tool",
    })),
  ];

  const layout = layoutGraph(nodeIds, edges, "root");
  const leaves = layout.layers[2]!;

  const parentOf: Record<string, string> = {
    "a-vendas": "ag1",
    "c-financ": "ag1",
    "b-posvenda": "ag2",
    "d-pecas": "ag2",
  };
  // Cada ramo ocupa posições contíguas: a sequência de pais só muda uma vez.
  const switches = leaves.filter((id, i) => i > 0 && parentOf[id] !== parentOf[leaves[i - 1]!]).length;
  assert.equal(switches, 1, `filhos intercalados: ${leaves.join(", ")}`);
});

test("buildRuntime: reconstrói arestas de delegação a partir da cadeia de spans (RQ-VIS-07)", () => {
  const edges = [{ id: "d1", from: "root", to: "child", kind: "delegate" as const }];
  const spans = [
    { spanId: "s1", parentSpanId: null, kind: "agent", status: "ok", errorType: null, errorMessage: null, attributes: "{}", agentId: "root", inputTokens: 10, outputTokens: 5, durationMs: 100, seq: 1 },
    { spanId: "s2", parentSpanId: "s1", kind: "delegate", status: "ok", errorType: null, errorMessage: null, attributes: "{}", agentId: "root", inputTokens: 0, outputTokens: 0, durationMs: 50, seq: 2 },
    { spanId: "s3", parentSpanId: "s2", kind: "agent", status: "ok", errorType: null, errorMessage: null, attributes: "{}", agentId: "child", inputTokens: 3, outputTokens: 2, durationMs: 40, seq: 3 },
    { spanId: "s4", parentSpanId: "s2", kind: "delegate", status: "ok", errorType: null, errorMessage: null, attributes: "{}", agentId: "root", inputTokens: 0, outputTokens: 0, durationMs: 30, seq: 4 },
    { spanId: "s5", parentSpanId: "s4", kind: "agent", status: "error", errorType: "provider_error", errorMessage: "falhou", attributes: "{}", agentId: "child", inputTokens: 1, outputTokens: 0, durationMs: 20, seq: 5 },
  ];

  const runtime = buildRuntime({ mcpServers: [] }, edges, spans);
  assert.equal(runtime.nodes.child?.calls, 2);
  assert.equal(runtime.nodes.child?.errorCount, 1);
  assert.equal(runtime.nodes.child?.state, "error");
  assert.equal(runtime.edges.d1?.calls, 2);
});

test("buildRuntime: falha de conexão MCP marca o nó do servidor, não só o agente (RQ-VIS-04)", () => {
  const edges = [{ id: "t1", from: "agent1", to: "mcp1", kind: "tool" as const }];
  const spans = [
    {
      spanId: "c1",
      parentSpanId: null,
      kind: "mcp.connect",
      status: "error",
      errorType: "mcp_connection_error",
      errorMessage: "conexão recusada",
      attributes: JSON.stringify({ "orq.mcp.server": "filesystem" }),
      agentId: "agent1",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 10,
      seq: 1,
    },
  ];
  const runtime = buildRuntime({ mcpServers: [{ id: "mcp1", name: "filesystem" }] }, edges, spans);
  assert.equal(runtime.nodes.mcp1?.state, "error");
  assert.equal(runtime.nodes.mcp1?.errorType, "mcp_connection_error");
  assert.equal(runtime.edges.t1?.calls, 1);
});
