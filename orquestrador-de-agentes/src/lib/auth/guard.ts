import { NextResponse } from "next/server";
import { fail } from "../http.ts";
import { hasPermission, type Permission, type Role } from "./permissions.ts";
import { readCookie, resolveSession, SESSION_COOKIE_NAME } from "./session.ts";
import { resolveApiToken } from "./tokens.ts";

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
};

/** viaToken: true quando autenticado por `Authorization: Bearer` — origem "api" das runs (RQ-OAI-11). */
export type GuardResult =
  | { ok: true; user: AuthedUser; viaToken: boolean }
  | { ok: false; response: NextResponse };

/** true quando a requisição chegou via `Authorization: Bearer` (token de API). */
export async function resolveRequestUser(
  request: Request,
): Promise<{ user: AuthedUser; viaToken: boolean } | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiToken = await resolveApiToken(authHeader.slice(7));
    if (!apiToken || apiToken.user.status !== "active") return null;
    return { user: toAuthedUser(apiToken.user), viaToken: true };
  }

  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!token) return null;
  const session = await resolveSession(token);
  if (!session || session.user.status !== "active") return null;
  return { user: toAuthedUser(session.user), viaToken: false };
}

function toAuthedUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
}): AuthedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Guarda de autorização para rotas autenticadas. Nega por omissão: sem sessão/token
 * válido → 401; sem a permissão exigida → 403; senha pendente de troca → 403
 * (a menos que a rota esteja na lista de exceção, ex. change-password).
 */
export async function requireUser(
  request: Request,
  permission: Exclude<Permission, "public">,
  opts?: { allowPasswordChangeRequired?: boolean },
): Promise<GuardResult> {
  const resolved = await resolveRequestUser(request);
  if (!resolved) return { ok: false, response: fail("Não autenticado.", 401, "unauthorized") };

  const { user, viaToken } = resolved;
  if (!opts?.allowPasswordChangeRequired && user.mustChangePassword) {
    return {
      ok: false,
      response: fail("Troca de senha obrigatória.", 403, "password_change_required"),
    };
  }
  if (!hasPermission(user.role, permission)) {
    return { ok: false, response: fail("Sem permissão para esta ação.", 403, "forbidden") };
  }
  return { ok: true, user, viaToken };
}
