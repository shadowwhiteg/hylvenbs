import type { Prisma } from "@prisma/client";

export const CATALOG_SORTS = ["price", "cost", "updated", "title", "stock"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_DIRS = ["asc", "desc"] as const;
export type CatalogDir = (typeof CATALOG_DIRS)[number];

export type PublishedFilter = "yes" | "no";
export type StockFilter = "in" | "out";
export type CatalogMarketplace = "ml" | "shopee";

export type CatalogFilters = {
  q?: string;
  status?: string;
  published?: PublishedFilter;
  /** Escopo do filtro `published` (default: ml → mlItemId). */
  marketplace?: CatalogMarketplace;
  hasVideo?: boolean;
  hasImages?: boolean;
  missingAttributes?: boolean;
  missingCategory?: boolean;
  priceMin?: number;
  priceMax?: number;
  costMin?: number;
  costMax?: number;
  stock?: StockFilter;
  hasCatalog?: boolean;
  freeShipping?: boolean;
  listingType?: string;
  sort?: CatalogSort;
  dir?: CatalogDir;
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

/** Aceita "1"/"true"/"yes"/"on"/"sim" e seus opostos; qualquer outro valor é ignorado. */
function readBoolean(params: URLSearchParams, key: string): boolean | undefined {
  const raw = readString(params, key);
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

/** Números não finitos (NaN, Infinity) e textos inválidos são ignorados. */
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

function readPublished(params: URLSearchParams): PublishedFilter | undefined {
  const raw = readString(params, "published");
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === "yes" || TRUE_VALUES.has(normalized)) return "yes";
  if (normalized === "no" || FALSE_VALUES.has(normalized)) return "no";
  return undefined;
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

/**
 * Converte a query string em filtros tipados. Valores inválidos são
 * simplesmente descartados (o filtro fica `undefined`), nunca causam erro.
 */
export function parseCatalogFilters(params: URLSearchParams): CatalogFilters {
  const filters: CatalogFilters = {
    q: readString(params, "q"),
    status: readString(params, "status"),
    published: readPublished(params),
    marketplace: readEnum(params, "marketplace", ["ml", "shopee"] as const),
    hasVideo: readBoolean(params, "hasVideo"),
    hasImages: readBoolean(params, "hasImages"),
    missingAttributes: readBoolean(params, "missingAttributes"),
    missingCategory: readBoolean(params, "missingCategory"),
    priceMin: readNumber(params, "priceMin"),
    priceMax: readNumber(params, "priceMax"),
    costMin: readNumber(params, "costMin"),
    costMax: readNumber(params, "costMax"),
    stock: readEnum(params, "stock", ["in", "out"] as const),
    hasCatalog: readBoolean(params, "hasCatalog"),
    freeShipping: readBoolean(params, "freeShipping"),
    listingType: readString(params, "listingType"),
    sort: readEnum(params, "sort", CATALOG_SORTS),
    dir: readEnum(params, "dir", CATALOG_DIRS),
    page: clampPage(readNumber(params, "page")),
    pageSize: clampPageSize(readNumber(params, "pageSize")),
  };

  for (const key of Object.keys(filters) as (keyof CatalogFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }

  return filters;
}

/** Serializa filtros de volta para query string (omite vazios e paginação default). */
export function serializeCatalogFilters(filters: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  return params;
}

export function buildProductWhere(filters: CatalogFilters): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];

  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: filters.q } },
        { externalId: { contains: filters.q } },
        { sku: { contains: filters.q } },
      ],
    });
  }

  if (filters.status) and.push({ status: filters.status });

  if (filters.published === "yes" || filters.published === "no") {
    const itemIdField = filters.marketplace === "shopee" ? "shopeeItemId" : "mlItemId";
    and.push(
      filters.published === "yes" ? { [itemIdField]: { not: null } } : { [itemIdField]: null }
    );
  }

  if (filters.costMin !== undefined) and.push({ costPrice: { gte: filters.costMin } });
  if (filters.costMax !== undefined) and.push({ costPrice: { lte: filters.costMax } });

  if (filters.stock === "in") and.push({ stock: { gt: 0 } });
  if (filters.stock === "out") and.push({ OR: [{ stock: null }, { stock: { lte: 0 } }] });

  if (filters.hasVideo === true) {
    and.push({ AND: [{ videoUrl: { not: null } }, { videoUrl: { not: "" } }] });
  }
  if (filters.hasVideo === false) {
    and.push({ OR: [{ videoUrl: null }, { videoUrl: "" }] });
  }

  if (filters.missingCategory === true) {
    and.push({ OR: [{ draft: { is: null } }, { draft: { is: { categoryId: "" } } }] });
  }
  if (filters.missingCategory === false) {
    and.push({ draft: { is: { categoryId: { not: "" } } } });
  }

  if (filters.priceMin !== undefined) {
    and.push({ draft: { is: { price: { gte: filters.priceMin } } } });
  }
  if (filters.priceMax !== undefined) {
    and.push({ draft: { is: { price: { lte: filters.priceMax } } } });
  }

  if (filters.freeShipping !== undefined) {
    and.push({ draft: { is: { freeShipping: filters.freeShipping } } });
  }

  if (filters.listingType) {
    and.push({ draft: { is: { listingTypeId: filters.listingType } } });
  }

  if (filters.hasCatalog === true) {
    and.push({ draft: { is: { catalogProductId: { not: null } } } });
  }
  if (filters.hasCatalog === false) {
    and.push({
      OR: [{ draft: { is: null } }, { draft: { is: { catalogProductId: null } } }],
    });
  }

  return and.length ? { AND: and } : {};
}

/**
 * `price` usa ordenação por relação (`draft.price`), suportada pelo Prisma no
 * SQLite via LEFT JOIN — produtos sem draft ficam com valor nulo e vão para o
 * início na ordem ascendente. O default é `updatedAt desc`.
 */
export function buildProductOrderBy(
  filters: CatalogFilters
): Prisma.ProductOrderByWithRelationInput {
  const sort = filters.sort ?? "updated";
  const dir: CatalogDir = filters.dir ?? (sort === "updated" ? "desc" : "asc");

  switch (sort) {
    case "price":
      return { draft: { price: dir } };
    case "cost":
      return { costPrice: dir };
    case "title":
      return { title: dir };
    case "stock":
      return { stock: dir };
    case "updated":
    default:
      return { updatedAt: dir };
  }
}

export type InMemoryProduct = {
  pictures: string;
  attributesJson: string;
  draft?: { attributes: string } | null;
};

function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function countPictures(pictures: string | null | undefined): number {
  return parseJsonArray(pictures).length;
}

export function hasAttributes(product: InMemoryProduct): boolean {
  return (
    parseJsonArray(product.attributesJson).length > 0 ||
    parseJsonArray(product.draft?.attributes).length > 0
  );
}

/** Filtros que dependem de JSON serializado e por isso não vão para o SQL. */
export function needsInMemoryFiltering(filters: CatalogFilters): boolean {
  return filters.hasImages !== undefined || filters.missingAttributes !== undefined;
}

export function matchesInMemoryFilters(
  product: InMemoryProduct,
  filters: CatalogFilters
): boolean {
  if (filters.hasImages !== undefined) {
    const withImages = countPictures(product.pictures) > 0;
    if (withImages !== filters.hasImages) return false;
  }

  if (filters.missingAttributes !== undefined) {
    const missing = !hasAttributes(product);
    if (missing !== filters.missingAttributes) return false;
  }

  return true;
}
