import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.ts";
import { SESSION_COOKIE_NAME } from "./constants.ts";

export { SESSION_COOKIE_NAME };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RENEW_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
  });
  return { token, expiresAt, maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) };
}

/** Resolve uma sessão válida e renova por deslize quando perto de expirar. */
export async function resolveSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  if (session.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt, lastSeenAt: new Date() },
    });
    session.expiresAt = expiresAt;
  }

  return session;
}

export async function revokeSession(token: string) {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token) },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsForUser(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
