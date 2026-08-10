import { isValidMlTitle, mlTitleNeedsAi } from "@/lib/agent/title";
import { applyStockPercent } from "@/lib/sync/stock-percent";

export type ScrapedAttribute = { name: string; value: string };

export type ScrapedProduct = {
  externalId: string;
  sourceUrl: string;
  title: string;
  costPrice: number;
  description: string;
  pictures: string[];
  stock?: number | null;
  videoUrl?: string | null;
  attributes?: ScrapedAttribute[];
  extraInfo?: Record<string, unknown>;
  sku?: string | null;
  categoryPath?: string | null;
  warranty?: string | null;
  /** Fields the scraper could not read for this product. */
  warnings?: string[];
};

export type DraftSnapshot = {
  title: string;
  description: string;
  price: number;
  pictures: string;
  attributes?: string;
  availableQuantity?: number;
  videoUrl?: string | null;
  userEditedJson: string;
};

export type ProductSnapshot = {
  title: string;
  costPrice: number;
  description: string;
  pictures: string;
  stock?: number | null;
  sourceStock?: number | null;
  videoUrl?: string | null;
  attributesJson?: string;
  extraInfoJson?: string;
  sku?: string | null;
  categoryPath?: string | null;
  warranty?: string | null;
  warningsJson?: string;
};

export function parseUserEdited(json: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(json || "{}") as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Merge scraped catalog fields into product/draft respecting userEdited flags. */
export function mergeScrapedIntoDraft(
  scraped: ScrapedProduct,
  product: ProductSnapshot,
  draft: DraftSnapshot,
  opts?: { catalogStockPercent?: number }
): { product: ProductSnapshot; draft: DraftSnapshot } {
  const edited = parseUserEdited(draft.userEditedJson);
  const attributesJson = JSON.stringify(scraped.attributes ?? []);
  const extraInfoJson = JSON.stringify(scraped.extraInfo ?? {});
  const percent = opts?.catalogStockPercent ?? 100;
  const sourceStock =
    scraped.stock !== undefined && scraped.stock !== null
      ? scraped.stock
      : product.sourceStock ?? product.stock ?? null;
  const stock = applyStockPercent(sourceStock, percent);

  // A scrape that failed to read the price must never zero out a known cost.
  const costPrice = scraped.costPrice > 0 ? scraped.costPrice : product.costPrice;

  const nextProduct: ProductSnapshot = {
    title: scraped.title,
    costPrice,
    description: scraped.description,
    pictures: scraped.pictures.length
      ? JSON.stringify(scraped.pictures)
      : product.pictures,
    stock,
    sourceStock,
    // The scrape is authoritative: no video on the page means the product has
    // none, so a stale value from an earlier (buggy) run must be cleared.
    videoUrl: scraped.videoUrl ?? null,
    attributesJson,
    extraInfoJson,
    sku: scraped.sku ?? product.sku ?? null,
    categoryPath: scraped.categoryPath ?? product.categoryPath ?? null,
    warranty: scraped.warranty ?? product.warranty ?? null,
    warningsJson: JSON.stringify(scraped.warnings ?? []),
  };

  const nextDraft: DraftSnapshot = {
    ...draft,
    title: edited.title
      ? draft.title
      : !mlTitleNeedsAi(scraped.title)
        ? scraped.title
        : isValidMlTitle(draft.title) && scraped.title === product.title
          ? draft.title
          : "",
    description: edited.description ? draft.description : scraped.description,
    pictures:
      edited.pictures || !scraped.pictures.length
        ? draft.pictures
        : JSON.stringify(scraped.pictures),
    attributes: edited.attributes
      ? draft.attributes ?? attributesJson
      : attributesJson,
    videoUrl: edited.videoUrl ? draft.videoUrl ?? null : scraped.videoUrl ?? null,
    availableQuantity: edited.availableQuantity
      ? draft.availableQuantity ?? 1
      : stock !== null && stock !== undefined
        ? Math.max(0, stock)
        : draft.availableQuantity ?? 1,
    // price is never auto-overwritten if user edited; otherwise leave existing draft price
    // or seed from cost if draft price is 0
    price: edited.price
      ? draft.price
      : draft.price > 0
        ? draft.price
        : costPrice,
  };

  void product;

  return { product: nextProduct, draft: nextDraft };
}

export function markUserEdited(
  currentJson: string,
  fields: string[]
): string {
  const edited = parseUserEdited(currentJson);
  for (const field of fields) {
    edited[field] = true;
  }
  return JSON.stringify(edited);
}
