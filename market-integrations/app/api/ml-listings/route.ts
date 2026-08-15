import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importMlListings } from "@/lib/ml/listing-import";
import { readSkuAndEan } from "@/lib/ml/listing-review";
import {
  DEFAULT_PAGE_SIZE,
  matchesMlListingFilters,
  parseMlListingFilters,
  sortMlListings,
} from "@/lib/ml-listings/filters";

export async function GET(req: NextRequest) {
  const filters = parseMlListingFilters(req.nextUrl.searchParams);

  const listings = await prisma.mlListing.findMany();
  const ids = listings.map((l) => l.id);
  const [products, kits] = await Promise.all([
    prisma.product.findMany({
      where: { mlItemId: { in: ids } },
      select: {
        id: true,
        title: true,
        mlItemId: true,
        costPrice: true,
        videoUrl: true,
        // As ações em massa de catálogo (características IA / categoryId /
        // catálogo ML) escrevem no rascunho — a tela precisa saber o que já
        // está preenchido para não reprocessar o que já tem.
        draft: { select: { categoryId: true, catalogProductId: true } },
      },
    }),
    prisma.kit.findMany({
      where: { mlItemId: { in: ids } },
      select: { id: true, title: true, mlItemId: true, costPrice: true },
    }),
  ]);

  const productByMlId = new Map(products.map((p) => [p.mlItemId, p]));
  const kitByMlId = new Map(kits.map((k) => [k.mlItemId, k]));

  const enriched = listings.map((listing) => {
    const { sku, ean } = readSkuAndEan(listing.attributesJson);
    const product = productByMlId.get(listing.id) ?? null;
    return {
      ...listing,
      product: product
        ? {
            id: product.id,
            title: product.title,
            costPrice: product.costPrice,
            hasDraft: Boolean(product.draft),
            draftCategoryId: product.draft?.categoryId ?? null,
            draftCatalogProductId: product.draft?.catalogProductId ?? null,
          }
        : null,
      kit: kitByMlId.get(listing.id) ?? null,
      sku,
      ean,
      videoUrl: product?.videoUrl?.trim() || null,
      hasVideo: Boolean(product?.videoUrl?.trim()),
    };
  });

  const statuses = Array.from(new Set(enriched.map((l) => l.status))).sort();

  const filtered = enriched.filter((l) => matchesMlListingFilters(l, filters));
  const sorted = sortMlListings(filtered, filters);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * pageSize;
  const pageItems = sorted.slice(skip, skip + pageSize);

  return NextResponse.json({
    listings: pageItems,
    total: sorted.length,
    page,
    pageSize,
    statuses,
    counts: {
      matched: enriched.filter((l) => l.product).length,
      kit: enriched.filter((l) => l.kit).length,
      avulso: enriched.filter((l) => !l.product && !l.kit).length,
      hasVideo: enriched.filter((l) => l.hasVideo).length,
    },
  });
}

export async function POST() {
  try {
    const result = await importMlListings();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
