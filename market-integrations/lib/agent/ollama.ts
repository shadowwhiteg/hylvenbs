export type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Reasoning models put their chain of thought here instead of `content`. */
  thinking?: string;
  tool_calls?: OllamaToolCall[];
};

export type OllamaToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
};

export type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OllamaChatOptions = {
  baseUrl: string;
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  stream?: boolean;
  /**
   * Set to false for reasoning models (qwen3, deepseek-r1): they otherwise
   * spend the whole answer on `thinking` and return an empty `content`.
   */
  think?: boolean;
  /** Maps to Ollama `options.num_predict`. */
  maxTokens?: number;
  fetchImpl?: typeof fetch;
};

export async function ollamaHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/tags`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return {
      ok: true,
      models: (data.models || []).map((m) => m.name),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ollamaChat(options: OllamaChatOptions): Promise<{
  message: OllamaMessage;
  raw: unknown;
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      stream: false,
      ...(options.think === undefined ? {} : { think: options.think }),
      ...(options.maxTokens != null && options.maxTokens > 0
        ? { options: { num_predict: options.maxTokens } }
        : {}),
    }),
  });
  const raw = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof raw === "object" && raw && "error" in raw
        ? String((raw as { error: unknown }).error)
        : `Ollama HTTP ${res.status}`
    );
  }
  const message = (raw as { message: OllamaMessage }).message;
  return { message, raw };
}

export function toOllamaTools(
  defs: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>
): OllamaTool[] {
  return defs.map((d) => ({
    type: "function",
    function: {
      name: d.name,
      description: d.description,
      parameters: d.inputSchema,
    },
  }));
}

export function parseToolCallArgs(
  args: Record<string, unknown> | string
): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return args || {};
}
