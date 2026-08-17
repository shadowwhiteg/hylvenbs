import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "./lib/auth/constants.ts";
import { permissionForRoute } from "./lib/auth/permissions.ts";

/**
 * Só valida a FORMA da credencial (cookie presente ou header Bearer) — não toca
 * no banco. A decisão de verdade (sessão válida, permissão, senha pendente)
 * acontece em requireUser() dentro de cada handler (src/lib/auth/guard.ts).
 */
const PUBLIC_PAGES = new Set(["/login", "/setup"]);

function isAuthenticatedShape(request: NextRequest): boolean {
  if (request.cookies.has(SESSION_COOKIE_NAME)) return true;
  return Boolean(request.headers.get("authorization")?.startsWith("Bearer "));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authenticated = isAuthenticatedShape(request);

  if (pathname.startsWith("/api/")) {
    const permission = permissionForRoute(request.method, pathname);
    if (permission === "public" || authenticated) return NextResponse.next();
    return NextResponse.json({ error: "Não autenticado.", code: "unauthorized" }, { status: 401 });
  }

  if (PUBLIC_PAGES.has(pathname) || authenticated) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
