import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { emitRunEvent } from "@/lib/queue/events";
import { isTerminal, transition } from "@/lib/queue/state";

type Params = { params: Promise<{ id: string }> };

/** RQ-ASY-05: queued cancela na hora; running pede cancelamento cooperativo ao worker. */
export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser(request, "run.cancel");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const run = await prisma.run.findUnique({ where: { id }, select: { status: true } });
  if (!run) return fail("Execução não encontrada", 404);

  if (run.status === "queued") {
    await transition(id, ["queued"], "cancelled", {
      error: "Cancelada antes de iniciar.",
      errorType: "cancelled",
      endedAt: new Date(),
    });
    return ok({ id, status: "cancelled" }, 202);
  }

  if (run.status === "running") {
    await prisma.run.update({ where: { id }, data: { cancelRequestedAt: new Date() } });
    emitRunEvent(id);
    return ok({ id, status: "running", cancelRequested: true }, 202);
  }

  if (isTerminal(run.status)) return fail("Execução já finalizada.", 409, "already_finished");
  return fail("Estado inesperado.", 409, "invalid_state");
}
