import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/ml/auth";
import {
  getRequestOrigin,
  resolveCallbackUri,
} from "@/lib/net/allowed-hosts";
import { BP } from "@/lib/base-path";

function redirectBase(req: NextRequest): string {
  const origin = getRequestOrigin(req.headers, req.nextUrl.origin);
  try {
    return new URL(origin).origin;
  } catch {
    return req.nextUrl.origin;
  }
}

function failRedirect(base: string, reason: string) {
  const url = new URL(`${base}${BP}/settings`);
  url.searchParams.set("error", "oauth");
  url.searchParams.set("oauth_reason", reason);
  return NextResponse.redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error");
  const oauthErrorDesc = req.nextUrl.searchParams.get("error_description");
  const base = redirectBase(req);

  if (oauthError) {
    console.error("[ml-oauth] callback error from ML:", oauthError, oauthErrorDesc);
    return failRedirect(
      base,
      oauthError === "redirect_uri_mismatch"
        ? "redirect_uri_mismatch"
        : "ml_denied"
    );
  }

  if (!code) {
    return failRedirect(base, "missing_code");
  }

  const cookieUri = req.cookies.get("ml_oauth_redirect_uri")?.value;
  const redirectUri =
    cookieUri ||
    resolveCallbackUri(base) ||
    process.env.ML_REDIRECT_URI ||
    "";

  try {
    if (!redirectUri) throw new Error("redirect_uri missing");
    const tokens = await exchangeCode(code, redirectUri);
    if (!tokens.access_token || tokens.access_token.length < 20) {
      throw new Error("access_token inválido na resposta do ML");
    }
    await saveTokens(tokens);
    const res = NextResponse.redirect(`${base}${BP}/settings?connected=1`);
    res.cookies.delete("ml_oauth_redirect_uri");
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ml-oauth] exchange failed:", msg, { redirectUri });
    const reason = /redirect_uri|invalid_grant|client/i.test(msg)
      ? "exchange_failed"
      : "exchange_failed";
    const res = failRedirect(base, reason);
    res.cookies.delete("ml_oauth_redirect_uri");
    return res;
  }
}

/** ML pode POSTAR validação/webhook por engano se a URL de notificações estiver errada. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Este endpoint é só para OAuth (GET). Em DevCenter, a URL de notificações deve ser /api/ml/notifications — não o callback OAuth.",
    },
    { status: 405 }
  );
}
