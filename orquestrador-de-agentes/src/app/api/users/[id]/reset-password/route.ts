import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { generateTempPassword, hashPassword } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { handleError, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser(request, "user.manage");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const tempPassword = generateTempPassword();

  try {
    await prisma.user.update({
      where: { id },
      data: { passwordHash: hashPassword(tempPassword), mustChangePassword: true },
    });
    await revokeAllSessionsForUser(id); // força relogin com a nova senha
    await audit({ actorId: guard.user.id, action: "user.password_reset", targetType: "user", targetId: id });
    return ok({ tempPassword });
  } catch (err) {
    return handleError(err);
  }
}
