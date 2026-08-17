import { z } from "zod";
import { audit, clientIp } from "@/lib/audit";
import { simulatePasswordCheck, verifyPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { fail, ok, parseBody } from "@/lib/http";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, loginSchema);
  if (error) return error;

  const email = data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    simulatePasswordCheck(data.password); // não vaza se a conta existe (RQ-AUTH-12)
    return fail("Credenciais inválidas.", 401, "unauthorized");
  }

  if (user.status !== "active") {
    return fail("Conta desativada.", 403, "account_disabled");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return fail("Conta temporariamente bloqueada. Tente novamente mais tarde.", 429, "account_locked");
  }

  const valid = verifyPassword(data.password, user.passwordHash);
  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil = failedLoginCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MS) : null;
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount, lockedUntil } });
    if (lockedUntil) {
      return fail("Conta temporariamente bloqueada. Tente novamente mais tarde.", 429, "account_locked");
    }
    return fail("Credenciais inválidas.", 401, "unauthorized");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const { token, maxAgeSeconds } = await createSession(user.id, {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request),
  });
  await audit({ actorId: user.id, action: "auth.login", targetType: "user", targetId: user.id, ip: clientIp(request) });

  const response = ok({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
