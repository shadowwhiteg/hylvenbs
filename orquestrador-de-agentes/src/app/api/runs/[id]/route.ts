import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "run.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      agent: { select: { id: true, name: true, role: true } },
      spans: { orderBy: { seq: "asc" }, include: { agent: { select: { id: true, name: true } } } },
    },
    omit: { draftSnapshot: true },
  });
  if (!run) return fail("Execução não encontrada", 404);
  return ok(run);
}
