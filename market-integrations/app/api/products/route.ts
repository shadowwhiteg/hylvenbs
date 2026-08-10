import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  DEFAULT_PAGE_SIZE,
  buildProductOrderBy,
  buildProductWhere,
  matchesInMemoryFilters,
  needsInMemoryFiltering,
  parseCatalogFilters,
  type CatalogFilters,
} from "@/lib/catalog/filters";

type ProductWithDraft = Prisma.ProductGetPayload<{ include: { draft: true } }>;

type CatalogCounts = {
  byStatus: Record<string, number>;
  published: number;
  notPublished: number;
};

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isTruthyParam(value: string | null): boolean {
  return value !== null && TRUTHY.has(value.trim().toLowerCase());
}

function countsFromRows(rows: ProductWithDraft[]): CatalogCounts {
  const byStatus: Record<string, number> = {};
  let published = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.mlItemId) published += 1;
  }
  return { byStatus, published, notPublished: rows.length - published };
}

async function countsFromDb(where: Prisma.ProductWhereInput): Promise<CatalogCounts> {
  const [grouped, published, total] = await Promise.all([
    prisma.product.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.product.count({ where: { AND: [where, { mlItemId: { not: null } }] } }),
    prisma.product.count({ where }),
  ]);
  const byStatus: Record<string, number> = {};
  for (const group of grouped) {
    byStatus[group.status] = group._count._all;
  }
  return { byStatus, published, notPublished: total - published };
}

async function collectIds(
  where: Prisma.ProductWhereInput,
  orderBy: Prisma.ProductOrderByWithRelationInput,
  filters: CatalogFilters
): Promise<string[]> {
  if (!needsInMemoryFiltering(filters)) {
    const rows = await prisma.product.findMany({ where, orderBy, select: { id: true } });
    return rows.map((row) => row.id);
  }
  const rows = await prisma.product.findMany({
    where,
    orderBy,
    select: {
      id: true,
      pictures: true,
      attributesJson: true,
      draft: { select: { attributes: true } },
    },
  });
  return rows.filter((row) => matchesInMemoryFilters(row, filters)).map((row) => row.id);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const filters = parseCatalogFilters(params);
  const where = buildProductWhere(filters);
  const orderBy = buildProductOrderBy(filters);

  if (isTruthyParam(params.get("idsOnly"))) {
    const ids = await collectIds(where, orderBy, filters);
    return NextResponse.json({ ids, total: ids.length });
  }

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * pageSize;

  // Filtros que dependem de JSON serializado precisam rodar antes da paginação
  // para que `total` e `counts` reflitam o conjunto realmente filtrado.
  if (needsInMemoryFiltering(filters)) {
    const all = await prisma.product.findMany({ where, orderBy, include: { draft: true } });
    const filtered = all.filter((product) => matchesInMemoryFilters(product, filters));
    return NextResponse.json({
      products: filtered.slice(skip, skip + pageSize),
      total: filtered.length,
      page,
      pageSize,
      counts: countsFromRows(filtered),
    });
  }

  const [products, total, counts] = await Promise.all([
    prisma.product.findMany({ where, orderBy, include: { draft: true }, skip, take: pageSize }),
    prisma.product.count({ where }),
    countsFromDb(where),
  ]);

  return NextResponse.json({ products, total, page, pageSize, counts });
}
