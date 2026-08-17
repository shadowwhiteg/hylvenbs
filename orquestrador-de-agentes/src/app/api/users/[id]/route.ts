import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "editor", "viewer"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser(request, "user.manage");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await parseBody(request, updateSchema);
  if (error) return error;

  try {
    const row = await prisma.user.update({ where: { id }, data });
    await audit({ actorId: guard.user.id, action: "user.updated", targetType: "user", targetId: id, metadata: data });
    return ok({ id: row.id, email: row.email, name: row.name, role: row.role, status: row.status });
  } catch (err) {
    return handleError(err);
  }
}

/** Desativação lógica: revoga sessões/tokens, mas nunca apaga a linha (preserva autoria). */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await requireUser(request, "user.manage");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (id === guard.user.id) return fail("Você não pode desativar a própria conta.", 400, "invalid_operation");

  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { status: "disabled" } }),
      prisma.apiToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await revokeAllSessionsForUser(id);
    await audit({ actorId: guard.user.id, action: "user.disabled", targetType: "user", targetId: id });
    return ok({ deactivated: true });
  } catch (err) {
    return handleError(err);
  }
}
