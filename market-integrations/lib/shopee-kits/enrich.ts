import { prisma } from "@/lib/db";
import { parseAttributeList, toScrapedAttributes } from "@/lib/agent/attributes";
import { categorizeWithAi, getCategoryAttributes } from "@/lib/shopee/category";
import { fillShopeeAttributesWithAi } from "@/lib/shopee/attributes-ai";
import { parseShopeeAttributes } from "@/lib/shopee/payload";
import { markUserEdited } from "@/lib/sync/merge";

export type EnrichShopeeKitResult = {
  kitId: string;
  categoryId: string;
  attributeCount: number;
  applied: boolean;
  warnings: string[];
};

/**
 * Preenche categoria + características do rascunho Shopee do kit com IA.
 * Diferente do ML, a Shopee não tem preditor de categoria — por isso a
 * categorização também é feita aqui quando o kit ainda não tem uma.
 */
export async function enrichShopeeKitWithAi(kitId: string): Promise<EnrichShopeeKitResult> {
  const kit = await prisma.kit.findUnique({
    where: { id: kitId },
    include: { shopeeDraft: true, items: true },
  });
  if (!kit?.shopeeDraft) throw new Error("Kit sem rascunho Shopee");

  const warnings: string[] = [];
  let categoryId = kit.shopeeDraft.categoryId;

  if (!categoryId?.trim()) {
    const category = await categorizeWithAi({
      title: kit.shopeeDraft.title || kit.title,
      description: kit.shopeeDraft.description,
    });
    warnings.push(...category.warnings);
    if (category.categoryId) {
      categoryId = category.categoryId;
      await prisma.shopeeListingDraft.update({
        where: { id: kit.shopeeDraft.id },
        data: { categoryId },
      });
    }
  }

  const existing = parseShopeeAttributes(kit.shopeeDraft.attributes);
  let attributeDefs: Awaited<ReturnType<typeof getCategoryAttributes>> = [];
  if (categoryId?.trim()) {
    try {
      attributeDefs = await getCategoryAttributes(Number(categoryId));
    } catch (err) {
      warnings.push(
        `Não foi possível carregar atributos da categoria: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const missingDefs = attributeDefs.filter(
    (def) => def.isMandatory && !existing.some((a) => a.attribute_id === def.attributeId)
  );

  let attributes = existing;
  if (missingDefs.length) {
    const scraped = toScrapedAttributes(parseAttributeList(kit.shopeeDraft.attributes));
    const filled = await fillShopeeAttributesWithAi({
      title: kit.shopeeDraft.title || kit.title,
      description: kit.shopeeDraft.description,
      scrapedAttributes: scraped,
      attributeDefs: missingDefs,
    });
    warnings.push(...filled.warnings);
    attributes = [...existing, ...filled.attributes];
  }

  const brand = kit.shopeeDraft.brandName?.trim();
  const brandUpdate = brand ? {} : { brandName: "Sem marca" };

  await prisma.shopeeListingDraft.update({
    where: { id: kit.shopeeDraft.id },
    data: {
      attributes: JSON.stringify(attributes.map((a) => ({ attribute_id: a.attribute_id, value: a.value }))),
      userEditedJson: markUserEdited(kit.shopeeDraft.userEditedJson, ["attributes"]),
      ...brandUpdate,
    },
  });

  return { kitId, categoryId: categoryId || "", attributeCount: attributes.length, applied: true, warnings };
}
