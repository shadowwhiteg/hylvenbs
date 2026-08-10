import { createHmac } from "crypto";

/** Timestamp em segundos — a Shopee rejeita milissegundos. */
export function shopeeTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Assinatura pública (sem shop): partner_id + path + timestamp.
 * Usada em /api/v2/shop/auth_partner e /api/v2/auth/token/get|refresh.
 */
export function signPublic(
  partnerId: string,
  path: string,
  timestamp: number,
  partnerKey: string
): string {
  const base = `${partnerId}${path}${timestamp}`;
  return createHmac("sha256", partnerKey).update(base).digest("hex");
}

/**
 * Assinatura autenticada: partner_id + path + timestamp + access_token + shop_id.
 * Usada em toda chamada shop-level (product, logistics, etc).
 */
export function signShop(
  partnerId: string,
  path: string,
  timestamp: number,
  partnerKey: string,
  accessToken: string,
  shopId: string
): string {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return createHmac("sha256", partnerKey).update(base).digest("hex");
}
