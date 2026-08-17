import { z } from "zod";
import { audit } from "@/lib/audit";
import { generateTempPassword, hashPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { handleError, ok, parseBody } from "@/lib/http";

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

function serializeUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export async function GET(request: Request) {
  const guard = await requireUser(request, "user.manage");
  if (!guard.ok) return guard.response;

  const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return ok(rows.map(serializeUser));
}

export async function POST(request: Request) {
  const guard = await requireUser(request, "user.manage");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, createSchema);
  if (error) return error;

  const tempPassword = generateTempPassword();
  try {
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        role: data.role,
        passwordHash: hashPassword(tempPassword),
        mustChangePassword: true,
        createdById: guard.user.id,
      },
    });
    await audit({
      actorId: guard.user.id,
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      metadata: { role: user.role },
    });
    // Senha temporária devolvida uma única vez — nunca fica recuperável depois (RQ-AUTH-13).
    return ok({ ...serializeUser(user), tempPassword }, 201);
  } catch (err) {
    return handleError(err);
  }
}
