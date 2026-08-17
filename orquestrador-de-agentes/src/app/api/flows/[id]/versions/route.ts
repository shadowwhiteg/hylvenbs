import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const flow = await prisma.flow.findUnique({ where: { id }, select: { id: true } });
  if (!flow) return fail("Fluxo não encontrado", 404);

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

  const rows = await prisma.flowVersion.findMany({
    where: { flowId: id },
    select: { id: true, version: true, tag: true, message: true, contentHash: true, createdById: true, createdAt: true },
    orderBy: { version: "desc" },
    take: limit,
  });
  return ok(rows);
}
