"use client";

export type ProviderDto = {
  id: string;
  name: string;
  kind: "anthropic" | "openai" | "openai-compatible";
  baseUrl: string | null;
  hasApiKey: boolean;
  models: string[];
  enabled: boolean;
};

export type McpServerDto = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envKeys: string[];
  url: string | null;
  headerKeys: string[];
  secretsStatus: "ok" | "awaiting_secret";
  enabled: boolean;
  tools: { name: string; description: string }[];
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  lastCheckedAt: string | null;
};

export type UserDto = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  status: "active" | "disabled";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type ApiTokenDto = {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
  owner?: { id: string; name: string; email: string };
};

export type AgentDto = {
  id: string;
  name: string;
  description: string;
  role: "orchestrator" | "agent" | "subagent";
  systemPrompt: string;
  providerId: string | null;
  provider: { id: string; name: string; kind: string } | null;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  stopSequences: string[];
  maxSteps: number;
  enabled: boolean;
  flowId: string | null;
  children: { id: string; name: string }[];
  childIds: string[];
  mcpServers: { id: string; name: string }[];
  mcpServerIds: string[];
  /** Roteamento de modelos (design 007). */
  modelPolicyId: string | null;
  modelPolicy: { id: string; name: string; slug: string } | null;
  taskType: string;
  candidates: ModelCandidateDto[];
};

export type FlowDto = {
  id: string;
  name: string;
  slug: string;
  description: string;
  rootAgentId: string;
  status: "draft" | "published" | "archived";
  currentVersion: { id: string; version: number; tag: string | null; createdAt: string } | null;
  versionCount?: number;
  isDirty?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type FlowVersionDto = {
  id: string;
  flowId: string;
  version: number;
  tag: string | null;
  message: string;
  contentHash: string;
  snapshot?: unknown;
  createdById: string | null;
  createdAt: string;
};

export type DiffEntryDto =
  | { type: "agent.added"; agentId: string; name: string }
  | { type: "agent.removed"; agentId: string; name: string }
  | { type: "agent.changed"; agentId: string; name: string; field: string; from: unknown; to: unknown }
  | { type: "edge.added"; from: string; to: string }
  | { type: "edge.removed"; from: string; to: string }
  | { type: "mcp.bound"; agentId: string; mcpServerId: string }
  | { type: "mcp.unbound"; agentId: string; mcpServerId: string }
  | { type: "mcp.configChanged"; mcpServerId: string; name: string; from: string; to: string };

export type SpanDto = {
  id: string;
  spanId: string;
  parentSpanId: string | null;
  kind: "agent" | "model" | "tool" | "delegate" | "mcp.connect";
  name: string;
  status: "running" | "ok" | "error" | "cancelled";
  errorType: string | null;
  errorMessage: string | null;
  attributes: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  seq: number;
  depth: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  agent?: { id: string; name: string } | null;
};

export type LogEntryDto = {
  id: string;
  spanId: string | null;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  errorType: string | null;
  payload: string;
  seq: number;
  createdAt: string;
};

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

export type RunDto = {
  id: string;
  agentId: string;
  agent?: { id: string; name: string; role: string };
  flowId: string | null;
  flowVersionId: string | null;
  sourceKind: "draft" | "version";
  /** Canal que disparou a run (RQ-OAI-11): "ui" | "api" | "openai". */
  source: string;
  configDrift: boolean;
  driftDetail: string | null;
  input: string;
  output: string | null;
  status: RunStatus;
  error: string | null;
  errorType: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  queuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  attempt: number;
  cancelRequestedAt: string | null;
  taskType: string | null;
  modelFailover: boolean;
  spans?: SpanDto[];
};

export type EnqueuedRunDto = { id: string; status: RunStatus; agentId: string };

export type ModelCandidateDto = {
  id?: string;
  taskType: string;
  rank: number;
  providerId: string;
  provider?: { id: string; name: string; kind: string } | null;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  enabled: boolean;
};

export type ModelPolicyDto = {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  agentCount: number;
  candidates: ModelCandidateDto[];
};

export type ModelHealthDto = {
  providerId: string;
  providerName: string | null;
  model: string;
  consecutiveFailures: number;
  lastErrorType: string | null;
  lastErrorMessage: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
  cooldownUntil: string | null;
  inCooldown: boolean;
};

export type GraphNodeType = "orchestrator" | "agent" | "subagent" | "mcpServer";
export type GraphNodeDto = {
  id: string;
  type: GraphNodeType;
  label: string;
  model?: string;
  provider?: string;
  enabled?: boolean;
};
export type GraphEdgeDto = { id: string; from: string; to: string; kind: "delegate" | "tool" };
export type GraphNodeState = "idle" | "running" | "ok" | "error" | "cancelled";
export type GraphRuntimeNodeDto = {
  state: GraphNodeState;
  calls: number;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  errorType: string | null;
  errorMessage: string | null;
  errorCount: number;
};
export type GraphRuntimeDto = {
  nodes: Record<string, GraphRuntimeNodeDto>;
  edges: Record<string, { calls: number }>;
};
export type GraphDataDto = {
  rootId: string;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  runtime?: GraphRuntimeDto;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) => request<T>(url, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};
