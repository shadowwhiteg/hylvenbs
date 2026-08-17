import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const guard = await requireUser(request, "token.self");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const token = await prisma.apiToken.findUnique({ where: { id } });
  if (!token) return fail("Token não encontrado.", 404);
  if (token.userId !== guard.user.id && guard.user.role !== "admin") {
    return fail("Sem permissão para esta ação.", 403, "forbidden");
  }

  try {
    await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit({ actorId: guard.user.id, action: "token.revoked", targetType: "apiToken", targetId: id });
    return ok({ revoked: true });
  } catch (err) {
    return handleError(err);
  }
}
