import { z } from "zod";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";

const setupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

/** Enquanto não há nenhum usuário: diz se o setup ainda é necessário. Depois, 404. */
export async function GET() {
  const count = await prisma.user.count();
  if (count > 0) return fail("Não encontrado.", 404, "not_found");
  return ok({ needed: true });
}

/** Cria o primeiro admin. Re-checa dentro da transação para não haver corrida (RQ-AUTH-05). */
export async function POST(request: Request) {
  const { data, error } = await parseBody(request, setupSchema);
  if (error) return error;

  try {
    const user = await prisma.$transaction(async (tx) => {
      const count = await tx.user.count();
      if (count > 0) throw new SetupAlreadyDoneError();
      return tx.user.create({
        data: {
          email: data.email.toLowerCase(),
          name: data.name,
          passwordHash: hashPassword(data.password),
          role: "admin",
          mustChangePassword: false,
        },
      });
    });

    await audit({ actorId: user.id, action: "auth.bootstrap", targetType: "user", targetId: user.id });
    return ok({ id: user.id, email: user.email, name: user.name }, 201);
  } catch (err) {
    if (err instanceof SetupAlreadyDoneError) return fail("Não encontrado.", 404, "not_found");
    return handleError(err);
  }
}

class SetupAlreadyDoneError extends Error {}
