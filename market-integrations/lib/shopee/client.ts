import { getShopeeCredentials, getValidAccessToken } from "@/lib/shopee/auth";
import { shopeeTimestamp, signShop } from "@/lib/shopee/sign";

const SHOPEE_API = "https://partner.shopeemobile.com";

export type ShopeeHttpResult<T> = {
  ok: boolean;
  status: number;
  data: T;
  raw: string;
  /** true quando a Shopee devolveu um `error` no corpo mesmo com HTTP 200 (comum na v2). */
  apiError: boolean;
};

type ShopeeErrorBody = { error?: string; message?: string };

/**
 * Wrapper fino: monta a querystring assinada (partner_id/timestamp/sign/access_token/shop_id)
 * e chama a API shop-level da Shopee. Sem retry embutido — cada chamador decide (mesmo padrão
 * do mlFetch em lib/ml/client.ts).
 */
export async function shopeeFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<ShopeeHttpResult<T>> {
  const { partnerId, partnerKey } = await getShopeeCredentials();
  const { accessToken, shopId } = await getValidAccessToken();
  const timestamp = shopeeTimestamp();
  const sign = signShop(partnerId, path, timestamp, partnerKey, accessToken, shopId);

  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign,
    access_token: accessToken,
    shop_id: shopId,
  });

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  // FormData precisa que o fetch defina o Content-Type sozinho (inclui o boundary).
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !headers.has("Content-Type") && !isFormData) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetchImpl(`${SHOPEE_API}${path}?${params.toString()}`, { ...init, headers });
  const raw = await res.text();
  let data = {} as T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    data = { message: raw } as T;
  }

  const apiError = Boolean((data as ShopeeErrorBody)?.error);
  return { ok: res.ok && !apiError, status: res.status, data, raw, apiError };
}

export async function updatePrice(itemId: string, price: number, fetchImpl?: typeof fetch) {
  return shopeeFetch(
    "/api/v2/product/update_price",
    {
      method: "POST",
      body: JSON.stringify({
        item_id: Number(itemId),
        price_list: [{ model_id: 0, original_price: price }],
      }),
    },
    fetchImpl
  );
}

export async function updateStock(itemId: string, stock: number, fetchImpl?: typeof fetch) {
  return shopeeFetch(
    "/api/v2/product/update_stock",
    {
      method: "POST",
      body: JSON.stringify({
        item_id: Number(itemId),
        stock_list: [{ model_id: 0, seller_stock: [{ stock: Math.max(0, stock) }] }],
      }),
    },
    fetchImpl
  );
}

export async function unlistItem(itemId: string, unlist: boolean, fetchImpl?: typeof fetch) {
  return shopeeFetch(
    "/api/v2/product/unlist_item",
    {
      method: "POST",
      body: JSON.stringify({ item_list: [{ item_id: Number(itemId), unlist }] }),
    },
    fetchImpl
  );
}

export type AddItemResponse = {
  response?: { item_id?: number; warning?: string[] };
  error?: string;
  message?: string;
};

export async function addItem(payload: Record<string, unknown>, fetchImpl?: typeof fetch) {
  return shopeeFetch<AddItemResponse>(
    "/api/v2/product/add_item",
    { method: "POST", body: JSON.stringify(payload) },
    fetchImpl
  );
}

export async function updateItem(
  itemId: string,
  payload: Record<string, unknown>,
  fetchImpl?: typeof fetch
) {
  return shopeeFetch(
    "/api/v2/product/update_item",
    { method: "POST", body: JSON.stringify({ item_id: Number(itemId), ...payload }) },
    fetchImpl
  );
}
