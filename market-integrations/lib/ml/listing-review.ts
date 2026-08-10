import { prisma } from "@/lib/db";
import { updateItem } from "@/lib/ml/client";
import { serializeAttributesForMl, type MlApiAttribute } from "@/lib/ml/attributes";
import {
  fillAttributesWithAi,
  parseAttributeList,
  toScrapedAttributes,
} from "@/lib/agent/attributes";
import { extractProductIdentifiers } from "@/lib/ml/catalog";
import {
  ML_TITLE_MAX_LENGTH,
  generateMlTitleWithAi,
  mlTitleNeedsAi,
} from "@/lib/agent/title";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Formato bruto salvo em MlListing.attributesJson (snapshot da API do ML). */
export type RawMlAttribute = {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
};

export function parseRawAttributes(json: string | null | undefined): RawMlAttribute[] {
  try {
    const parsed: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is RawMlAttribute => Boolean(a) && typeof a === "object" && typeof (a as RawMlAttribute).id === "string"
    );
  } catch {
    return [];
  }
}

/** Usado pela listagem/filtros pra mostrar "sem SKU"/"sem EAN" sem duplicar o parser. */
export function readSkuAndEan(attributesJson: string | null | undefined): {
  sku: string | null;
  ean: string | null;
} {
  const attrs = parseRawAttributes(attributesJson);
  const sku = attrs.find((a) => a.id === "SELLER_SKU")?.value_name?.trim() || null;
  const ean = attrs.find((a) => a.id === "GTIN")?.value_name?.trim() || null;
  return { sku, ean };
}

function attributesEqual(a: RawMlAttribute[], b: RawMlAttribute[]): boolean {
  const norm = (list: RawMlAttribute[]) =>
    list
      .map((x) => `${x.id}=${(x.value_name ?? "").trim()}`)
      .sort()
      .join("|");
  return norm(a) === norm(b);
}

/** O catálogo do Meu Drop vence conflito de id; ids que só existem no ML atual são preservados. */
function overlayCatalogAttributes(
  current: RawMlAttribute[],
  catalog: MlApiAttribute[]
): RawMlAttribute[] {
  const byId = new Map<string, RawMlAttribute>();
  for (const attr of current) byId.set(attr.id, attr);
  for (const attr of catalog) {
    if (!attr.value_name?.trim()) continue;
    byId.set(attr.id, {
      id: attr.id,
      name: byId.get(attr.id)?.name,
      value_name: attr.value_name,
      value_id: attr.value_id ?? null,
    });
  }
  return [...byId.values()];
}

type ProductLike = {
  title: string;
  description: string;
  sku: string | null;
  attributesJson: string;
  categoryPath: string | null;
};

async function computeCatalogTitle(
  product: ProductLike,
  opts?: { fetchImpl?: typeof fetch }
): Promise<{ title: string; warnings: string[] }> {
  const original = product.title.trim();
  if (!original) return { title: "", warnings: ["Produto do Meu Drop sem título"] };
  if (!mlTitleNeedsAi(original)) return { title: original, warnings: [] };

  const ai = await generateMlTitleWithAi(
    { originalTitle: original, description: product.description, categoryPath: product.categoryPath },
    { fetchImpl: opts?.fetchImpl }
  );
  return { title: ai.title, warnings: ai.warnings };
}

/** Preenche com IA só os ids que nem o ML nem o catálogo do Meu Drop já cobrem. */
async function fillAttributeGapsWithAi(
  product: ProductLike,
  alreadyCoveredIds: Set<string>,
  opts?: { fetchImpl?: typeof fetch }
): Promise<{ additions: RawMlAttribute[]; warnings: string[] }> {
  const scraped = toScrapedAttributes(parseAttributeList(product.attributesJson));
  const generated = await fillAttributesWithAi(
    {
      title: product.title,
      description: product.description,
      scrapedAttributes: scraped,
      categoryPath: product.categoryPath,
    },
    { fetchImpl: opts?.fetchImpl }
  );

  const additions: RawMlAttribute[] = [];
  for (const attr of generated.attributes) {
    if (!attr.id || alreadyCoveredIds.has(attr.id)) continue;
    if (!attr.value_name?.trim()) continue;
    additions.push({ id: attr.id, name: attr.name, value_name: attr.value_name });
  }
  return { additions, warnings: generated.warnings };
}

export type CategoryComparison = {
  current: string | null;
  suggested: string;
  suggestedName: string;
  matches: boolean;
};

export type ListingReviewResult = {
  mlListingId: string;
  matched: boolean;
  title?: { current: string; suggested: string; changed: boolean };
  attributes?: { current: RawMlAttribute[]; suggested: RawMlAttribute[]; changed: boolean };
  /** Só calculado quando pedido explicitamente — o ML NÃO permite trocar categoria via API, é só informativo. */
  category?: CategoryComparison | null;
  warnings: string[];
};

export async function reviewListingAgainstCatalog(
  mlListingId: string,
  opts?: { includeCategory?: boolean; fetchImpl?: typeof fetch }
): Promise<ListingReviewResult> {
  const listing = await prisma.mlListing.findUnique({ where: { id: mlListingId } });
  if (!listing) throw new Error(`Anúncio ${mlListingId} não encontrado localmente`);

  const product = await prisma.product.findFirst({ where: { mlItemId: mlListingId } });
  if (!product) {
    return {
      mlListingId,
      matched: false,
      warnings: ["Anúncio avulso: sem produto do Meu Drop vinculado para comparar"],
    };
  }

  const warnings: string[] = [];

  const { title: suggestedTitle, warnings: titleWarnings } = await computeCatalogTitle(product, opts);
  warnings.push(...titleWarnings);
  const titleChanged = Boolean(suggestedTitle.trim()) && suggestedTitle.trim() !== listing.title.trim();

  const currentAttrs = parseRawAttributes(listing.attributesJson);
  // inferModel:false de propósito — o palpite de MODEL a partir do título é uma
  // heurística (útil ao publicar do zero), não um dado real do catálogo Meu Drop;
  // aqui a revisão deve refletir só o que o catálogo realmente informa.
  const catalogAttrs = serializeAttributesForMl(product.attributesJson, {
    title: product.title,
    inferModel: false,
  });

  const skuAttrs: MlApiAttribute[] = product.sku?.trim()
    ? [{ id: "SELLER_SKU", value_name: product.sku.trim() }]
    : [];

  // GTIN: prioriza o que já veio estruturado no scrape; sem isso, tenta extrair da descrição.
  const hasGtinFromCatalog = catalogAttrs.some((a) => a.id === "GTIN");
  const identifiers = extractProductIdentifiers({
    attributesJson: product.attributesJson,
    description: product.description,
  });
  const gtinAttrs: MlApiAttribute[] =
    !hasGtinFromCatalog && identifiers.gtin ? [{ id: "GTIN", value_name: identifiers.gtin }] : [];

  let merged = overlayCatalogAttributes(currentAttrs, [...catalogAttrs, ...skuAttrs, ...gtinAttrs]);

  const coveredIds = new Set(merged.map((a) => a.id));
  const gapFill = await fillAttributeGapsWithAi(product, coveredIds, opts);
  warnings.push(...gapFill.warnings);
  merged = [...merged, ...gapFill.additions];

  let category: CategoryComparison | null | undefined;
  if (opts?.includeCategory) {
    try {
      const { categorizeProduct } = await import("@/lib/ml/categorize-product");
      const result = await categorizeProduct({
        title: product.title,
        description: product.description,
        categoryPath: product.categoryPath,
        allowAiFallback: true,
        fetchImpl: opts?.fetchImpl,
      });
      category = result.categoryId
        ? {
            current: listing.categoryId,
            suggested: result.categoryId,
            suggestedName: result.categoryName,
            matches: listing.categoryId === result.categoryId,
          }
        : null;
    } catch (err) {
      warnings.push(
        `Não foi possível comparar categoria: ${err instanceof Error ? err.message : String(err)}`
      );
      category = null;
    }
  }

  return {
    mlListingId,
    matched: true,
    title: { current: listing.title, suggested: suggestedTitle, changed: titleChanged },
    attributes: { current: currentAttrs, suggested: merged, changed: !attributesEqual(currentAttrs, merged) },
    category,
    warnings,
  };
}

export type ApplyReviewResult = ListingReviewResult & {
  applied: boolean;
  titleApplied: boolean;
  attributesApplied: boolean;
};

export async function applyListingReview(
  mlListingId: string,
  opts?: { includeCategory?: boolean; fetchImpl?: typeof fetch }
): Promise<ApplyReviewResult> {
  const review = await reviewListingAgainstCatalog(mlListingId, opts);
  if (!review.matched) return { ...review, applied: false, titleApplied: false, attributesApplied: false };

  const payload: { title?: string; attributes?: RawMlAttribute[] } = {};
  if (review.title?.changed) payload.title = review.title.suggested.slice(0, ML_TITLE_MAX_LENGTH);
  if (review.attributes?.changed) payload.attributes = review.attributes.suggested;

  if (!payload.title && !payload.attributes) {
    return { ...review, applied: false, titleApplied: false, attributesApplied: false };
  }

  const res = await updateItem(
    mlListingId,
    {
      title: payload.title,
      attributes: payload.attributes?.map((a) => ({
        id: a.id,
        value_name: a.value_name ?? undefined,
        value_id: a.value_id ?? undefined,
      })),
    },
    opts?.fetchImpl
  );

  if (!res.ok) {
    return {
      ...review,
      applied: false,
      titleApplied: false,
      attributesApplied: false,
      warnings: [...review.warnings, `Falha ao aplicar no ML: HTTP ${res.status} ${res.raw.slice(0, 150)}`],
    };
  }

  // O ML pode devolver 200 e simplesmente ignorar um campo que não aceita mudar
  // (ex.: título de item vinculado ao catálogo oficial, controlado por lá, não
  // pelo vendedor) — sem isso, a gente registraria uma mudança que nunca aconteceu.
  const warnings = [...review.warnings];
  const titleApplied = Boolean(payload.title) && res.data.title === payload.title;
  if (payload.title && !titleApplied) {
    warnings.push(
      `Título não foi alterado pelo ML (respondeu OK mas manteve "${res.data.title ?? review.title!.current}") — provavelmente o anúncio está vinculado ao catálogo oficial do ML, onde o título é controlado por lá, não pelo vendedor.`
    );
  }

  // Atributos não vêm de volta no corpo da resposta do PUT de forma confiável
  // pra comparar 1:1; como já confirmamos (GTIN/SELLER_SKU) que esse campo é
  // aceito pela API central de items, um 200 aqui é aceito como aplicado.
  const attributesApplied = Boolean(payload.attributes);

  await prisma.mlListing
    .update({
      where: { id: mlListingId },
      data: {
        title: titleApplied ? payload.title! : review.title!.current,
        attributesJson: attributesApplied
          ? JSON.stringify(review.attributes!.suggested)
          : JSON.stringify(review.attributes!.current),
      },
    })
    .catch(() => undefined);

  return {
    ...review,
    applied: titleApplied || attributesApplied,
    titleApplied,
    attributesApplied,
    warnings,
  };
}

export type BulkReviewResult = {
  updated: number;
  skipped: number;
  errors: string[];
  details: Array<{ id: string; titleChanged: boolean; attributesChanged: boolean }>;
  warnings: string[];
};

export async function applyBulkReview(
  ids: string[],
  deps: { delayMs?: number; sleepFn?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch } = {}
): Promise<BulkReviewResult> {
  const delayMs = deps.delayMs ?? 300;
  const sleepFn = deps.sleepFn ?? sleep;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const details: BulkReviewResult["details"] = [];

  for (const id of ids) {
    try {
      const result = await applyListingReview(id, { fetchImpl: deps.fetchImpl });
      if (!result.matched) {
        // Avulso (sem produto Meu Drop vinculado) é normal, não é falha — só conta como pulado.
        skipped += 1;
        continue;
      }
      if (!result.applied) {
        skipped += 1;
        continue;
      }
      updated += 1;
      if (result.warnings.length) warnings.push(`${id}: ${result.warnings.join("; ")}`);
      details.push({
        id,
        titleChanged: result.titleApplied,
        attributesChanged: result.attributesApplied,
      });
    } catch (err) {
      errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, skipped, errors, details, warnings };
}
