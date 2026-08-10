import { prisma } from "@/lib/db";
import { resolveMlClientSecret } from "@/lib/settings";

const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export async function getMlCredentials() {
  const appId = process.env.ML_APP_ID || "";
  const clientSecret = await resolveMlClientSecret();
  const redirectUri = process.env.ML_REDIRECT_URI || "";
  return { appId, clientSecret, redirectUri };
}

export async function buildAuthorizeUrl(
  redirectUri: string,
  state = "ml"
): Promise<string> {
  const { appId } = await getMlCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: appId,
    redirect_uri: redirectUri,
    state,
  });
  return `${ML_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id?: number | string;
};

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const { appId, clientSecret } = await getMlCredentials();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: appId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth exchange failed: ${res.status} ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { appId, clientSecret } = await getMlCredentials();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: appId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth refresh failed: ${res.status} ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

export async function saveTokens(token: TokenResponse): Promise<void> {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  await prisma.mlToken.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      userId: token.user_id != null ? String(token.user_id) : null,
    },
    update: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      userId: token.user_id != null ? String(token.user_id) : null,
    },
  });
}

/** Tokens de teste/placeholder não contam como conexão real. */
export function isUsableAccessToken(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  if (accessToken.length < 20) return false;
  if (/^(test|fake|placeholder|dummy)/i.test(accessToken)) return false;
  return true;
}

export async function clearStoredTokens(): Promise<void> {
  await prisma.mlToken.delete({ where: { id: "default" } }).catch(() => undefined);
}

export async function getValidAccessToken(): Promise<string> {
  const row = await prisma.mlToken.findUnique({ where: { id: "default" } });
  if (!row || !isUsableAccessToken(row.accessToken)) {
    throw new Error("Mercado Livre não conectado — autorize em Configurações");
  }

  const skewMs = 5 * 60 * 1000;
  if (row.expiresAt.getTime() - Date.now() > skewMs) {
    return row.accessToken;
  }

  if (!row.refreshToken || row.refreshToken.length < 10) {
    await clearStoredTokens();
    throw new Error("Refresh token inválido — reconecte o Mercado Livre");
  }

  const refreshed = await refreshAccessToken(row.refreshToken);
  await saveTokens(refreshed);
  return refreshed.access_token;
}

export async function getAuthStatus(): Promise<{
  connected: boolean;
  userId?: string;
  tokenValid?: boolean;
}> {
  const row = await prisma.mlToken.findUnique({ where: { id: "default" } });
  if (!row || !isUsableAccessToken(row.accessToken)) {
    return { connected: false, tokenValid: false };
  }
  return {
    connected: true,
    userId: row.userId ?? undefined,
    tokenValid: true,
  };
}

/** Confirma o token atual com /users/me. Em falha, limpa token inválido. */
export async function verifyStoredAccessToken(
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const row = await prisma.mlToken.findUnique({ where: { id: "default" } });
  if (!row || !isUsableAccessToken(row.accessToken)) {
    return { ok: false, error: "Nenhum token OAuth válido armazenado" };
  }

  let token = row.accessToken;
  try {
    token = await getValidAccessToken();
  } catch (e) {
    await clearStoredTokens();
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao renovar token",
    };
  }

  const res = await fetchImpl("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    await clearStoredTokens();
    return {
      ok: false,
      error: `Token rejeitado pelo ML (${res.status}). Reconecte em Configurações.`,
    };
  }

  let userId = row.userId ?? undefined;
  try {
    const data = JSON.parse(text) as { id?: number | string };
    if (data.id != null) {
      userId = String(data.id);
      await prisma.mlToken.update({
        where: { id: "default" },
        data: { userId },
      });
    }
  } catch {
    // ignore parse
  }

  return { ok: true, userId };
}
