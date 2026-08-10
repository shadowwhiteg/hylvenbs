import { prisma } from "@/lib/db";
import { updateItem } from "@/lib/shopee/client";
import { getCategoryAttributes, type ShopeeAttributeDefinition } from "@/lib/shopee/category";
import { fillShopeeAttributesWithAi } from "@/lib/shopee/attributes-ai";
import { parseAttributeList, toScrapedAttributes } from "@/lib/agent/attributes";
import { parseShopeeAttributes, type ShopeeAttributeValue } from "@/lib/shopee/payload";

const SHOPEE_TITLE_MAX_LENGTH = 120;

function attributesEqual(a: ShopeeAttributeValue[], b: ShopeeAttributeValue[]): boolean {
  const norm = (list: ShopeeAttributeValue[]) =>
    list
      .map((x) => `${x.attribute_id}=${x.value.trim()}`)
      .sort()
      .join("|");
  return norm(a) === norm(b);
}

type ProductLike = {
  title: string;
  description: string;
  attributesJson: string;
};

export type ShopeeListingReviewResult = {
  shopeeListingId: string;
  matched: boolean;
  title?: { current: string; suggested: string; changed: boolean };
  attributes?: { current: ShopeeAttributeValue[]; suggested: ShopeeAttributeValue[]; changed: boolean };
  warnings: string[];
};

export async function reviewShopeeListingAgainstCatalog(
  shopeeListingId: string,
  opts?: { fetchImpl?: typeof fetch }
): Promise<ShopeeListingReviewResult> {
  const listing = await prisma.shopeeListing.findUnique({ where: { id: shopeeListingId } });
  if (!listing) throw new Error(`Anúncio Shopee ${shopeeListingId} não encontrado localmente`);

  const product = await prisma.product.findFirst({ where: { shopeeItemId: shopeeListingId } });
  if (!product) {
    return {
      shopeeListingId,
      matched: false,
      warnings: ["Anúncio avulso: sem produto do Meu Drop vinculado para comparar"],
    };
  }

  const warnings: string[] = [];

  const suggestedTitle = product.title.trim().slice(0, SHOPEE_TITLE_MAX_LENGTH);
  const titleChanged = Boolean(suggestedTitle) && suggestedTitle !== listing.title.trim();

  const currentAttrs = parseShopeeAttributes(listing.attributesJson);

  let mandatoryDefs: ShopeeAttributeDefinition[] = [];
  if (listing.categoryId) {
    try {
      mandatoryDefs = await getCategoryAttributes(Number(listing.categoryId));
    } catch (err) {
      warnings.push(
        `Não foi possível carregar atributos da categoria: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const missingDefs = mandatoryDefs.filter(
    (def) => def.isMandatory && !currentAttrs.some((a) => a.attribute_id === def.attributeId)
  );

  let merged = currentAttrs;
  if (missingDefs.length) {
    const scraped = toScrapedAttributes(parseAttributeList(product.attributesJson));
    const filled = await fillShopeeAttributesWithAi(
      {
        title: product.title,
        description: product.description,
        scrapedAttributes: scraped,
        attributeDefs: missingDefs,
      },
      opts
    );
    warnings.push(...filled.warnings);
    merged = [...currentAttrs, ...filled.attributes];
  }

  return {
    shopeeListingId,
    matched: true,
    title: { current: listing.title, suggested: suggestedTitle, changed: titleChanged },
    attributes: { current: currentAttrs, suggested: merged, changed: !attributesEqual(currentAttrs, merged) },
    warnings,
  };
}

export type ApplyShopeeReviewResult = ShopeeListingReviewResult & {
  applied: boolean;
  titleApplied: boolean;
  attributesApplied: boolean;
};

export async function applyShopeeListingReview(
  shopeeListingId: string,
  opts?: { fetchImpl?: typeof fetch }
): Promise<ApplyShopeeReviewResult> {
  const review = await reviewShopeeListingAgainstCatalog(shopeeListingId, opts);
  if (!review.matched) return { ...review, applied: false, titleApplied: false, attributesApplied: false };

  const payload: Record<string, unknown> = {};
  if (review.title?.changed) payload.item_name = review.title.suggested;
  if (review.attributes?.changed) {
    payload.attribute_list = review.attributes.suggested.map((a) => ({
      attribute_id: a.attribute_id,
      attribute_value_list: [{ value_id: 0, original_value_name: a.value }],
    }));
  }

  if (!payload.item_name && !payload.attribute_list) {
    return { ...review, applied: false, titleApplied: false, attributesApplied: false };
  }

  const res = await updateItem(shopeeListingId, payload, opts?.fetchImpl);
  if (!res.ok) {
    return {
      ...review,
      applied: false,
      titleApplied: false,
      attributesApplied: false,
      warnings: [...review.warnings, `Falha ao aplicar na Shopee: HTTP ${res.status} ${res.raw.slice(0, 150)}`],
    };
  }

  const titleApplied = Boolean(payload.item_name);
  const attributesApplied = Boolean(payload.attribute_list);

  await prisma.shopeeListing
    .update({
      where: { id: shopeeListingId },
      data: {
        title: titleApplied ? review.title!.suggested : review.title!.current,
        attributesJson: attributesApplied
          ? JSON.stringify(review.attributes!.suggested)
          : JSON.stringify(review.attributes!.current),
      },
    })
    .catch(() => undefined);

  return { ...review, applied: titleApplied || attributesApplied, titleApplied, attributesApplied };
}
