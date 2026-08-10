import type { ScrapeSession } from "@/lib/scrape/session";
import { USER_AGENT, type WmdPublishConfig } from "@/lib/oneclick/session";

type SearchResult = { id: number; text: string };

/** Normalize SKU for Meu Drop search / exact match (trim + case-fold). */
export function normalizeOneClickSku(sku: string): string {
  return sku.trim();
}

function extractSkuFromSearchText(text: string): string | null {
  const match = text.match(/\(SKU:\s*([^)]+)\)/i);
  return match ? match[1].trim() : null;
}

/** Prefer exact SKU match in picker results; ignore title-only hits. */
export function pickSearchResultBySku(
  results: SearchResult[],
  sku: string
): SearchResult | null {
  if (!results.length) return null;
  const needle = normalizeOneClickSku(sku).toLowerCase();
  const exact = results.find((r) => {
    const extracted = extractSkuFromSearchText(r.text);
    if (extracted && extracted.toLowerCase() === needle) return true;
    return r.text.toLowerCase().includes(`(sku: ${needle})`);
  });
  return exact ?? null;
}

/**
 * O picker do Meu Drop também varre a descrição do produto, então códigos curtos
 * ("1001") podem ser roubados por um produto sem relação cujo texto contém o
 * número — o item certo nem aparece nos resultados. Buscar pelo início do título
 * é o plano B; o SKU exato continua sendo exigido para aceitar o resultado.
 */
export function buildTitleSearchQuery(title: string, maxWords = 6): string {
  return title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

async function fetchPickerResults(
  session: ScrapeSession,
  wmd: WmdPublishConfig,
  query: string
): Promise<SearchResult[]> {
  const url = `${wmd.ajaxurl}?action=wmd_search_products&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Cookie: session.jar.header(), "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Busca por SKU falhou (HTTP ${res.status})`);
  const results = (await res.json()) as SearchResult[];
  return Array.isArray(results) ? results : [];
}

/**
 * Searches Meu Drop's own product picker (name or SKU) — same endpoint the One
 * Click UI uses. Quando a busca pelo código não acha, tenta pelo título.
 */
export async function searchProductBySku(
  session: ScrapeSession,
  wmd: WmdPublishConfig,
  sku: string,
  fallbackTitle?: string | null
): Promise<{ id: number; text: string } | null> {
  const q = normalizeOneClickSku(sku);
  if (!q) return null;

  // Prefer an exact "(SKU: xxx)" match; do not fall back to a title-only hit
  // (that published the wrong product when the SKU itself is absent from the picker).
  const bySku = pickSearchResultBySku(await fetchPickerResults(session, wmd, q), q);
  if (bySku) return bySku;

  const titleQuery = buildTitleSearchQuery(fallbackTitle ?? "");
  if (!titleQuery || titleQuery.toLowerCase() === q.toLowerCase()) return null;

  return pickSearchResultBySku(await fetchPickerResults(session, wmd, titleQuery), q);
}

export type PublishMlItem = {
  id: number;
  price: number | null;
  gtin: string | null;
  listing_type?: string;
};

/**
 * `item_id` chega como número na Shopee e como string ("MLB…") no ML. Tipar só
 * como string fazia o número vazar para o Prisma e explodir o update do item —
 * o anúncio nascia no marketplace e o id se perdia. Use `oneClickItemId()`.
 */
export type OneClickItemId = string | number;

/** Normaliza o id do anúncio para string; devolve null quando não veio nada. */
export function oneClickItemId(value: OneClickItemId | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export type MlPublishResultItem = {
  ok: boolean;
  item_id?: OneClickItemId;
  linked?: boolean;
  error?: string;
};

export async function publishMl(
  session: ScrapeSession,
  wmd: WmdPublishConfig,
  items: PublishMlItem[]
): Promise<Record<string, MlPublishResultItem>> {
  const res = await fetch(wmd.restPublish, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WP-Nonce": wmd.restNonce,
      Cookie: session.jar.header(),
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      items: items.map((item) => ({
        id: item.id,
        price: item.price,
        stock: null,
        gtin: item.gtin,
        force_create: false,
        listing_type: item.listing_type || "gold_special",
      })),
    }),
  });
  if (!res.ok) throw new Error(`Publicação ML falhou (HTTP ${res.status})`);
  const json = await res.json();
  return json.results || {};
}

export type PublishShopeeItem = { id: number; price: number | null };

export type ShopeePublishResultItem = {
  ok: boolean;
  item_id?: OneClickItemId;
  error?: string;
  needs_link?: boolean;
  existing_item?: { item_id?: OneClickItemId; item_sku?: string; item_name?: string };
};

export type OneClickUpdateResult = {
  ok: boolean;
  message?: string;
  results?: Record<string, { ok?: boolean; error?: string }>;
};

/**
 * Atualiza o PREÇO de um anúncio que já existe no marketplace.
 *
 * Republicar (`publishMl`/`publishShopee`) não serve para isso: o plugin
 * responde `linked`/`needs_link` e não toca no preço. A tela do Meu Drop usa um
 * endpoint próprio ("Atualizar preço"), com `{ items: [{ id, price }] }` — para
 * a Shopee o `id` é o product_id do Woo, o mesmo que `searchProductBySku` devolve.
 */
export async function updateOneClickPrice(
  session: ScrapeSession,
  wmd: WmdPublishConfig,
  marketplace: "ml" | "shopee",
  items: { id: number; price: number | null }[]
): Promise<OneClickUpdateResult> {
  const endpoint = marketplace === "shopee" ? wmd.restShopeeUpdate : wmd.restUpdate;
  if (!endpoint) {
    throw new Error(`Endpoint de atualização de preço não configurado para ${marketplace}`);
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WP-Nonce": wmd.restNonce,
      Cookie: session.jar.header(),
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Atualização de preço falhou (HTTP ${res.status})`);
  const json = (await res.json()) as OneClickUpdateResult & { success?: boolean };
  return {
    ok: json.success !== false && json.ok !== false,
    message: json.message,
    results: json.results,
  };
}

export async function publishShopee(
  session: ScrapeSession,
  wmd: WmdPublishConfig,
  items: PublishShopeeItem[]
): Promise<Record<string, ShopeePublishResultItem>> {
  const res = await fetch(wmd.restShopeePublish, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WP-Nonce": wmd.restNonce,
      Cookie: session.jar.header(),
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`Publicação Shopee falhou (HTTP ${res.status})`);
  const json = await res.json();
  return json.results || {};
}
