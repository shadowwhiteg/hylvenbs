import { prisma } from "../db.ts";
import { emitRunEvent } from "../queue/events.ts";

/**
 * Escrita de telemetria em lote (D5, RQ-NFR-03): spans e logs entram num buffer em
 * memória e são gravados por `createMany`/`update` a cada 250ms ou 50 registros —
 * uma run com centenas de spans não faz uma gravação por span concorrendo com o
 * resto da aplicação. Falha de flush nunca derruba a execução (D6/RQ-OBS-10).
 */

const FLUSH_INTERVAL_MS = 250;
const FLUSH_SIZE = 50;
const MAX_BUFFERED = 5000;

type SpanCreate = Record<string, unknown> & { spanId: string; runId: string };
type SpanUpdate = { spanId: string; runId: string; data: Record<string, unknown> };
type LogCreate = Record<string, unknown> & { level: string; runId: string };

const pendingSpanCreates: SpanCreate[] = [];
const pendingSpanUpdates: SpanUpdate[] = [];
const pendingLogCreates: LogCreate[] = [];
/** spanId -> índice em pendingSpanCreates, para aplicar endSpan direto no registro ainda não gravado. */
const unflushedSpanIndex = new Map<string, number>();

let timer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function totalPending() {
  return pendingSpanCreates.length + pendingSpanUpdates.length + pendingLogCreates.length;
}

/** Buffer cheio: descarta logs `debug` primeiro (D5) e registra o incidente no stderr, sem recursão. */
function enforceCap() {
  if (totalPending() <= MAX_BUFFERED) return;
  let dropped = 0;
  for (let i = pendingLogCreates.length - 1; i >= 0 && totalPending() > MAX_BUFFERED; i--) {
    if (pendingLogCreates[i].level === "debug") {
      pendingLogCreates.splice(i, 1);
      dropped++;
    }
  }
  if (dropped > 0) {
    console.warn(`[telemetry] buffer cheio (>${MAX_BUFFERED}), descartados ${dropped} logs debug`);
  }
}

export function emitSpanCreate(data: SpanCreate) {
  unflushedSpanIndex.set(data.spanId, pendingSpanCreates.length);
  pendingSpanCreates.push(data);
  enforceCap();
  if (totalPending() >= FLUSH_SIZE) void flush();
  else scheduleFlush();
}

export function emitSpanUpdate(spanId: string, runId: string, data: Record<string, unknown>) {
  const idx = unflushedSpanIndex.get(spanId);
  if (idx !== undefined) {
    Object.assign(pendingSpanCreates[idx], data);
    return;
  }
  pendingSpanUpdates.push({ spanId, runId, data });
  if (totalPending() >= FLUSH_SIZE) void flush();
  else scheduleFlush();
}

export function emitLog(data: LogCreate) {
  pendingLogCreates.push(data);
  enforceCap();
  if (totalPending() >= FLUSH_SIZE) void flush();
  else scheduleFlush();
}

/** Grava tudo que está no buffer. Nunca lança — falha vira log de processo (D6). */
export async function flush(): Promise<void> {
  if (flushing) {
    // Um flush já em voo só cobre o que estava no buffer quando começou — dados
    // chegados depois (ex.: forceFlush correndo contra a transação anterior) não
    // podem ficar presos até o próximo timer, senão viram perda silenciosa.
    await flushing;
    if (totalPending() > 0) return flush();
    return;
  }
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(): Promise<void> {
  if (totalPending() === 0) return;

  const creates = pendingSpanCreates.splice(0, pendingSpanCreates.length);
  unflushedSpanIndex.clear();
  const updates = pendingSpanUpdates.splice(0, pendingSpanUpdates.length);
  const logs = pendingLogCreates.splice(0, pendingLogCreates.length);

  try {
    await prisma.$transaction([
      ...(creates.length ? [prisma.span.createMany({ data: creates as never[] })] : []),
      ...updates.map((u) => prisma.span.update({ where: { spanId: u.spanId }, data: u.data })),
      ...(logs.length ? [prisma.logEntry.createMany({ data: logs as never[] })] : []),
    ]);
    const runIds = new Set<string>();
    for (const c of creates) runIds.add(c.runId);
    for (const u of updates) runIds.add(u.runId);
    for (const l of logs) runIds.add(l.runId);
    for (const runId of runIds) emitRunEvent(runId);
  } catch (err) {
    console.error("[telemetry] falha ao gravar spans/logs em lote:", err);
  }
}

/** Força a gravação imediata — chamado nas transições de estado da run. */
export async function forceFlush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await flush();
}
