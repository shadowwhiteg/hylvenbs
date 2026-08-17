import { parseJson } from "./db.ts";

type ProviderRow = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiKeyEnc: string | null;
  models: string;
  enabled: boolean;
  createdAt: Date;
};

export function serializeProvider(row: ProviderRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    hasApiKey: Boolean(row.apiKeyEnc),
    models: parseJson<string[]>(row.models, []),
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

type McpRow = {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string;
  envEnc: string | null;
  envKeys: string;
  url: string | null;
  headersEnc: string | null;
  headerKeys: string;
  enabled: boolean;
  toolsCache: string;
  lastStatus: string | null;
  lastError: string | null;
  lastCheckedAt: Date | null;
};

export function serializeMcpServer(row: McpRow) {
  const envKeys = parseJson<string[]>(row.envKeys, []);
  const headerKeys = parseJson<string[]>(row.headerKeys, []);
  // Nomes declarados sem valor cifrado ainda: um editor criou, falta um admin preencher (RQ-SEC-07).
  const awaitingSecret = (envKeys.length > 0 && !row.envEnc) || (headerKeys.length > 0 && !row.headersEnc);

  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: parseJson<string[]>(row.args, []),
    // Nomes das variáveis, nunca os valores — ver design 005.
    envKeys,
    url: row.url,
    headerKeys,
    secretsStatus: awaitingSecret ? "awaiting_secret" : "ok",
    enabled: row.enabled,
    tools: parseJson<{ name: string; description: string }[]>(row.toolsCache, []),
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt,
  };
}

type AgentRow = {
  id: string;
  name: string;
  description: string;
  role: string;
  systemPrompt: string;
  providerId: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  stopSequences: string;
  maxSteps: number;
  enabled: boolean;
  flowId?: string | null;
  createdAt: Date;
  provider?: { id: string; name: string; kind: string } | null;
  children?: { child: { id: string; name: string; deletedAt?: Date | null } }[];
  mcpServers?: { mcpServer: { id: string; name: string; deletedAt?: Date | null } }[];
  modelPolicyId?: string | null;
  taskType?: string;
  modelPolicy?: { id: string; name: string; slug: string } | null;
  candidates?: {
    id: string;
    taskType: string;
    rank: number;
    providerId: string;
    model: string;
    maxTokens: number | null;
    temperature: number | null;
    enabled: boolean;
    provider?: { id: string; name: string; kind: string } | null;
  }[];
};

export function serializeAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: row.role,
    systemPrompt: row.systemPrompt,
    providerId: row.providerId,
    provider: row.provider ? { id: row.provider.id, name: row.provider.name, kind: row.provider.kind } : null,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    topP: row.topP,
    topK: row.topK,
    stopSequences: parseJson<string[]>(row.stopSequences, []),
    maxSteps: row.maxSteps,
    enabled: row.enabled,
    flowId: row.flowId ?? null,
    createdAt: row.createdAt,
    children: (row.children ?? []).filter((c) => !c.child.deletedAt).map((c) => c.child),
    childIds: (row.children ?? []).filter((c) => !c.child.deletedAt).map((c) => c.child.id),
    mcpServers: (row.mcpServers ?? []).filter((m) => !m.mcpServer.deletedAt).map((m) => m.mcpServer),
    mcpServerIds: (row.mcpServers ?? []).filter((m) => !m.mcpServer.deletedAt).map((m) => m.mcpServer.id),
    // Roteamento de modelos (design 007). A ordem é a preferência declarada.
    modelPolicyId: row.modelPolicyId ?? null,
    modelPolicy: row.modelPolicy ?? null,
    taskType: row.taskType ?? "default",
    candidates: [...(row.candidates ?? [])]
      .sort((a, b) => (a.taskType === b.taskType ? a.rank - b.rank : a.taskType.localeCompare(b.taskType)))
      .map((c) => ({
        id: c.id,
        taskType: c.taskType,
        rank: c.rank,
        providerId: c.providerId,
        provider: c.provider ?? null,
        model: c.model,
        maxTokens: c.maxTokens,
        temperature: c.temperature,
        enabled: c.enabled,
      })),
  };
}
