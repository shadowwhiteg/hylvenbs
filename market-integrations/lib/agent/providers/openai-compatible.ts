import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ProviderHealth,
} from "@/lib/agent/providers/types";

export type OpenAiCompatibleConfig = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  extraHeaders?: Record<string, string>;
};

type OpenAiChatMessage = {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

function toOpenAiToolCalls(calls: ChatToolCall[]): OpenAiChatMessage["tool_calls"] {
  return calls.map((tc, i) => ({
    id: tc.id || `call_${i}`,
    type: "function",
    function: {
      name: tc.function.name,
      arguments:
        typeof tc.function.arguments === "string"
          ? tc.function.arguments
          : JSON.stringify(tc.function.arguments),
    },
  }));
}

function toOpenAiMessages(messages: ChatMessage[]): OpenAiChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content ?? "",
    ...(m.tool_calls?.length ? { tool_calls: toOpenAiToolCalls(m.tool_calls) } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
  }));
}

function extractErrorDetail(raw: unknown, status: number): string {
  if (raw && typeof raw === "object" && "error" in raw) {
    const err = (raw as { error: unknown }).error;
    if (typeof err === "string" && err) return err;
    if (err && typeof err === "object" && "message" in err) {
      const message = (err as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  }
  return `HTTP ${status}`;
}

/**
 * Generic client for any backend that speaks the OpenAI chat-completions
 * shape: OpenAI itself, OpenRouter, Google AI Studio's OpenAI-compat layer,
 * and self-hosted OpenAI-compatible servers (vLLM, LM Studio, etc.).
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): AiProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  return {
    id: config.id,
    supportsTools: true,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (!baseUrl) throw new Error(`${config.label}: base URL não configurada`);
      if (!config.model) throw new Error(`${config.label}: modelo não configurado`);

      const fetchImpl = req.fetchImpl ?? fetch;
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: toOpenAiMessages(req.messages),
          ...(req.tools?.length ? { tools: req.tools } : {}),
          ...(req.maxTokens != null && req.maxTokens > 0 ? { max_tokens: req.maxTokens } : {}),
        }),
      });

      const raw = await res.json().catch(() => ({}));
      if (!res.ok || (raw && typeof raw === "object" && "error" in raw)) {
        throw new Error(`${config.label}: ${extractErrorDetail(raw, res.status)}`);
      }

      const choiceMessage = (raw as { choices?: Array<{ message?: Record<string, unknown> }> })
        ?.choices?.[0]?.message;
      if (!choiceMessage) {
        throw new Error(`${config.label}: resposta sem choices[0].message`);
      }

      const rawToolCalls = choiceMessage.tool_calls;
      const toolCalls: ChatToolCall[] | undefined = Array.isArray(rawToolCalls)
        ? (rawToolCalls as Array<{ id?: string; function: { name: string; arguments: string } }>).map(
            (tc) => ({ id: tc.id, function: { name: tc.function.name, arguments: tc.function.arguments } })
          )
        : undefined;

      return {
        message: {
          role: "assistant",
          content: String(choiceMessage.content ?? ""),
          ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        },
        raw,
      };
    },
    async health(fetchImpl: typeof fetch = fetch): Promise<ProviderHealth> {
      if (!baseUrl) return { ok: false, error: `${config.label}: base URL não configurada` };
      if (!config.apiKey && config.id !== "openai-compatible") {
        return { ok: false, error: `${config.label}: API key não configurada` };
      }
      try {
        const res = await fetchImpl(`${baseUrl}/models`, {
          headers: {
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            ...(config.extraHeaders || {}),
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || (data && typeof data === "object" && "error" in data)) {
          return { ok: false, error: extractErrorDetail(data, res.status) };
        }
        const models = Array.isArray((data as { data?: Array<{ id: string }> }).data)
          ? (data as { data: Array<{ id: string }> }).data.map((m) => m.id)
          : undefined;
        return { ok: true, models };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
