import { BP } from "@/lib/base-path";

const DEFAULT_HOSTS = ["localhost", "127.0.0.1", "10.131.24.6"];

/**
 * Origem pública fixa do app (ex.: https://hylvenbs.xyz), definida em
 * PUBLIC_BASE_URL. É o que substitui o Quick Tunnel em produção: quando
 * existe, é a base canônica dos callbacks de OAuth e notificações.
 * Retorna só a origem — o basePath é aplicado por quem monta a URL.
 */
export function getPublicOrigin(): string | null {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function getAllowedHosts(): string[] {
  const extra = (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const publicOrigin = getPublicOrigin();
  const publicHost = publicOrigin ? new URL(publicOrigin).hostname : null;
  return Array.from(
    new Set([...DEFAULT_HOSTS, ...extra, ...(publicHost ? [publicHost] : [])])
  );
}

export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (getAllowedHosts().includes(host)) return true;
  // Cloudflare Quick Tunnel
  if (host.endsWith(".trycloudflare.com")) return true;
  return false;
}

/** Resolve public origin from request (supports Cloudflare forwarded headers). */
export function getRequestOrigin(headers: Headers, fallbackOrigin: string): string {
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0].trim();
    const proto = (forwardedProto || "https").split(",")[0].trim();
    return `${proto}://${host}`;
  }

  const host = headers.get("host");
  if (host) {
    const hostname = host.split(":")[0];
    if (isAllowedHost(hostname)) {
      const proto =
        forwardedProto?.split(",")[0].trim() ||
        (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("10.")
          ? "http"
          : "https");
      return `${proto}://${host}`;
    }
  }

  return fallbackOrigin;
}

export function resolveCallbackUri(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (!isAllowedHost(url.hostname)) return null;
    return `${url.origin}${BP}/api/auth/ml/callback`;
  } catch {
    return null;
  }
}

export function resolveShopeeCallbackUri(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (!isAllowedHost(url.hostname)) return null;
    return `${url.origin}${BP}/api/auth/shopee/callback`;
  } catch {
    return null;
  }
}

/** Hostnames that Mercado Livre CloudFront WAF blocks in redirect_uri. */
export function isLoopbackOrPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;

  const parts = ipv4.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;

  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/**
 * ML auth.mercadolivre.com.br returns CloudFront 403 "Request blocked"
 * when redirect_uri points to localhost / private IP (http or https).
 * Public hosts (trycloudflare, ngrok, domínio) work.
 */
export function isMlWafBlockedRedirectUri(redirectUri: string): boolean {
  try {
    return isLoopbackOrPrivateHostname(new URL(redirectUri).hostname);
  } catch {
    return false;
  }
}
