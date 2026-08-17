import type { AgentRole } from "../agents/roles.ts";
import type { FlowSnapshot } from "../flows/snapshot.ts";
import type { GraphData, GraphEdge, GraphNode, GraphNodeType } from "./types.ts";

/** O papel do agente já usa o mesmo vocabulário do tipo de nó (design 008). */
function nodeTypeFor(role: string): GraphNodeType {
  return role as AgentRole;
}

/** Converte um FlowSnapshot (fixo, RQ-VER-05) na topologia de visualização (RQ-VIS-01). */
export function snapshotToGraph(snapshot: FlowSnapshot): GraphData {
  const nodes: GraphNode[] = snapshot.agents.map((a) => ({
    id: a.id,
    type: nodeTypeFor(a.role),
    label: a.name,
    model: a.model || undefined,
    provider: a.provider?.name,
    enabled: a.enabled,
  }));

  const edges: GraphEdge[] = snapshot.edges.map((e, i) => ({
    id: `d:${e.from}:${e.to}:${i}`,
    from: e.from,
    to: e.to,
    kind: "delegate",
  }));

  for (const mcp of snapshot.mcpServers) {
    nodes.push({ id: mcp.id, type: "mcpServer", label: mcp.name });
  }
  for (const agent of snapshot.agents) {
    for (const mcpServerId of agent.mcpServerIds) {
      edges.push({ id: `t:${agent.id}:${mcpServerId}`, from: agent.id, to: mcpServerId, kind: "tool" });
    }
  }

  return { rootId: snapshot.rootAgentId, nodes, edges };
}
