import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/shopee/auth";
import { getRequestOrigin } from "@/lib/net/allowed-hosts";

function redirectBase(req: NextRequest): string {
  const origin = getRequestOrigin(req.headers, req.nextUrl.origin);
  try {
    return new URL(origin).origin;
  } catch {
    return req.nextUrl.origin;
  }
}

function failRedirect(base: string, reason: string) {
  const url = new URL(`${base}/settings`);
  url.searchParams.set("error", "shopee_oauth");
  url.searchParams.set("oauth_reason", reason);
  return NextResponse.redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const shopId = req.nextUrl.searchParams.get("shop_id");
  const base = redirectBase(req);

  if (!code || !shopId) {
    return failRedirect(base, "missing_code_or_shop");
  }

  try {
    const tokens = await exchangeCode(code, shopId);
    if (!tokens.access_token || tokens.access_token.length < 20) {
      throw new Error("access_token inválido na resposta da Shopee");
    }
    await saveTokens(shopId, tokens);
    return NextResponse.redirect(`${base}/settings?shopee_connected=1`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[shopee-oauth] exchange failed:", msg, { shopId });
    return failRedirect(base, "exchange_failed");
  }
}
