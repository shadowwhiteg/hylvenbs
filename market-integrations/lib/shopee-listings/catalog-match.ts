import { prisma } from "@/lib/db";
import { extractProductIdentifiers } from "@/lib/ml/catalog";
import { titleSimilarity } from "@/lib/ml-listings/catalog-match";

const TITLE_MATCH_THRESHOLD = 0.82;
const TITLE_CONSIDER_THRESHOLD = 0.55;
const MAX_AMBIGUOUS_CANDIDATES = 3;

function normalizeKey(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export type ShopeeCandidateProduct = {
  id: string;
  title: string;
  sku: string | null;
  attributesJson: string;
  description: string;
};

export type ShopeeCatalogMatchDetail = {
  listingId: string;
  listingTitle: string;
  productId: string;
  productTitle: string;
  method: "sku" | "ean" | "title";
  score?: number;
};

export type ShopeeAmbiguousMatch = {
  listingId: string;
  listingTitle: string;
  candidates: Array<{ productId: string; productTitle: string; score: number }>;
};

export type ShopeeCatalogMatchResult = {
  matched: number;
  skipped: number;
  ambiguous: number;
  details: ShopeeCatalogMatchDetail[];
  ambiguousDetails: ShopeeAmbiguousMatch[];
};

/** Espelha lib/ml-listings/catalog-match.ts: vincula anúncios Shopee avulsos a produtos do catálogo Meu Drop, sem tocar na Shopee. */
export async function matchAvulsoShopeeListingsToCatalog(
  listingIds?: string[]
): Promise<ShopeeCatalogMatchResult> {
  const listings = await prisma.shopeeListing.findMany(
    listingIds?.length ? { where: { id: { in: listingIds } } } : undefined
  );
  if (!listings.length) {
    return { matched: 0, skipped: 0, ambiguous: 0, details: [], ambiguousDetails: [] };
  }

  const allLinkedProducts = await prisma.product.findMany({
    where: { shopeeItemId: { in: listings.map((l) => l.id) } },
    select: { shopeeItemId: true },
  });
  const linkedKits = await prisma.kit.findMany({
    where: { shopeeItemId: { in: listings.map((l) => l.id) } },
    select: { shopeeItemId: true },
  });
  const alreadyLinked = new Set([
    ...allLinkedProducts.map((p) => p.shopeeItemId),
    ...linkedKits.map((k) => k.shopeeItemId),
  ]);

  const avulso = listings.filter((l) => !alreadyLinked.has(l.id));
  if (!avulso.length) {
    return { matched: 0, skipped: 0, ambiguous: 0, details: [], ambiguousDetails: [] };
  }

  const candidates: ShopeeCandidateProduct[] = await prisma.product.findMany({
    where: { shopeeItemId: null },
    select: { id: true, title: true, sku: true, attributesJson: true, description: true },
  });
  const pool = new Map(candidates.map((c) => [c.id, c]));

  const skuIndex = new Map<string, ShopeeCandidateProduct[]>();
  const eanIndex = new Map<string, ShopeeCandidateProduct[]>();
  for (const product of candidates) {
    const skuKey = normalizeKey(product.sku);
    if (skuKey) {
      const bucket = skuIndex.get(skuKey) ?? [];
      bucket.push(product);
      skuIndex.set(skuKey, bucket);
    }
    const gtin = extractProductIdentifiers({
      attributesJson: product.attributesJson,
      description: product.description,
    }).gtin;
    const eanKey = normalizeKey(gtin);
    if (eanKey) {
      const bucket = eanIndex.get(eanKey) ?? [];
      bucket.push(product);
      eanIndex.set(eanKey, bucket);
    }
  }

  const details: ShopeeCatalogMatchDetail[] = [];
  const ambiguousDetails: ShopeeAmbiguousMatch[] = [];
  let skipped = 0;

  const removeFromPool = (productId: string) => pool.delete(productId);

  for (const listing of avulso) {
    const sku = listing.itemSku;
    let match: ShopeeCandidateProduct | null = null;
    let method: ShopeeCatalogMatchDetail["method"] | null = null;

    const skuKey = normalizeKey(sku);
    if (skuKey) {
      const bucket = (skuIndex.get(skuKey) ?? []).filter((p) => pool.has(p.id));
      if (bucket.length === 1) {
        match = bucket[0];
        method = "sku";
      }
    }

    let bestScore = 0;
    if (!match) {
      const scored = [...pool.values()]
        .map((product) => ({ product, score: titleSimilarity(listing.title, product.title) }))
        .filter((s) => s.score >= TITLE_CONSIDER_THRESHOLD)
        .sort((a, b) => b.score - a.score);

      if (scored.length) {
        bestScore = scored[0].score;
        const runnerUpScore = scored[1]?.score ?? 0;
        if (bestScore >= TITLE_MATCH_THRESHOLD && bestScore - runnerUpScore >= 0.08) {
          match = scored[0].product;
          method = "title";
        } else {
          ambiguousDetails.push({
            listingId: listing.id,
            listingTitle: listing.title,
            candidates: scored.slice(0, MAX_AMBIGUOUS_CANDIDATES).map((s) => ({
              productId: s.product.id,
              productTitle: s.product.title,
              score: Math.round(s.score * 100) / 100,
            })),
          });
        }
      }
    }

    if (!match || !method) {
      skipped += 1;
      continue;
    }

    await prisma.product.update({
      where: { id: match.id },
      data: { shopeeItemId: listing.id, shopeeItemUrl: listing.permalink ?? undefined },
    });
    removeFromPool(match.id);

    details.push({
      listingId: listing.id,
      listingTitle: listing.title,
      productId: match.id,
      productTitle: match.title,
      method,
      ...(method === "title" ? { score: Math.round(bestScore * 100) / 100 } : {}),
    });
  }

  return { matched: details.length, skipped, ambiguous: ambiguousDetails.length, details, ambiguousDetails };
}
