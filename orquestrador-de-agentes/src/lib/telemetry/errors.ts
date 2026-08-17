/**
 * Taxonomia única de erro — usada por trace, log, UI, métricas e política de
 * retentativa (design 003). `retryable` é a resposta padrão; 004 pode refinar por
 * tentativa.
 */
export type ErrorType =
  | "provider_error"
  | "provider_rate_limit"
  | "mcp_connection_error"
  | "tool_error"
  | "validation_error"
  | "timeout"
  | "max_steps_exceeded"
  | "cancelled"
  | "internal_error";

export const RETRYABLE_ERROR_TYPES: ReadonlySet<ErrorType> = new Set([
  "provider_rate_limit",
  "mcp_connection_error",
]);

export function isRetryable(errorType: ErrorType, httpStatus?: number): boolean {
  if (errorType === "provider_error") return typeof httpStatus === "number" && httpStatus >= 500;
  return RETRYABLE_ERROR_TYPES.has(errorType);
}

/** Erro de chamada a provedor de LLM — HTTP ou resposta malformada. */
export class ProviderError extends Error {
  readonly errorType: ErrorType;
  readonly httpStatus?: number;

  constructor(message: string, opts: { httpStatus?: number; rateLimited?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.httpStatus = opts.httpStatus;
    this.errorType = opts.rateLimited || opts.httpStatus === 429 ? "provider_rate_limit" : "provider_error";
  }
}

/** Erro de handshake/transporte MCP — processo morto, timeout, conexão recusada. */
export class McpError extends Error {
  readonly errorType: ErrorType = "mcp_connection_error";

  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

/**
 * Chamada (fetch ou MCP) abortada pelo `AbortSignal` da run — design 004. `reason`
 * distingue timeout (RQ-ASY-08) de cancelamento pedido pelo usuário (RQ-ASY-05).
 */
export class AbortedError extends Error {
  readonly errorType: ErrorType;

  constructor(reason: unknown) {
    const isTimeout = reason === "timeout";
    super(isTimeout ? "Tempo limite da execução excedido" : "Execução cancelada");
    this.name = "AbortedError";
    this.errorType = isTimeout ? "timeout" : "cancelled";
  }
}

/** Classifica um erro desconhecido (ex.: lançado por código de terceiros) na taxonomia. */
export function classifyError(err: unknown): { errorType: ErrorType; message: string } {
  if (err instanceof ProviderError) return { errorType: err.errorType, message: err.message };
  if (err instanceof McpError) return { errorType: err.errorType, message: err.message };
  if (err instanceof AbortedError) return { errorType: err.errorType, message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  return { errorType: "internal_error", message };
}
