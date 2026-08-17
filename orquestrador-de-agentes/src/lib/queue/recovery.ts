import { prisma } from "../db.ts";
import { forceFlush } from "../telemetry/buffer.ts";
import { log } from "../telemetry/log.ts";
import { createTraceContext } from "../telemetry/tracer.ts";
import { transition } from "./state.ts";

/**
 * Recuperação na subida (RQ-ASY-07): como o worker é in-process (T3), qualquer run em
 * `running` encontrada no boot é órfã por definição — o processo que a executava
 * morreu. Vira `failed`/`internal_error` com log explicando; nunca reexecutada
 * (ninguém roda duas vezes porque o claim exige `status='queued'`, e essas runs não
 * voltam a esse estado). Runs `queued` não precisam de ação — o worker as retoma
 * normalmente no próximo tick.
 */
export async function recoverOrphans(): Promise<void> {
  const orphans = await prisma.run.findMany({ where: { status: "running" }, select: { id: true } });
  if (orphans.length === 0) return;

  for (const { id } of orphans) {
    const ctx = createTraceContext(id);
    log.warn(ctx, "Run recuperada após reinício do processo — estava em execução sem worker vivo.", {
      errorType: "internal_error",
    });
    await transition(id, ["running"], "failed", {
      error: "Processo reiniciado com a execução em andamento.",
      errorType: "internal_error",
      endedAt: new Date(),
    });
  }
  await forceFlush();
  console.warn(`[queue] recuperação: ${orphans.length} run(s) órfã(s) marcada(s) como failed/internal_error`);
}
