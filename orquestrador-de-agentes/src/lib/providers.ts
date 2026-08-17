import { decrypt, isEnvelope } from "./crypto/secrets.ts";
import { AbortedError, ProviderError } from "./telemetry/errors.ts";
import type {
  CompletionResult,
  Message,
  ModelParams,
  ProviderConfig,
  ProviderKind,
  ToolCall,
  ToolDef,
} from "./types.ts";

const ANTHROPIC_VERSION = "2023-06-01";

export const PROVIDER_KINDS: { value: ProviderKind; label: string; defaultBaseUrl: string }[] = [
  { value: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com" },
  { value: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
  {
    value: "openai-compatible",
    label: "Compatível com OpenAI (Ollama, vLLM, Groq…)",
    defaultBaseUrl: "http://localhost:11434/v1",
  },
];

/** Modelos sugeridos quando o provedor não expõe /models ou não há chave. */
export const SUGGESTED_MODELS: Record<ProviderKind, string[]> = {
  anthropic: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  "openai-compatible": ["llama3.1", "qwen2.5"],
};

function baseUrlFor(cfg: ProviderConfig): string {
  const fallback = PROVIDER_KINDS.find((p) => p.value === cfg.kind)!.defaultBaseUrl;
  return (cfg.baseUrl || fallback).replace(/\/$/, "");
}

function resolveApiKey(cfg: ProviderConfig): string {
  if (cfg.apiKeyEnc && isEnvelope(cfg.apiKeyEnc)) {
    return decrypt(cfg.apiKeyEnc, `Provider:${cfg.id}:apiKey`);
  }
  if (cfg.kind === "anthropic") return process.env.ANTHROPIC_API_KEY ?? "";
  if (cfg.kind === "openai") return process.env.OPENAI_API_KEY ?? "";
  return "";
}

async function readError(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message ?? parsed?.message ?? body;
  } catch {
    return body || res.statusText;
  }
}

async function throwProviderError(providerName: string, res: Response): Promise<never> {
  const detail = await readError(res);
  const rateLimited = res.status === 429 || /rate.?limit/i.test(detail);
  throw new ProviderError(`${providerName} ${res.status}: ${detail}`, { httpStatus: res.status, rateLimited });
}

/** `fetch` lança TypeError de rede (DNS, conexão recusada) antes de haver um Response — classifica como provider_error. */
async function providerFetch(
  providerName: string,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (signal?.aborted) throw new AbortedError(signal.reason);
    throw new ProviderError(`${providerName} indisponível: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------- Anthropic

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

/**
 * Converte o histórico normalizado para o formato da Messages API.
 * Resultados de tool viram blocos `tool_result` agrupados numa única mensagem
 * de usuário, como a API exige.
 */
function toAnthropicMessages(messages: Message[]) {
  const out: { role: "user" | "assistant"; content: AnthropicBlock[] }[] = [];

  for (const msg of messages) {
    if (msg.role === "tool") {
      const block: AnthropicBlock = {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
      };
      const last = out.at(-1);
      if (last?.role === "user" && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: msg.content }] });
      continue;
    }

    const content: AnthropicBlock[] = [];
    if (msg.content.trim()) content.push({ type: "text", text: msg.content });
    for (const call of msg.toolCalls ?? []) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
    }
    if (content.length) out.push({ role: "assistant", content });
  }

  return out;
}

async function completeAnthropic(
  cfg: ProviderConfig,
  system: string,
  messages: Message[],
  tools: ToolDef[],
  params: ModelParams,
  signal?: AbortSignal,
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    top_p: params.topP,
    messages: toAnthropicMessages(messages),
  };
  if (system.trim()) body.system = system;
  if (params.topK > 0) body.top_k = params.topK;
  if (params.stopSequences.length) body.stop_sequences = params.stopSequences;
  if (tools.length) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const res = await providerFetch(
    "Anthropic",
    `${baseUrlFor(cfg)}/v1/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": resolveApiKey(cfg),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    },
    signal,
  );
  if (!res.ok) await throwProviderError("Anthropic", res);

  const data = await res.json();
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of (data.content ?? []) as AnthropicBlock[]) {
    if (block.type === "text") text += block.text;
    if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
    }
  }

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
    stopReason: data.stop_reason ?? "end_turn",
  };
}

// ------------------------------------------------------------------- OpenAI

function toOpenAiMessages(system: string, messages: Message[]) {
  const out: Record<string, unknown>[] = [];
  if (system.trim()) out.push({ role: "system", content: system });

  for (const msg of messages) {
    if (msg.role === "tool") {
      out.push({ role: "tool", tool_call_id: msg.toolCallId, content: msg.content });
    } else if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else {
      const entry: Record<string, unknown> = { role: "assistant", content: msg.content || null };
      if (msg.toolCalls?.length) {
        entry.tool_calls = msg.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
      }
      out.push(entry);
    }
  }
  return out;
}

async function completeOpenAi(
  cfg: ProviderConfig,
  system: string,
  messages: Message[],
  tools: ToolDef[],
  params: ModelParams,
  signal?: AbortSignal,
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: toOpenAiMessages(system, messages),
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    top_p: params.topP,
  };
  if (params.stopSequences.length) body.stop = params.stopSequences;
  if (tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const key = resolveApiKey(cfg);
  const res = await providerFetch(
    "OpenAI",
    `${baseUrlFor(cfg)}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    },
    signal,
  );
  if (!res.ok) await throwProviderError("OpenAI", res);

  const data = await res.json();
  const choice = data.choices?.[0];
  const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map(
    (c: { id: string; function: { name: string; arguments: string } }) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || "{}");
      } catch {
        args = { _raw: c.function.arguments };
      }
      return { id: c.id, name: c.function.name, args };
    },
  );

  return {
    text: choice?.message?.content ?? "",
    toolCalls,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    stopReason: choice?.finish_reason ?? "stop",
  };
}

// -------------------------------------------------------------------- API

export function complete(
  cfg: ProviderConfig,
  system: string,
  messages: Message[],
  tools: ToolDef[],
  params: ModelParams,
  signal?: AbortSignal,
): Promise<CompletionResult> {
  return cfg.kind === "anthropic"
    ? completeAnthropic(cfg, system, messages, tools, params, signal)
    : completeOpenAi(cfg, system, messages, tools, params, signal);
}

/** Consulta os modelos disponíveis no provedor; cai para a lista sugerida. */
export async function listModels(cfg: ProviderConfig): Promise<string[]> {
  const key = resolveApiKey(cfg);
  const base = baseUrlFor(cfg);

  if (cfg.kind === "anthropic") {
    const res = await providerFetch("Anthropic", `${base}/v1/models?limit=100`, {
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
    });
    if (!res.ok) await throwProviderError("Anthropic", res);
    const data = await res.json();
    return (data.data ?? []).map((m: { id: string }) => m.id);
  }

  const res = await providerFetch(cfg.kind, `${base}/models`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) await throwProviderError(cfg.kind, res);
  const data = await res.json();
  return (data.data ?? []).map((m: { id: string }) => m.id).sort();
}
