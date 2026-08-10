import { prisma } from "@/lib/db";
import { applyStockPercent } from "@/lib/sync/stock-percent";
import { parseUserEdited } from "@/lib/sync/merge";

/** Recalcula stock/availableQuantity a partir do sourceStock salvo. */
export async function reapplyCatalogStockPercent(percent: number): Promise<number> {
  const products = await prisma.product.findMany({
    where: { sourceStock: { not: null } },
    include: { draft: true },
  });

  let updated = 0;
  for (const product of products) {
    const stock = applyStockPercent(product.sourceStock, percent);
    await prisma.product.update({
      where: { id: product.id },
      data: { stock },
    });

    if (product.draft) {
      const edited = parseUserEdited(product.draft.userEditedJson);
      if (!edited.availableQuantity) {
        await prisma.listingDraft.update({
          where: { id: product.draft.id },
          data: { availableQuantity: stock !== null ? Math.max(0, stock) : 1 },
        });
      }
    }
    updated += 1;
  }

  return updated;
}
