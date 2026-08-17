import { randomBytes } from "node:crypto";
import { emitSpanCreate, emitSpanUpdate } from "./buffer.ts";
import type { ErrorType } from "./errors.ts";
import { redactedJson } from "./redact.ts";

const ATTR_MAX_LEN = 8 * 1024;

export type SpanKind = "agent" | "model" | "tool" | "delegate" | "mcp.connect";

export type TraceContext = {
  runId: string;
  traceId: string;
  /** Contador monotônico por run (D4) — propagado por referência, não por closure. */
  seq: { next: number };
};

export type SpanHandle = {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  runId: string;
  agentId: string | null;
  depth: number;
  kind: SpanKind;
  name: string;
  startedAt: number;
  attributes: Record<string, unknown>;
};

export function createTraceContext(runId: string): TraceContext {
  return { runId, traceId: randomBytes(16).toString("hex"), seq: { next: 0 } };
}

/** Abre um span e já grava (via buffer) com status "running". Contexto passado explicitamente (D1). */
export function startSpan(
  ctx: TraceContext,
  opts: {
    kind: SpanKind;
    name: string;
    parent: SpanHandle | null;
    agentId?: string | null;
    attributes?: Record<string, unknown>;
  },
): SpanHandle {
  const spanId = randomBytes(8).toString("hex");
  const depth = opts.parent ? opts.parent.depth + 1 : 0;
  const handle: SpanHandle = {
    spanId,
    parentSpanId: opts.parent?.spanId ?? null,
    traceId: ctx.traceId,
    runId: ctx.runId,
    agentId: opts.agentId ?? null,
    depth,
    kind: opts.kind,
    name: opts.name,
    startedAt: Date.now(),
    attributes: opts.attributes ?? {},
  };

  emitSpanCreate({
    runId: ctx.runId,
    traceId: ctx.traceId,
    spanId,
    parentSpanId: handle.parentSpanId,
    kind: opts.kind,
    name: opts.name,
    agentId: opts.agentId ?? null,
    status: "running",
    attributes: redactedJson(opts.attributes ?? {}, ATTR_MAX_LEN),
    seq: ctx.seq.next++,
    depth,
  });

  return handle;
}

/** Fecha um span. Telemetria nunca lança — chamadores não precisam de try/catch aqui (D6). */
export function endSpan(
  handle: SpanHandle,
  outcome: {
    status: "ok" | "error" | "cancelled";
    errorType?: ErrorType;
    errorMessage?: string;
    attributes?: Record<string, unknown>;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number | null;
  },
) {
  const endedAt = new Date();
  const merged = outcome.attributes ? { ...handle.attributes, ...outcome.attributes } : null;
  emitSpanUpdate(handle.spanId, handle.runId, {
    status: outcome.status,
    errorType: outcome.errorType ?? null,
    errorMessage: outcome.errorMessage ? outcome.errorMessage.slice(0, 2000) : null,
    ...(merged ? { attributes: redactedJson(merged, ATTR_MAX_LEN) } : {}),
    inputTokens: outcome.inputTokens ?? 0,
    outputTokens: outcome.outputTokens ?? 0,
    costUsd: outcome.costUsd ?? null,
    endedAt,
    durationMs: endedAt.getTime() - handle.startedAt,
  });
}
