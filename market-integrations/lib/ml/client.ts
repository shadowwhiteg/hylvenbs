import { getValidAccessToken } from "@/lib/ml/auth";

const ML_API = "https://api.mercadolibre.com";

export type MlHttpResult<T> = {
  ok: boolean;
  status: number;
  data: T;
  raw: string;
};

export async function mlFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<MlHttpResult<T>> {
  const token = await getValidAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetchImpl(`${ML_API}${path}`, { ...init, headers });
  const raw = await res.text();
  let data = {} as T;
  try {
    data = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    data = { message: raw } as T;
  }

  return { ok: res.ok, status: res.status, data, raw };
}

export async function createItem(
  payload: Record<string, unknown>,
  fetchImpl?: typeof fetch
) {
  return mlFetch<{ id?: string; permalink?: string; message?: string; cause?: unknown }>(
    "/items",
    { method: "POST", body: JSON.stringify(payload) },
    fetchImpl
  );
}

export async function setItemDescription(
  itemId: string,
  plainText: string,
  fetchImpl?: typeof fetch
) {
  return mlFetch(`/items/${itemId}/description`, {
    method: "POST",
    body: JSON.stringify({ plain_text: plainText }),
  }, fetchImpl);
}

export type MlApiAttributeInput = {
  id: string;
  value_name?: string;
  value_id?: string | null;
};

export type UpdateItemPayload = {
  price?: number;
  available_quantity?: number;
  status?: "active" | "paused" | "closed";
  video_id?: string;
  title?: string;
  /** category_id NÃO existe aqui de propósito: o ML não permite trocar a categoria de um anúncio já publicado via API. */
  attributes?: MlApiAttributeInput[];
};

export type UpdateItemResponse = {
  id?: string;
  message?: string;
  cause?: unknown;
  /**
   * ML pode devolver HTTP 200 e simplesmente ignorar campos que não aceita
   * mudar (ex.: título de item vinculado ao catálogo oficial — ver
   * user_product_id). Sempre confira o valor devolvido contra o que foi
   * enviado antes de considerar um campo realmente aplicado.
   */
  title?: string;
  attributes?: MlItemAttribute[];
  user_product_id?: string | null;
};

export async function updateItem(
  itemId: string,
  payload: UpdateItemPayload,
  fetchImpl?: typeof fetch
) {
  return mlFetch<UpdateItemResponse>(
    `/items/${itemId}`,
    { method: "PUT", body: JSON.stringify(payload) },
    fetchImpl
  );
}

export async function pauseItem(itemId: string, fetchImpl?: typeof fetch) {
  return updateItem(itemId, { status: "paused" }, fetchImpl);
}

export type MyItemsSearchPage = {
  scroll_id?: string;
  results: string[];
  paging?: { total?: number };
};

/** GET /users/{userId}/items/search com search_type=scan (suporta >1000 itens via scroll_id). */
/**
 * Troca o tipo de anúncio (Clássico ⇄ Premium) de um item já publicado.
 *
 * Não dá para fazer isso com `PUT /items/{id}` mandando `listing_type_id` — o ML
 * ignora o campo. O endpoint dedicado é este, e ele devolve o item atualizado.
 */
export async function changeItemListingType(
  itemId: string,
  listingTypeId: string,
  fetchImpl?: typeof fetch
) {
  return mlFetch<{ id?: string; listing_type_id?: string; message?: string; cause?: unknown }>(
    `/items/${itemId}/listing_type`,
    { method: "POST", body: JSON.stringify({ id: listingTypeId }) },
    fetchImpl
  );
}

/** Lê só o `listing_type_id` atual do anúncio — usado para conferir o estado real. */
export async function getItemListingType(itemId: string, fetchImpl?: typeof fetch) {
  return mlFetch<{ id?: string; listing_type_id?: string }>(
    `/items/${itemId}?attributes=id,listing_type_id`,
    {},
    fetchImpl
  );
}

export async function searchMyItems(
  userId: string,
  opts: { scrollId?: string } = {},
  fetchImpl?: typeof fetch
) {
  const params = new URLSearchParams({ search_type: "scan", limit: "100" });
  if (opts.scrollId) params.set("scroll_id", opts.scrollId);
  return mlFetch<MyItemsSearchPage>(
    `/users/${userId}/items/search?${params.toString()}`,
    {},
    fetchImpl
  );
}

export type MlItemAttribute = {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
};

export type MlItemDetail = {
  id: string;
  title: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  sold_quantity: number;
  status: string;
  listing_type_id?: string;
  category_id?: string;
  permalink?: string;
  thumbnail?: string;
  catalog_listing?: boolean;
  tags?: string[];
  attributes?: MlItemAttribute[];
};

type MultigetEntry = { code: number; body: MlItemDetail };

/** GET /items?ids=... em lotes de 20 (limite da API). */
export async function getItemsMultiget(ids: string[], fetchImpl?: typeof fetch) {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));

  const items: MlItemDetail[] = [];
  const errors: string[] = [];
  for (const chunk of chunks) {
    const res = await mlFetch<MultigetEntry[]>(
      `/items?ids=${chunk.join(",")}`,
      {},
      fetchImpl
    );
    if (!res.ok || !Array.isArray(res.data)) {
      errors.push(`Falha ao buscar detalhes de ${chunk.length} item(ns) (HTTP ${res.status})`);
      continue;
    }
    for (const entry of res.data) {
      if (entry.code === 200 && entry.body) items.push(entry.body);
      else errors.push(`Item ${entry.body?.id ?? "?"}: HTTP ${entry.code}`);
    }
  }
  return { items, errors };
}

export type ItemsExistence = {
  /** Ids que a API confirmou existir. */
  alive: Set<string>;
  /** Ids que a API respondeu 404/403 — o anúncio não existe mais para este vendedor. */
  missing: Set<string>;
  /** Ids sem resposta conclusiva (erro de rede/HTTP no lote) — não devem ser apagados. */
  unknown: Set<string>;
};

type ExistenceEntry = {
  code: number;
  body?: { id?: string; status?: string; sub_status?: string[]; deleted?: boolean };
};

/**
 * Anúncio excluído no ML **continua** respondendo HTTP 200 no `GET /items` — só
 * some da busca do vendedor e do site. O sinal real é `sub_status: ["deleted"]`
 * (ou `deleted: true`). Checar só o código HTTP dava "ainda existe" para item
 * apagado, e o snapshot local nunca era limpo.
 */
export function isDeletedItemBody(body: ExistenceEntry["body"]): boolean {
  if (!body) return false;
  if (body.deleted === true) return true;
  return Array.isArray(body.sub_status) && body.sub_status.includes("deleted");
}

/**
 * Confere quais ids ainda existem no ML. Usado antes de apagar vínculo local:
 * um lote que falhou por rede não pode ser confundido com anúncio excluído.
 */
export async function checkItemsExistence(
  ids: string[],
  fetchImpl?: typeof fetch
): Promise<ItemsExistence> {
  const alive = new Set<string>();
  const missing = new Set<string>();
  const unknown = new Set<string>();

  // Um id malformado faz a API devolver 400 para o LOTE inteiro (20 itens), o
  // que marcaria itens bons como "não sei". Ids fora do formato MLB\d+ não podem
  // existir no ML, então já entram como sumidos e ficam fora da requisição.
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const valid: string[] = [];
  for (const id of unique) {
    if (/^MLB\d+$/i.test(id)) valid.push(id);
    else missing.add(id);
  }

  for (let i = 0; i < valid.length; i += 20) {
    const chunk = valid.slice(i, i + 20);
    const res = await mlFetch<ExistenceEntry[]>(
      `/items?ids=${chunk.join(",")}&attributes=id,status,sub_status,deleted`,
      {},
      fetchImpl
    );
    if (!res.ok || !Array.isArray(res.data)) {
      for (const id of chunk) unknown.add(id);
      continue;
    }
    const seen = new Set<string>();
    for (const entry of res.data) {
      const id = entry.body?.id;
      if (!id) continue;
      seen.add(id);
      if (entry.code === 404 || entry.code === 403) missing.add(id);
      else if (entry.code !== 200) unknown.add(id);
      else if (isDeletedItemBody(entry.body)) missing.add(id);
      else alive.add(id);
    }
    // Id que nem apareceu na resposta: o multiget o descartou — tratamos como sumido.
    for (const id of chunk) if (!seen.has(id)) missing.add(id);
  }

  return { alive, missing, unknown };
}

export type MlPromotion = {
  id?: string;
  promotion_id?: string;
  type?: string;
  status?: string;
  name?: string;
  deal_price?: number;
  price?: number;
  original_price?: number;
  /** Só presente em campanhas PRICE_DISCOUNT (desconto escolhido pelo vendedor, sem id de campanha). */
  min_discounted_price?: number;
  max_discounted_price?: number;
  suggested_discounted_price?: number;
  finish_date?: string;
  [key: string]: unknown;
};

/** GET /seller-promotions/items/{item_id} — promoções disponíveis/ativas do anúncio. */
export async function getItemPromotions(itemId: string, fetchImpl?: typeof fetch) {
  return mlFetch<MlPromotion[]>(
    `/seller-promotions/items/${itemId}?app_version=v2`,
    {},
    fetchImpl
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * ML quer "formato local" pra start_date/finish_date de PRICE_DISCOUNT: data
 * naive (sem offset de fuso), início sempre 00:00:00 e fim sempre 23:59:59 —
 * confirmado contra a API real; qualquer offset (ex.: "-03:00") é rejeitado
 * com a mensagem genérica "Start and finish dates must be in local format".
 */
export function toMlPromotionStart(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T00:00:00`;
}

export function toMlPromotionFinish(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T23:59:59`;
}

/**
 * POST /seller-promotions/items/{item_id} — inscreve o item numa promoção do ML.
 * `promotion_id` só existe pra campanhas do tipo DEAL (oferta com id fixo);
 * PRICE_DISCOUNT é o desconto de preço que o próprio vendedor define
 * (dentro de min/max_discounted_price) e não tem id — só o tipo já identifica.
 * PRICE_DISCOUNT também exige start_date/finish_date em "formato local".
 */
export async function applyItemPromotion(
  itemId: string,
  payload: {
    promotion_id?: string;
    promotion_type: string;
    deal_price?: number;
    start_date?: string;
    finish_date?: string;
  },
  fetchImpl?: typeof fetch
) {
  const params = new URLSearchParams({ app_version: "v2", promotion_type: payload.promotion_type });
  if (payload.promotion_id) params.set("promotion_id", payload.promotion_id);
  return mlFetch<{ message?: string; cause?: unknown }>(
    `/seller-promotions/items/${itemId}?${params.toString()}`,
    { method: "POST", body: JSON.stringify(payload) },
    fetchImpl
  );
}

/** DELETE /seller-promotions/items/{item_id} — remove o item de uma promoção ativa. */
export async function cancelItemPromotion(
  itemId: string,
  promotionId: string | undefined,
  promotionType: string,
  fetchImpl?: typeof fetch
) {
  const params = new URLSearchParams({ app_version: "v2", promotion_type: promotionType });
  if (promotionId) params.set("promotion_id", promotionId);
  return mlFetch<{ message?: string; cause?: unknown }>(
    `/seller-promotions/items/${itemId}?${params.toString()}`,
    { method: "DELETE" },
    fetchImpl
  );
}
