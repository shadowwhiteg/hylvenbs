import { prisma } from "@/lib/db";
import { shopeeFetch } from "@/lib/shopee/client";

const ITEM_STATUSES = "NORMAL,BANNED,UNLIST,REVIEWING";
const PAGE_SIZE = 100;
const BASE_INFO_BATCH = 50;

type ItemListResponse = {
  response?: {
    item: Array<{ item_id: number; item_status: string }>;
    total_count?: number;
    has_next_page?: boolean;
    next_offset?: number;
  };
};

async function collectAllItemIds(fetchImpl?: typeof fetch): Promise<number[]> {
  const ids: number[] = [];
  let offset = 0;
  for (let page = 0; page < 500; page++) {
    const res = await shopeeFetch<ItemListResponse>(
      `/api/v2/product/get_item_list?offset=${offset}&page_size=${PAGE_SIZE}&item_status=${ITEM_STATUSES}`,
      { method: "GET" },
      fetchImpl
    );
    if (!res.ok) throw new Error(`get_item_list falhou (HTTP ${res.status})`);
    const list = res.data.response?.item ?? [];
    ids.push(...list.map((i) => i.item_id));
    if (!res.data.response?.has_next_page || !list.length) break;
    offset = res.data.response.next_offset ?? offset + PAGE_SIZE;
  }
  return Array.from(new Set(ids));
}

type BaseInfoResponse = {
  response?: {
    item_list?: Array<{
      item_id: number;
      item_name: string;
      item_sku?: string;
      item_status: string;
      category_id?: number;
      price_info?: Array<{ current_price?: number; original_price?: number }>;
      stock_info_v2?: { summary_info?: { total_available_stock?: number } };
      image?: { image_url_list?: string[] };
      attribute_list?: Array<{ attribute_id: number; attribute_value_list?: Array<{ value_id?: number; original_value_name?: string }> }>;
    }>;
  };
};

async function fetchBaseInfo(
  ids: number[],
  fetchImpl?: typeof fetch
): Promise<{ items: NonNullable<BaseInfoResponse["response"]>["item_list"]; errors: string[] }> {
  const items: NonNullable<BaseInfoResponse["response"]>["item_list"] = [];
  const errors: string[] = [];

  for (let i = 0; i < ids.length; i += BASE_INFO_BATCH) {
    const batch = ids.slice(i, i + BASE_INFO_BATCH);
    const res = await shopeeFetch<BaseInfoResponse>(
      `/api/v2/product/get_item_base_info?item_id_list=${batch.join(",")}`,
      { method: "GET" },
      fetchImpl
    );
    if (!res.ok) {
      errors.push(`get_item_base_info falhou pro lote [${batch.join(",")}]: HTTP ${res.status}`);
      continue;
    }
    items.push(...(res.data.response?.item_list ?? []));
  }

  return { items, errors };
}

export type ImportShopeeListingsResult = {
  imported: number;
  errors: string[];
};

export async function importShopeeListings(
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<ImportShopeeListingsResult> {
  const ids = await collectAllItemIds(deps.fetchImpl);
  const { items, errors } = await fetchBaseInfo(ids, deps.fetchImpl);

  let imported = 0;
  for (const item of items ?? []) {
    if (!item?.item_id) continue;
    const id = String(item.item_id);
    const price = item.price_info?.[0]?.current_price ?? 0;
    const stock = item.stock_info_v2?.summary_info?.total_available_stock ?? 0;
    const thumbnail = item.image?.image_url_list?.[0] ?? null;
    const attributesJson = JSON.stringify(item.attribute_list ?? []);

    await prisma.shopeeListing.upsert({
      where: { id },
      create: {
        id,
        title: item.item_name ?? "",
        price,
        stock,
        status: item.item_status ?? "unknown",
        categoryId: item.category_id != null ? String(item.category_id) : null,
        itemSku: item.item_sku || null,
        thumbnail,
        attributesJson,
      },
      update: {
        title: item.item_name ?? "",
        price,
        stock,
        status: item.item_status ?? "unknown",
        categoryId: item.category_id != null ? String(item.category_id) : null,
        itemSku: item.item_sku || null,
        thumbnail,
        attributesJson,
        lastApiSyncAt: new Date(),
      },
    });
    imported += 1;
  }

  return { imported, errors };
}
