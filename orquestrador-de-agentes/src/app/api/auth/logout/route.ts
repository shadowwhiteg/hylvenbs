import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { readCookie, revokeSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { ok } from "@/lib/http";

export async function POST(request: Request) {
  const guard = await requireUser(request, "authenticated", { allowPasswordChangeRequired: true });
  if (!guard.ok) return guard.response;

  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (token) await revokeSession(token);
  await audit({ actorId: guard.user.id, action: "auth.logout", targetType: "user", targetId: guard.user.id });

  const response = ok({ loggedOut: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
