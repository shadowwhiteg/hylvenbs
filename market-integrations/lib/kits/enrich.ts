import { prisma } from "@/lib/db";
import {
  ensureBrandAttribute,
  fillAttributesWithAi,
  mergeAttributes,
  parseAttributeList,
  toScrapedAttributes,
} from "@/lib/agent/attributes";
import { markUserEdited } from "@/lib/sync/merge";

export type EnrichKitResult = {
  kitId: string;
  attributeCount: number;
  applied: boolean;
  warnings: string[];
};

/**
 * Preenche as características do rascunho do kit com IA, reaproveitando o
 * mesmo pipeline usado nos produtos do catálogo.
 */
export async function enrichKitWithAi(kitId: string): Promise<EnrichKitResult> {
  const kit = await prisma.kit.findUnique({
    where: { id: kitId },
    include: { draft: true, items: true },
  });
  if (!kit?.draft) throw new Error("Kit sem rascunho");

  const existing = parseAttributeList(kit.draft.attributes);
  const generated = await fillAttributesWithAi({
    title: kit.draft.title || kit.title,
    description: kit.draft.description,
    scrapedAttributes: toScrapedAttributes(existing),
    categoryPath: kit.items.map((i) => i.titleSnapshot).filter(Boolean).join(" | ") || null,
  });

  const attributes = ensureBrandAttribute(mergeAttributes(existing, generated.attributes));
  await prisma.listingDraft.update({
    where: { id: kit.draft.id },
    data: {
      attributes: JSON.stringify(attributes),
      userEditedJson: markUserEdited(kit.draft.userEditedJson, ["attributes"]),
    },
  });

  return {
    kitId,
    attributeCount: attributes.length,
    applied: true,
    warnings: generated.warnings,
  };
}
