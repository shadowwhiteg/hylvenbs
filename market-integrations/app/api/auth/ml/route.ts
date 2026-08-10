import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, getMlCredentials } from "@/lib/ml/auth";
import {
  getRequestOrigin,
  isLoopbackOrPrivateHostname,
  isMlWafBlockedRedirectUri,
  resolveCallbackUri,
  getPublicOrigin,
} from "@/lib/net/allowed-hosts";
import { getTunnelUrl } from "@/lib/tunnel/manager";
import { BP } from "@/lib/base-path";

function settingsErrorRedirect(req: NextRequest, code: string) {
  const origin = getRequestOrigin(req.headers, req.nextUrl.origin);
  const base = (() => {
    try {
      return new URL(origin).origin;
    } catch {
      return req.nextUrl.origin;
    }
  })();
  return NextResponse.redirect(`${base}${BP}/settings?error=${code}`);
}

function resolveOAuthRedirectUri(origin: string): string {
  const fromOrigin = resolveCallbackUri(origin) || "";
  const tunnelUrl = getTunnelUrl();
  const envUri = process.env.ML_REDIRECT_URI || "";

  // Com domínio próprio (PUBLIC_BASE_URL) o redirect_uri é sempre o dele:
  // é o único valor que bate com o cadastrado no DevCenter, mesmo quando o
  // app é aberto por localhost durante manutenção no servidor.
  const publicOrigin = getPublicOrigin();
  if (publicOrigin) {
    return `${publicOrigin}${BP}/api/auth/ml/callback`;
  }

  // Prefer tunnel when the browser origin is private (LAN/localhost)
  // so "Conectar" works even if the user opened via IP.
  if (tunnelUrl) {
    try {
      const host = new URL(origin).hostname;
      if (isLoopbackOrPrivateHostname(host)) {
        return `${tunnelUrl.replace(/\/$/, "")}${BP}/api/auth/ml/callback`;
      }
    } catch {
      // fall through
    }
  }

  if (fromOrigin && !isMlWafBlockedRedirectUri(fromOrigin)) {
    return fromOrigin;
  }

  if (tunnelUrl) {
    return `${tunnelUrl.replace(/\/$/, "")}${BP}/api/auth/ml/callback`;
  }

  if (envUri && !isMlWafBlockedRedirectUri(envUri)) {
    return envUri;
  }

  return fromOrigin || envUri;
}

export async function GET(req: NextRequest) {
  const { appId, clientSecret } = await getMlCredentials();
  if (!appId) {
    return settingsErrorRedirect(req, "ml_app_id");
  }
  if (!clientSecret) {
    return settingsErrorRedirect(req, "ml_secret");
  }

  const origin = getRequestOrigin(req.headers, req.nextUrl.origin);
  const redirectUri = resolveOAuthRedirectUri(origin);

  if (!redirectUri) {
    return settingsErrorRedirect(req, "oauth_origin");
  }

  // CloudFront WAF do ML bloqueia redirect_uri com localhost/IP privado
  // (403 "Request blocked"). Exigir host público (ex.: trycloudflare).
  if (isMlWafBlockedRedirectUri(redirectUri)) {
    return settingsErrorRedirect(req, "oauth_private_redirect");
  }

  const res = NextResponse.redirect(await buildAuthorizeUrl(redirectUri));
  res.cookies.set("ml_oauth_redirect_uri", redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: redirectUri.startsWith("https://"),
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
