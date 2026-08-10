export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatToolCall = {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  /** Reasoning models put their chain of thought here instead of `content`. */
  thinking?: string;
  tool_calls?: ChatToolCall[];
  /** Required by strict OpenAI-shaped APIs on role:"tool" messages. */
  tool_call_id?: string;
};

export type ChatToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  /**
   * Set to false for reasoning models (qwen3, deepseek-r1) on Ollama: they
   * otherwise spend the whole answer on `thinking` and return empty `content`.
   * Ignored by providers that don't have this concept.
   */
  think?: boolean;
  /** Cap on output tokens (OpenAI `max_tokens`, Ollama `num_predict`). Ignored by CLI providers. */
  maxTokens?: number;
  fetchImpl?: typeof fetch;
};

export type ChatResponse = {
  message: ChatMessage;
  raw: unknown;
};

export type ProviderHealth = {
  ok: boolean;
  models?: string[];
  error?: string;
};

export interface AiProvider {
  readonly id: string;
  /** CLI providers can't be wired into the structured function-calling tool loop. */
  readonly supportsTools: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
  health(fetchImpl?: typeof fetch): Promise<ProviderHealth>;
}
