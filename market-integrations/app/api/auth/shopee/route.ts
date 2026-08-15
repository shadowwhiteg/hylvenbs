import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, getShopeeCredentials } from "@/lib/shopee/auth";
import {
  getRequestOrigin,
  isLoopbackOrPrivateHostname,
  resolveShopeeCallbackUri,
} from "@/lib/net/allowed-hosts";
import { getTunnelUrl } from "@/lib/tunnel/manager";

function settingsErrorRedirect(req: NextRequest, code: string) {
  const origin = getRequestOrigin(req.headers, req.nextUrl.origin);
  const base = (() => {
    try {
      return new URL(origin).origin;
    } catch {
      return req.nextUrl.origin;
    }
  })();
  return NextResponse.redirect(`${base}/settings?error=${code}`);
}

/**
 * A Shopee exige que o domínio de redirect esteja pré-cadastrado no app do Partner
 * (open.shopee.com). Preferimos o túnel público quando a origem é privada (LAN/localhost)
 * pelo mesmo motivo do ML: só um host público funciona de fora.
 */
function resolveShopeeRedirectUri(origin: string): string {
  const fromOrigin = resolveShopeeCallbackUri(origin) || "";
  const tunnelUrl = getTunnelUrl();
  const envUri = process.env.SHOPEE_REDIRECT_URI || "";

  if (tunnelUrl) {
    try {
      const host = new URL(origin).hostname;
      if (isLoopbackOrPrivateHostname(host)) {
        return `${tunnelUrl.replace(/\/$/, "")}/api/auth/shopee/callback`;
      }
    } catch {
      // fall through
    }
  }

  if (fromOrigin) return fromOrigin;
  if (tunnelUrl) return `${tunnelUrl.replace(/\/$/, "")}/api/auth/shopee/callback`;
  return envUri;
}

export async function GET(req: NextRequest) {
  const { partnerId, partnerKey } = await getShopeeCredentials();
  if (!partnerId) {
    return settingsErrorRedirect(req, "shopee_partner_id");
  }
  if (!partnerKey) {
    return settingsErrorRedirect(req, "shopee_partner_key");
  }

  const origin = getRequestOrigin(req.headers, req.nextUrl.origin);
  const redirectUri = resolveShopeeRedirectUri(origin);
  if (!redirectUri) {
    return settingsErrorRedirect(req, "oauth_origin");
  }

  // Diferente do ML, o token exchange da Shopee não exige redirect_uri de volta —
  // code + shop_id + partner_id bastam — então não há cookie de redirect pra manter aqui.
  return NextResponse.redirect(await buildAuthorizeUrl(redirectUri));
}
