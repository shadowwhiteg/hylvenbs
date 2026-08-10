import { prisma } from "@/lib/db";
import { resolveShopeePartnerKey } from "@/lib/settings";
import { shopeeTimestamp, signPublic } from "@/lib/shopee/sign";

const SHOPEE_API = "https://partner.shopeemobile.com";
const AUTH_PARTNER_PATH = "/api/v2/shop/auth_partner";
const TOKEN_GET_PATH = "/api/v2/auth/token/get";
const TOKEN_REFRESH_PATH = "/api/v2/auth/access_token/get";

export async function getShopeeCredentials() {
  const partnerId = process.env.SHOPEE_PARTNER_ID || "";
  const partnerKey = await resolveShopeePartnerKey();
  return { partnerId, partnerKey };
}

/**
 * URL de autorização — a própria URL de redirect do navegador precisa ser assinada
 * (diferente do ML, que não assina a URL de authorize).
 */
export async function buildAuthorizeUrl(redirectUri: string): Promise<string> {
  const { partnerId, partnerKey } = await getShopeeCredentials();
  const timestamp = shopeeTimestamp();
  const sign = signPublic(partnerId, AUTH_PARTNER_PATH, timestamp, partnerKey);
  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign,
    redirect: redirectUri,
  });
  return `${SHOPEE_API}${AUTH_PARTNER_PATH}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  shop_id?: number;
  error?: string;
  message?: string;
};

async function tokenRequest(path: string, body: Record<string, unknown>): Promise<TokenResponse> {
  const { partnerId, partnerKey } = await getShopeeCredentials();
  const timestamp = shopeeTimestamp();
  const sign = signPublic(partnerId, path, timestamp, partnerKey);
  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign,
  });

  const res = await fetch(`${SHOPEE_API}${path}?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partner_id: Number(partnerId), ...body }),
  });

  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    throw new Error(`Shopee OAuth falhou: ${data.error || res.status} ${data.message || ""}`.trim());
  }
  return data;
}

export async function exchangeCode(code: string, shopId: string): Promise<TokenResponse> {
  return tokenRequest(TOKEN_GET_PATH, { code, shop_id: Number(shopId) });
}

export async function refreshAccessToken(
  refreshToken: string,
  shopId: string
): Promise<TokenResponse> {
  return tokenRequest(TOKEN_REFRESH_PATH, {
    refresh_token: refreshToken,
    shop_id: Number(shopId),
  });
}

export async function saveTokens(shopId: string, token: TokenResponse): Promise<void> {
  const now = Date.now();
  const expiresAt = new Date(now + token.expire_in * 1000);
  // Refresh token da Shopee dura ~30 dias; a API não devolve esse prazo, então fixamos aqui.
  const refreshExpiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);
  await prisma.shopeeToken.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      shopId,
      expiresAt,
      refreshExpiresAt,
    },
    update: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      shopId,
      expiresAt,
      refreshExpiresAt,
    },
  });
}

export function isUsableAccessToken(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  if (accessToken.length < 20) return false;
  if (/^(test|fake|placeholder|dummy)/i.test(accessToken)) return false;
  return true;
}

export async function clearStoredTokens(): Promise<void> {
  await prisma.shopeeToken.delete({ where: { id: "default" } }).catch(() => undefined);
}

export async function hasShopeeToken(): Promise<boolean> {
  const row = await prisma.shopeeToken.findUnique({ where: { id: "default" } });
  return isUsableAccessToken(row?.accessToken);
}

/** Retorna o access_token válido + shop_id, renovando se faltar pouco (token dura só 4h). */
export async function getValidAccessToken(): Promise<{ accessToken: string; shopId: string }> {
  const row = await prisma.shopeeToken.findUnique({ where: { id: "default" } });
  if (!row || !isUsableAccessToken(row.accessToken)) {
    throw new Error("Shopee não conectada — autorize em Configurações");
  }

  const skewMs = 30 * 60 * 1000;
  if (row.expiresAt.getTime() - Date.now() > skewMs) {
    return { accessToken: row.accessToken, shopId: row.shopId };
  }

  if (row.refreshExpiresAt.getTime() <= Date.now()) {
    await clearStoredTokens();
    throw new Error("Refresh token da Shopee expirou (30 dias) — reconecte em Configurações");
  }

  const refreshed = await refreshAccessToken(row.refreshToken, row.shopId);
  await saveTokens(row.shopId, refreshed);
  return { accessToken: refreshed.access_token, shopId: row.shopId };
}

export async function getAuthStatus(): Promise<{ connected: boolean; shopId?: string }> {
  const row = await prisma.shopeeToken.findUnique({ where: { id: "default" } });
  if (!row || !isUsableAccessToken(row.accessToken)) {
    return { connected: false };
  }
  return { connected: true, shopId: row.shopId };
}
