import { prisma } from "@/lib/db";
import { readSkuAndEan } from "@/lib/ml/listing-review";
import { extractProductIdentifiers } from "@/lib/ml/catalog";

/** Abaixo disso o título nem entra como candidato. */
const TITLE_MATCH_THRESHOLD = 0.82;
/** Entre isso e o threshold de match: reportado como ambíguo, não vinculado sozinho. */
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

function titleTokens(title: string): Set<string> {
  const normalized = (title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return new Set(normalized.split(/\s+/).filter((t) => t.length > 1));
}

/** Similaridade de Jaccard entre os conjuntos de palavras dos dois títulos. */
export function titleSimilarity(a: string, b: string): number {
  const setA = titleTokens(a);
  const setB = titleTokens(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union ? intersection / union : 0;
}

export type CandidateProduct = {
  id: string;
  title: string;
  sku: string | null;
  attributesJson: string;
  description: string;
};

export type CatalogMatchDetail = {
  listingId: string;
  listingTitle: string;
  productId: string;
  productTitle: string;
  method: "sku" | "ean" | "title";
  score?: number;
};

export type AmbiguousMatch = {
  listingId: string;
  listingTitle: string;
  candidates: Array<{ productId: string; productTitle: string; score: number }>;
};

export type CatalogMatchResult = {
  matched: number;
  skipped: number;
  ambiguous: number;
  details: CatalogMatchDetail[];
  ambiguousDetails: AmbiguousMatch[];
};

/**
 * Vincula anúncios "avulsos" (sem Product/Kit local) a produtos do catálogo
 * do Meu Drop ainda sem `mlItemId`, só definindo o vínculo — nunca cria,
 * edita ou apaga nada no Mercado Livre. Prioriza SKU e EAN (match exato,
 * seguro); título só entra como último recurso e exige alta similaridade
 * pra evitar vínculo errado.
 */
export async function matchAvulsoListingsToCatalog(
  listingIds?: string[]
): Promise<CatalogMatchResult> {
  const listings = await prisma.mlListing.findMany(
    listingIds?.length
      ? { where: { id: { in: listingIds } } }
      : undefined
  );
  if (!listings.length) {
    return { matched: 0, skipped: 0, ambiguous: 0, details: [], ambiguousDetails: [] };
  }

  const allLinkedProducts = await prisma.product.findMany({
    where: { mlItemId: { in: listings.map((l) => l.id) } },
    select: { mlItemId: true },
  });
  const linkedKits = await prisma.kit.findMany({
    where: { mlItemId: { in: listings.map((l) => l.id) } },
    select: { mlItemId: true },
  });
  const alreadyLinked = new Set([
    ...allLinkedProducts.map((p) => p.mlItemId),
    ...linkedKits.map((k) => k.mlItemId),
  ]);

  const avulso = listings.filter((l) => !alreadyLinked.has(l.id));
  if (!avulso.length) {
    return { matched: 0, skipped: 0, ambiguous: 0, details: [], ambiguousDetails: [] };
  }

  const candidates: CandidateProduct[] = await prisma.product.findMany({
    where: { mlItemId: null },
    select: { id: true, title: true, sku: true, attributesJson: true, description: true },
  });
  const pool = new Map(candidates.map((c) => [c.id, c]));

  const skuIndex = new Map<string, CandidateProduct[]>();
  const eanIndex = new Map<string, CandidateProduct[]>();
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

  const details: CatalogMatchDetail[] = [];
  const ambiguousDetails: AmbiguousMatch[] = [];
  let skipped = 0;

  const removeFromPool = (productId: string) => {
    pool.delete(productId);
  };

  for (const listing of avulso) {
    const { sku, ean } = readSkuAndEan(listing.attributesJson);
    let match: CandidateProduct | null = null;
    let method: CatalogMatchDetail["method"] | null = null;

    const skuKey = normalizeKey(sku);
    if (skuKey) {
      const bucket = (skuIndex.get(skuKey) ?? []).filter((p) => pool.has(p.id));
      if (bucket.length === 1) {
        match = bucket[0];
        method = "sku";
      }
    }

    if (!match) {
      const eanKey = normalizeKey(ean);
      if (eanKey) {
        const bucket = (eanIndex.get(eanKey) ?? []).filter((p) => pool.has(p.id));
        if (bucket.length === 1) {
          match = bucket[0];
          method = "ean";
        }
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
      data: { mlItemId: listing.id, mlPermalink: listing.permalink ?? undefined },
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

  return {
    matched: details.length,
    skipped,
    ambiguous: ambiguousDetails.length,
    details,
    ambiguousDetails,
  };
}
