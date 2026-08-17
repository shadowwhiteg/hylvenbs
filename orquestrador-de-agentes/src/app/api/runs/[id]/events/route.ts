import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/http";
import { onRunEvent } from "@/lib/queue/events";
import { isTerminal } from "@/lib/queue/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const POLL_FALLBACK_MS = 1000;
const PING_MS = 15_000;

/**
 * SSE ao vivo (RQ-ASY-03/04). Cursor = `seq` (compartilhado entre Span e LogEntry,
 * ver design 003). Como spans são gravados em lote, um span que abre e fecha dentro
 * da mesma janela de flush (250ms) nunca aparece como "running" — a granularidade
 * viva é a do próprio buffer, não por span individual. Um span que fica aberto por
 * mais de um flush é reenviado quando fecha, mesmo que seu `seq` já tenha passado do
 * cursor (rastreado via `trackedOpen`, não via `seq>cursor`).
 */
export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "run.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const run = await prisma.run.findUnique({ where: { id }, select: { id: true, status: true, errorType: true } });
  if (!run) return fail("Execução não encontrada", 404);

  const lastEventId = request.headers.get("last-event-id");
  let cursor = lastEventId ? Number(lastEventId) || 0 : 0;
  let lastStatus: string | null = null;

  const encoder = new TextEncoder();
  const trackedOpen = new Set<string>();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let pollTimer: NodeJS.Timeout | null = null;
      let pingTimer: NodeJS.Timeout | null = null;
      let offBus: (() => void) | null = null;
      let polling = false;

      function send(event: string, data: unknown, eventId?: number) {
        if (closed) return;
        let chunk = `event: ${event}\n`;
        if (eventId !== undefined) chunk += `id: ${eventId}\n`;
        chunk += `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          teardown();
        }
      }

      function teardown() {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (pingTimer) clearInterval(pingTimer);
        if (offBus) offBus();
        try {
          controller.close();
        } catch {
          /* já fechado pelo consumidor */
        }
      }

      async function poll() {
        if (polling || closed) return;
        polling = true;
        try {
          const [newSpans, newLogs, closedRows, current] = await Promise.all([
            prisma.span.findMany({ where: { runId: id, seq: { gt: cursor } }, orderBy: { seq: "asc" } }),
            prisma.logEntry.findMany({ where: { runId: id, seq: { gt: cursor } }, orderBy: { seq: "asc" } }),
            trackedOpen.size
              ? prisma.span.findMany({ where: { runId: id, spanId: { in: [...trackedOpen] }, status: { not: "running" } } })
              : Promise.resolve([]),
            prisma.run.findUnique({ where: { id }, select: { status: true, errorType: true } }),
          ]);

          const merged: (typeof newSpans[number] | typeof newLogs[number])[] = [...newSpans, ...newLogs].sort(
            (a, b) => a.seq - b.seq,
          );
          for (const row of merged) {
            const isSpan = "kind" in row;
            send(isSpan ? "span" : "log", row, row.seq);
            if (isSpan && row.status === "running") trackedOpen.add(row.spanId);
          }
          if (merged.length) cursor = Math.max(cursor, merged[merged.length - 1]!.seq);

          for (const row of closedRows) {
            send("span", row, row.seq);
            trackedOpen.delete(row.spanId);
          }

          if (current && current.status !== lastStatus) {
            lastStatus = current.status;
            send("status", { status: current.status, errorType: current.errorType });
          }

          if (!current || isTerminal(current.status)) {
            send("done", { status: current?.status ?? "unknown" });
            teardown();
          }
        } catch (err) {
          console.error(`[sse] falha ao consultar run ${id}:`, err);
        } finally {
          polling = false;
        }
      }

      const initiallyOpen = await prisma.span.findMany({
        where: { runId: id, status: "running" },
        select: { spanId: true },
      });
      for (const s of initiallyOpen) trackedOpen.add(s.spanId);

      if (isTerminal(run.status)) {
        await poll();
        return;
      }

      offBus = onRunEvent(id, () => void poll());
      pollTimer = setInterval(() => void poll(), POLL_FALLBACK_MS);
      pingTimer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, PING_MS);

      request.signal.addEventListener("abort", teardown);
      await poll();
    },
    cancel() {
      // Consumidor desconectou — nada a fazer, o listener de "abort" já limpa os timers.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
