import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importShopeeListings } from "@/lib/shopee/listing-import";
import {
  DEFAULT_PAGE_SIZE,
  matchesShopeeListingFilters,
  parseShopeeListingFilters,
  sortShopeeListings,
} from "@/lib/shopee-listings/filters";

export async function GET(req: NextRequest) {
  const filters = parseShopeeListingFilters(req.nextUrl.searchParams);

  const listings = await prisma.shopeeListing.findMany();
  const ids = listings.map((l) => l.id);
  const [products, kits] = await Promise.all([
    prisma.product.findMany({
      where: { shopeeItemId: { in: ids } },
      select: { id: true, title: true, shopeeItemId: true, costPrice: true, videoUrl: true },
    }),
    prisma.kit.findMany({
      where: { shopeeItemId: { in: ids } },
      select: { id: true, title: true, shopeeItemId: true, costPrice: true },
    }),
  ]);

  const productByShopeeId = new Map(products.map((p) => [p.shopeeItemId, p]));
  const kitByShopeeId = new Map(kits.map((k) => [k.shopeeItemId, k]));

  const enriched = listings.map((listing) => {
    const product = productByShopeeId.get(listing.id) ?? null;
    return {
      ...listing,
      product: product ? { id: product.id, title: product.title, costPrice: product.costPrice } : null,
      kit: kitByShopeeId.get(listing.id) ?? null,
      videoUrl: product?.videoUrl?.trim() || null,
      hasVideo: Boolean(product?.videoUrl?.trim()),
    };
  });

  const statuses = Array.from(new Set(enriched.map((l) => l.status))).sort();

  const filtered = enriched.filter((l) => matchesShopeeListingFilters(l, filters));
  const sorted = sortShopeeListings(filtered, filters);

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
    const result = await importShopeeListings();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
