/** Tipos do grafo de visualização (design 006). Compartilhados entre servidor e cliente. */

export type GraphNodeType = "orchestrator" | "agent" | "subagent" | "mcpServer";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  model?: string;
  provider?: string;
  enabled?: boolean;
};

export type GraphEdgeKind = "delegate" | "tool";

export type GraphEdge = { id: string; from: string; to: string; kind: GraphEdgeKind };

export type GraphNodeState = "idle" | "running" | "ok" | "error" | "cancelled";

export type GraphRuntimeNode = {
  state: GraphNodeState;
  calls: number;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  errorType: string | null;
  errorMessage: string | null;
  errorCount: number;
};

export type GraphRuntime = {
  nodes: Record<string, GraphRuntimeNode>;
  edges: Record<string, { calls: number }>;
};

export type GraphData = {
  rootId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  runtime?: GraphRuntime;
};
