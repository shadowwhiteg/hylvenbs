export const SHOPEE_LISTING_SORTS = ["updated", "price", "stock", "title"] as const;
export type ShopeeListingSort = (typeof SHOPEE_LISTING_SORTS)[number];

export const SHOPEE_LISTING_DIRS = ["asc", "desc"] as const;
export type ShopeeListingDir = (typeof SHOPEE_LISTING_DIRS)[number];

export type ShopeeListingOrigin = "matched" | "kit" | "avulso";
export type StockFilter = "in" | "out";

export type ShopeeListingFilters = {
  q?: string;
  status?: string;
  origin?: ShopeeListingOrigin;
  stock?: StockFilter;
  priceMin?: number;
  priceMax?: number;
  costMin?: number;
  costMax?: number;
  missingSku?: boolean;
  sort?: ShopeeListingSort;
  dir?: ShopeeListingDir;
  page?: number;
  pageSize?: number;
};

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "sim"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "nao", "não"]);

function readString(params: URLSearchParams, key: string): string | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function readBoolean(params: URLSearchParams, key: string): boolean | undefined {
  const raw = readString(params, key);
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function readNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = readString(params, key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const raw = readString(params, key);
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase() as T;
  return allowed.includes(normalized) ? normalized : undefined;
}

function clampPage(value: number | undefined): number {
  if (value === undefined) return 1;
  const int = Math.floor(value);
  return int >= 1 ? int : 1;
}

function clampPageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const int = Math.floor(value);
  if (!Number.isFinite(int) || int < 1) return 1;
  return Math.min(int, MAX_PAGE_SIZE);
}

export function parseShopeeListingFilters(params: URLSearchParams): ShopeeListingFilters {
  const filters: ShopeeListingFilters = {
    q: readString(params, "q"),
    status: readString(params, "status"),
    origin: readEnum(params, "origin", ["matched", "kit", "avulso"] as const),
    stock: readEnum(params, "stock", ["in", "out"] as const),
    priceMin: readNumber(params, "priceMin"),
    priceMax: readNumber(params, "priceMax"),
    costMin: readNumber(params, "costMin"),
    costMax: readNumber(params, "costMax"),
    missingSku: readBoolean(params, "missingSku"),
    sort: readEnum(params, "sort", SHOPEE_LISTING_SORTS),
    dir: readEnum(params, "dir", SHOPEE_LISTING_DIRS),
    page: clampPage(readNumber(params, "page")),
    pageSize: clampPageSize(readNumber(params, "pageSize")),
  };

  for (const key of Object.keys(filters) as (keyof ShopeeListingFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }

  return filters;
}

export type FilterableShopeeListing = {
  id: string;
  title: string;
  status: string;
  price: number;
  stock: number;
  product: { costPrice: number } | null;
  kit: { costPrice: number } | null;
  itemSku: string | null;
};

export function matchesShopeeListingFilters(
  item: FilterableShopeeListing,
  filters: ShopeeListingFilters
): boolean {
  if (filters.q) {
    const q = filters.q.toLowerCase();
    const haystack = `${item.title} ${item.id} ${item.itemSku ?? ""}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (filters.status && item.status !== filters.status) return false;

  if (filters.origin === "matched" && !item.product) return false;
  if (filters.origin === "kit" && !item.kit) return false;
  if (filters.origin === "avulso" && (item.product || item.kit)) return false;

  if (filters.stock === "in" && !(item.stock > 0)) return false;
  if (filters.stock === "out" && item.stock > 0) return false;

  if (filters.priceMin !== undefined && item.price < filters.priceMin) return false;
  if (filters.priceMax !== undefined && item.price > filters.priceMax) return false;

  const cost = item.product?.costPrice ?? item.kit?.costPrice;
  if (filters.costMin !== undefined && (cost === undefined || cost < filters.costMin)) return false;
  if (filters.costMax !== undefined && (cost === undefined || cost > filters.costMax)) return false;

  if (filters.missingSku === true && item.itemSku) return false;
  if (filters.missingSku === false && !item.itemSku) return false;

  return true;
}

export function sortShopeeListings<T extends FilterableShopeeListing & { updatedAt: string | Date }>(
  items: T[],
  filters: ShopeeListingFilters
): T[] {
  const sort = filters.sort ?? "updated";
  const dir = filters.dir ?? (sort === "updated" ? "desc" : "asc");
  const mult = dir === "asc" ? 1 : -1;

  const sorted = [...items].sort((a, b) => {
    switch (sort) {
      case "price":
        return (a.price - b.price) * mult;
      case "stock":
        return (a.stock - b.stock) * mult;
      case "title":
        return a.title.localeCompare(b.title) * mult;
      case "updated":
      default:
        return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * mult;
    }
  });
  return sorted;
}
