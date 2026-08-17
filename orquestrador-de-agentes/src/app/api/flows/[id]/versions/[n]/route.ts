import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string; n: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.read");
  if (!guard.ok) return guard.response;

  const { id, n } = await params;
  const version = Number(n);
  if (!Number.isInteger(version)) return fail("Versão inválida", 400);

  const row = await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId: id, version } } });
  if (!row) return fail("Versão não encontrada", 404);

  return ok({
    id: row.id,
    flowId: row.flowId,
    version: row.version,
    tag: row.tag,
    message: row.message,
    contentHash: row.contentHash,
    snapshot: JSON.parse(row.snapshot),
    createdById: row.createdById,
    createdAt: row.createdAt,
  });
}
