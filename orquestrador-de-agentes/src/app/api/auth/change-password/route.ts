import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { fail, ok, parseBody } from "@/lib/http";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(request: Request) {
  const guard = await requireUser(request, "authenticated", { allowPasswordChangeRequired: true });
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, schema);
  if (error) return error;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: guard.user.id } });
  if (!verifyPassword(data.currentPassword, user.passwordHash)) {
    return fail("Senha atual incorreta.", 401, "unauthorized");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(data.newPassword), mustChangePassword: false },
  });
  await audit({ actorId: user.id, action: "auth.password_changed", targetType: "user", targetId: user.id });

  return ok({ changed: true });
}
