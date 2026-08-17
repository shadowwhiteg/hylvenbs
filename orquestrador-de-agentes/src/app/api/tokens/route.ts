import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { hashToken } from "@/lib/auth/session";
import { generateApiToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { handleError, ok, parseBody } from "@/lib/http";

const createSchema = z.object({
  name: z.string().min(1),
  expiresAt: z.string().datetime().nullish(),
});

function serializeToken(t: {
  id: string;
  name: string;
  prefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  user?: { id: string; name: string; email: string };
}) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    revoked: Boolean(t.revokedAt),
    createdAt: t.createdAt,
    owner: t.user ? { id: t.user.id, name: t.user.name, email: t.user.email } : undefined,
  };
}

export async function GET(request: Request) {
  const guard = await requireUser(request, "token.self");
  if (!guard.ok) return guard.response;

  const rows = await prisma.apiToken.findMany({
    where: guard.user.role === "admin" ? {} : { userId: guard.user.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  return ok(rows.map(serializeToken));
}

export async function POST(request: Request) {
  const guard = await requireUser(request, "token.self");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, createSchema);
  if (error) return error;

  const { token, prefix } = generateApiToken();
  try {
    const row = await prisma.apiToken.create({
      data: {
        userId: guard.user.id,
        name: data.name,
        prefix,
        tokenHash: hashToken(token),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
    await audit({ actorId: guard.user.id, action: "token.created", targetType: "apiToken", targetId: row.id });
    // O token completo só existe nesta resposta — nunca mais recuperável (RQ-AUTH-09).
    return ok({ ...serializeToken(row), token }, 201);
  } catch (err) {
    return handleError(err);
  }
}
