import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { handleError, ok, parseBody } from "@/lib/http";
import { enqueueRun } from "@/lib/orchestrator";
import { waitForTerminal } from "@/lib/queue/state";

const runSchema = z.object({
  agentId: z.string().min(1),
  input: z.string().min(1),
  /** Fixa a execução numa versão publicada; agentId precisa ser raiz de um fluxo (RQ-VER-05). */
  flowVersion: z.union([z.number().int(), z.literal("current")]).optional(),
  /** Seleciona a cadeia de modelos do tipo de tarefa pedido (RQ-ROT-04). */
  taskType: z.string().min(1).optional(),
});

const MAX_WAIT_SECONDS = 120;
export const maxDuration = 150;

export async function GET(request: Request) {
  const guard = await requireUser(request, "run.read");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const flowId = url.searchParams.get("flowId");
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

  const runs = await prisma.run.findMany({
    where: { ...(agentId ? { agentId } : {}), ...(flowId ? { flowId } : {}), ...(status ? { status } : {}) },
    include: { agent: { select: { id: true, name: true, role: true } } },
    omit: { draftSnapshot: true },
    orderBy: { queuedAt: "desc" },
    take: limit,
  });
  return ok(runs);
}

/**
 * Enfileira a execução e responde 202 (RQ-ASY-01) — quebra de contrato assumida com o
 * antigo 201 síncrono. `?wait=<segundos>` (RQ-ASY-11) aguarda o término sem abandonar
 * o modelo assíncrono por baixo; sem ela o cliente consulta `GET /api/runs/:id` ou o
 * SSE. `Idempotency-Key` (RQ-ASY-10) devolve a run original em vez de criar outra.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request, "run.create");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, runSchema);
  if (error) return error;

  const idempotencyKey = request.headers.get("idempotency-key") || undefined;
  const url = new URL(request.url);
  const waitParam = url.searchParams.get("wait");
  const waitSeconds = waitParam ? Math.min(Math.max(Number(waitParam) || 0, 0), MAX_WAIT_SECONDS) : 0;

  try {
    const { run, deduped } = await enqueueRun(data.agentId, data.input, {
      triggeredById: guard.user.id,
      idempotencyKey,
      flowVersion: data.flowVersion,
      taskType: data.taskType,
      source: guard.viaToken ? "api" : "ui",
    });

    if (waitSeconds > 0) {
      const finalRun = await waitForTerminal(run.id, waitSeconds * 1000);
      const full = await prisma.run.findUnique({
        where: { id: (finalRun ?? run).id },
        include: {
          agent: { select: { id: true, name: true, role: true } },
          spans: { orderBy: { seq: "asc" } },
        },
        omit: { draftSnapshot: true },
      });
      return ok(full, 200);
    }

    return ok({ id: run.id, status: run.status, agentId: run.agentId }, deduped ? 200 : 202);
  } catch (err) {
    return handleError(err);
  }
}
