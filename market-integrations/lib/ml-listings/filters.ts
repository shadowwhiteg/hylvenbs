export const ML_LISTING_SORTS = ["updated", "price", "stock", "title"] as const;
export type MlListingSort = (typeof ML_LISTING_SORTS)[number];

export const ML_LISTING_DIRS = ["asc", "desc"] as const;
export type MlListingDir = (typeof ML_LISTING_DIRS)[number];

export type MlListingOrigin = "matched" | "kit" | "avulso";
export type StockFilter = "in" | "out";

export type MlListingFilters = {
  q?: string;
  status?: string;
  origin?: MlListingOrigin;
  stock?: StockFilter;
  priceMin?: number;
  priceMax?: number;
  costMin?: number;
  costMax?: number;
  missingSku?: boolean;
  missingEan?: boolean;
  /** Produto do Meu Drop vinculado tem vídeo — candidato a subir manualmente no Clips do ML (a API não expõe upload de Clips para vendedores locais). */
  hasVideo?: boolean;
  sort?: MlListingSort;
  dir?: MlListingDir;
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

export function parseMlListingFilters(params: URLSearchParams): MlListingFilters {
  const filters: MlListingFilters = {
    q: readString(params, "q"),
    status: readString(params, "status"),
    origin: readEnum(params, "origin", ["matched", "kit", "avulso"] as const),
    stock: readEnum(params, "stock", ["in", "out"] as const),
    priceMin: readNumber(params, "priceMin"),
    priceMax: readNumber(params, "priceMax"),
    costMin: readNumber(params, "costMin"),
    costMax: readNumber(params, "costMax"),
    missingSku: readBoolean(params, "missingSku"),
    missingEan: readBoolean(params, "missingEan"),
    hasVideo: readBoolean(params, "hasVideo"),
    sort: readEnum(params, "sort", ML_LISTING_SORTS),
    dir: readEnum(params, "dir", ML_LISTING_DIRS),
    page: clampPage(readNumber(params, "page")),
    pageSize: clampPageSize(readNumber(params, "pageSize")),
  };

  for (const key of Object.keys(filters) as (keyof MlListingFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }

  return filters;
}

export type FilterableListing = {
  id: string;
  title: string;
  status: string;
  price: number;
  availableQuantity: number;
  product: { costPrice: number } | null;
  kit: { costPrice: number } | null;
  sku: string | null;
  ean: string | null;
  hasVideo: boolean;
};

export function matchesMlListingFilters(item: FilterableListing, filters: MlListingFilters): boolean {
  if (filters.q) {
    const q = filters.q.toLowerCase();
    const haystack = `${item.title} ${item.id} ${item.sku ?? ""}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  if (filters.status && item.status !== filters.status) return false;

  if (filters.origin === "matched" && !item.product) return false;
  if (filters.origin === "kit" && !item.kit) return false;
  if (filters.origin === "avulso" && (item.product || item.kit)) return false;

  if (filters.stock === "in" && !(item.availableQuantity > 0)) return false;
  if (filters.stock === "out" && item.availableQuantity > 0) return false;

  if (filters.priceMin !== undefined && item.price < filters.priceMin) return false;
  if (filters.priceMax !== undefined && item.price > filters.priceMax) return false;

  const cost = item.product?.costPrice ?? item.kit?.costPrice;
  if (filters.costMin !== undefined && (cost === undefined || cost < filters.costMin)) return false;
  if (filters.costMax !== undefined && (cost === undefined || cost > filters.costMax)) return false;

  if (filters.missingSku === true && item.sku) return false;
  if (filters.missingSku === false && !item.sku) return false;
  if (filters.missingEan === true && item.ean) return false;
  if (filters.missingEan === false && !item.ean) return false;

  if (filters.hasVideo === true && !item.hasVideo) return false;
  if (filters.hasVideo === false && item.hasVideo) return false;

  return true;
}

export function sortMlListings<T extends FilterableListing & { updatedAt: string | Date }>(
  items: T[],
  filters: MlListingFilters
): T[] {
  const sort = filters.sort ?? "updated";
  const dir = filters.dir ?? (sort === "updated" ? "desc" : "asc");
  const mult = dir === "asc" ? 1 : -1;

  const sorted = [...items].sort((a, b) => {
    switch (sort) {
      case "price":
        return (a.price - b.price) * mult;
      case "stock":
        return (a.availableQuantity - b.availableQuantity) * mult;
      case "title":
        return a.title.localeCompare(b.title) * mult;
      case "updated":
      default:
        return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * mult;
    }
  });
  return sorted;
}
