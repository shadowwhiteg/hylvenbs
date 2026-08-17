import { randomBytes } from "node:crypto";
import { prisma } from "../db.ts";
import { hashToken } from "./session.ts";

const TOKEN_PREFIX = "oaa_";

/** Gera um token de API completo — devolvido ao cliente uma única vez. */
export function generateApiToken(): { token: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { token, prefix: token.slice(0, 8) };
}

/** Resolve um token de API válido e atualiza lastUsedAt no máximo 1x/minuto. */
export async function resolveApiToken(token: string) {
  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!apiToken || apiToken.revokedAt) return null;
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) return null;

  if (!apiToken.lastUsedAt || Date.now() - apiToken.lastUsedAt.getTime() > 60_000) {
    await prisma.apiToken.update({ where: { id: apiToken.id }, data: { lastUsedAt: new Date() } });
  }
  return apiToken;
}
