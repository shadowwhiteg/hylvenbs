import { randomUUID } from "node:crypto";
import { prisma } from "../db.ts";
import { executeQueuedRun } from "../orchestrator.ts";
import { getSettingNumber } from "../settings.ts";
import { onRunEvent } from "./events.ts";

/**
 * Worker in-process (T3, D1/D2 do design 004): fila no próprio SQLite, claim atômico
 * via `UPDATE ... WHERE status='queued' ... RETURNING`, concorrência configurável
 * (`Setting.queue.concurrency`). Sem serviço externo.
 */

const TICK_MS = 500;
const HEARTBEAT_MS = 10_000;
export const WORKER_ID = randomUUID();

type Claimed = { id: string; timeoutMs: number };

const active = new Map<string, AbortController>();
let intervalHandle: NodeJS.Timeout | null = null;
let ticking = false;

export async function claimNext(): Promise<Claimed | null> {
  const now = new Date();
  const rows = await prisma.$queryRaw<Claimed[]>`
    UPDATE Run
       SET status = 'running',
           lockedBy = ${WORKER_ID},
           lockedAt = ${now},
           heartbeatAt = ${now},
           startedAt = COALESCE(startedAt, ${now}),
           attempt = attempt + 1
     WHERE id = (
       SELECT id FROM Run
        WHERE status = 'queued' AND (nextAttemptAt IS NULL OR nextAttemptAt <= ${now})
        ORDER BY priority DESC, queuedAt ASC
        LIMIT 1
     ) AND status = 'queued'
    RETURNING id, timeoutMs
  `;
  return rows[0] ?? null;
}

async function checkCancellations(): Promise<void> {
  if (active.size === 0) return;
  const rows = await prisma.run.findMany({
    where: { id: { in: [...active.keys()] }, cancelRequestedAt: { not: null } },
    select: { id: true },
  });
  for (const row of rows) {
    const controller = active.get(row.id);
    if (controller && !controller.signal.aborted) controller.abort("cancelled");
  }
}

/** Lança a execução da run já reivindicada. Marca `active` de forma síncrona para o limite de concorrência valer dentro do mesmo tick. */
function runOne(claimed: Claimed): void {
  const controller = new AbortController();
  active.set(claimed.id, controller);

  const timeoutTimer = setTimeout(() => controller.abort("timeout"), claimed.timeoutMs);
  const heartbeatTimer = setInterval(() => {
    prisma.run.update({ where: { id: claimed.id }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
  }, HEARTBEAT_MS);
  const stopWatchingCancel = onRunEvent(claimed.id, () => void checkCancellations());

  void executeQueuedRun(claimed.id, controller.signal)
    .catch((err) => console.error(`[queue] execução da run ${claimed.id} lançou inesperadamente:`, err))
    .finally(() => {
      clearTimeout(timeoutTimer);
      clearInterval(heartbeatTimer);
      stopWatchingCancel();
      active.delete(claimed.id);
    });
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await checkCancellations();
    const concurrency = Math.max(1, Math.round(await getSettingNumber("queue.concurrency")));
    while (active.size < concurrency) {
      const claimed = await claimNext();
      if (!claimed) break;
      runOne(claimed);
    }
  } catch (err) {
    console.error("[queue] erro no tick do worker:", err);
  } finally {
    ticking = false;
  }
}

/** Estatísticas para `GET /api/health` — RQ-ASY-12. */
export function activeCount(): number {
  return active.size;
}

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => void tick(), TICK_MS);
  if (typeof intervalHandle.unref === "function") intervalHandle.unref();
  void tick();
}
