/**
 * Tradução pura entre o dialeto chat/completions e o modelo interno de run
 * (design 010). Sem I/O — tudo aqui é testável com valores em memória.
 */

export type ChatContentPart = { type: string; text?: string; [key: string]: unknown };
export type ChatMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[] | null;
};

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  system: "system",
  developer: "system",
  user: "user",
  assistant: "assistant",
  tool: "tool",
};

/** Uma parte de conteúdo que não é texto (imagem, áudio…) — melhor recusar que descartar em silêncio (D5). */
export class UnsupportedContentError extends Error {
  readonly partType: string;
  constructor(partType: string) {
    super(`Tipo de conteúdo não suportado: ${partType}`);
    this.partType = partType;
  }
}

function textOf(content: ChatMessage["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return typeof part.text === "string" ? part.text : "";
      throw new UnsupportedContentError(part.type);
    })
    .join("");
}

/**
 * Achata `messages` num único `input: string` (RQ-OAI-06, D5). Uma conversa de uma
 * única mensagem `user` vira o texto puro, sem rótulo — é o caso mais comum e o
 * rótulo só ruído. Caso contrário, um rótulo `[papel]` por linha, na ordem recebida.
 */
export function flattenMessages(messages: ChatMessage[]): string {
  if (messages.length === 1 && messages[0]!.role === "user") {
    return textOf(messages[0]!.content);
  }
  return messages.map((m) => `[${ROLE_LABEL[m.role] ?? m.role}] ${textOf(m.content)}`).join("\n");
}

/** Envelope de erro da OpenAI (D9) — o que os SDKs desempacotam. */
export function openAiError(message: string, type: string, code: string) {
  return { error: { message, type, code } };
}

/** Parâmetros recusados com 400 — decidir tools é do fluxo, não do cliente (D8). */
const UNSUPPORTED_PARAMS = ["tools", "functions", "tool_choice", "logprobs"] as const;

/** Parâmetros aceitos e ignorados em silêncio (logados em debug) — inofensivos (D8). */
export const IGNORED_PARAMS = [
  "temperature",
  "top_p",
  "max_tokens",
  "stop",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "user",
] as const;

/** Primeiro parâmetro não suportado encontrado no corpo, ou null se nenhum. */
export function findUnsupportedParam(body: Record<string, unknown>): string | null {
  for (const key of UNSUPPORTED_PARAMS) {
    if (body[key] !== undefined) return key;
  }
  if (typeof body.n === "number" && body.n > 1) return "n";
  return null;
}

/** Parâmetros de amostragem presentes no corpo, para o log de debug (D8). */
export function listIgnoredParams(body: Record<string, unknown>): string[] {
  return IGNORED_PARAMS.filter((key) => body[key] !== undefined);
}

export type RunTerminationOutcome =
  | { ok: true; httpStatus: 200; finishReason: "stop" | "length" }
  | { ok: false; httpStatus: number; runId: string; error: { message: string; type: string; code: string } };

/**
 * Mapa de término (design 010): status da run -> HTTP + finish_reason/erro. O único
 * caso ambíguo é "succeeded" com o span raiz marcado max_steps_exceeded — vira
 * finish_reason "length" em vez de "stop", sem mudar o status HTTP.
 */
export function mapRunTermination(
  run: { id: string; status: string; error: string | null; errorType: string | null },
  rootSpanErrorType: string | null,
): RunTerminationOutcome {
  switch (run.status) {
    case "succeeded":
      return { ok: true, httpStatus: 200, finishReason: rootSpanErrorType === "max_steps_exceeded" ? "length" : "stop" };
    case "failed":
      return {
        ok: false,
        httpStatus: 502,
        runId: run.id,
        error: {
          message: run.error ?? "A execução falhou.",
          type: "upstream_error",
          code: run.errorType ?? "internal_error",
        },
      };
    case "cancelled":
      return {
        ok: false,
        httpStatus: 409,
        runId: run.id,
        error: { message: "A execução foi cancelada.", type: "run_cancelled", code: "run_cancelled" },
      };
    case "timed_out":
      return {
        ok: false,
        httpStatus: 504,
        runId: run.id,
        error: { message: "A execução expirou.", type: "run_timeout", code: "run_timeout" },
      };
    default:
      // "queued" | "running" — ainda executando ao fim do teto de espera (D6).
      return {
        ok: false,
        httpStatus: 504,
        runId: run.id,
        error: {
          message: "A execução ainda está em andamento — consulte GET /api/runs/:id.",
          type: "run_pending",
          code: "run_pending",
        },
      };
  }
}
