import { emitLog } from "./buffer.ts";
import type { ErrorType } from "./errors.ts";
import { redactedJson } from "./redact.ts";
import type { TraceContext } from "./tracer.ts";

const PAYLOAD_MAX_LEN = 2 * 1024;
export type LogLevel = "debug" | "info" | "warn" | "error";

/** debug fica desligado por padrão (RQ-OBS-04) — habilite com TELEMETRY_DEBUG_LOGS=1. */
function debugEnabled(): boolean {
  return process.env.TELEMETRY_DEBUG_LOGS === "1";
}

function write(
  ctx: TraceContext,
  level: LogLevel,
  message: string,
  opts: { spanId?: string | null; errorType?: ErrorType; payload?: unknown } = {},
) {
  if (level === "debug" && !debugEnabled()) return;
  emitLog({
    runId: ctx.runId,
    spanId: opts.spanId ?? null,
    level,
    message,
    errorType: opts.errorType ?? null,
    payload: redactedJson(opts.payload ?? {}, PAYLOAD_MAX_LEN),
    seq: ctx.seq.next++,
  });
}

export const log = {
  debug: (ctx: TraceContext, message: string, opts?: Parameters<typeof write>[3]) =>
    write(ctx, "debug", message, opts),
  info: (ctx: TraceContext, message: string, opts?: Parameters<typeof write>[3]) =>
    write(ctx, "info", message, opts),
  warn: (ctx: TraceContext, message: string, opts?: Parameters<typeof write>[3]) =>
    write(ctx, "warn", message, opts),
  error: (ctx: TraceContext, message: string, opts?: Parameters<typeof write>[3]) =>
    write(ctx, "error", message, opts),
};
