import { prisma } from "../db.ts";
import { emitRunEvent, onRunEvent } from "./events.ts";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

/** "failed" aqui é sempre final — quando reprocessável, a run volta para "queued" em vez de parar em "failed". */
export const TERMINAL_STATES: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATES.has(status as RunStatus);
}

/**
 * Transição de estado com guarda (RQ-ASY-02): só aplica se o status atual estiver em
 * `from`. Zero linhas afetadas = transição inválida (corrida perdida, run já em
 * estado terminal, cancelamento simultâneo…) — devolve `false`, nunca lança.
 */
export async function transition(
  runId: string,
  from: RunStatus[],
  to: RunStatus,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  const result = await prisma.run.updateMany({
    where: { id: runId, status: { in: from } },
    data: { status: to, ...data },
  });
  const ok = result.count > 0;
  if (ok) emitRunEvent(runId);
  return ok;
}

/** `?wait=` (RQ-ASY-11): espera até a run entrar num estado terminal ou o tempo acabar. */
export async function waitForTerminal(runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run || isTerminal(run.status)) return run;
    if (Date.now() >= deadline) return run;

    const remaining = Math.max(0, Math.min(300, deadline - Date.now()));
    await new Promise<void>((resolve) => {
      let off: () => void = () => undefined;
      const timer = setTimeout(() => {
        off();
        resolve();
      }, remaining);
      off = onRunEvent(runId, () => {
        clearTimeout(timer);
        off();
        resolve();
      });
    });
  }
}
