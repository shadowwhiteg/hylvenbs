export type ProviderKind = "anthropic" | "openai" | "openai-compatible";

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolDef = {
  name: string;
  description: string;
  /** JSON Schema do objeto de entrada. */
  parameters: Record<string, unknown>;
};

export type ModelParams = {
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  /** Ignorado quando 0. */
  topK: number;
  stopSequences: string[];
};

export type CompletionResult = {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string;
};

export type ProviderConfig = {
  id: string;
  kind: ProviderKind;
  baseUrl?: string | null;
  /** Envelope cifrado ("v1:..."). Só é decifrado dentro de src/lib/providers.ts. */
  apiKeyEnc?: string | null;
};

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpServerConfig = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string | null;
  args: string[];
  /** Envelope cifrado do JSON de variáveis de ambiente. Só decifrado em src/lib/mcp.ts. */
  envEnc?: string | null;
  url?: string | null;
  /** Envelope cifrado do JSON de headers HTTP. Só decifrado em src/lib/mcp.ts. */
  headersEnc?: string | null;
};
