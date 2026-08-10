import { prisma } from "@/lib/db";
import { getSharedScrapeSession } from "@/lib/scrape/session-cache";
import { parsePriceFromHtml } from "@/lib/scrape/price";
import { parseUserEdited } from "@/lib/sync/merge";
import { simulateCosts } from "@/lib/pricing/simulator";
import { getAppSettings } from "@/lib/settings";

export type PriceSyncOutcome = {
  changed: boolean;
  costPrice?: number;
  error?: string;
};

/**
 * Refetches only the price of one product straight from its MeuDropBrasil
 * product page (no title/description/image/stock changes). The draft (ML
 * sale price) is only repriced when it would fall below the new cost and
 * the seller has not set it by hand — same rule as the full catalog sync
 * in lib/sync/run.ts.
 */
export async function syncProductPriceFromSource(
  productId: string
): Promise<PriceSyncOutcome> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { draft: true },
  });
  if (!product) return { changed: false, error: "Produto não encontrado" };

  const session = await getSharedScrapeSession();

  try {
    const html = await session.fetchText(product.sourceUrl);
    const parsed = parsePriceFromHtml(html);
    if (!parsed.found || !(parsed.value > 0)) {
      return { changed: false, error: "preço não encontrado na página" };
    }

    const costPrice = parsed.value;
    if (Math.abs(costPrice - product.costPrice) < 0.005) {
      return { changed: false, costPrice };
    }

    await prisma.product.update({
      where: { id: product.id },
      data: { costPrice, lastSyncedAt: new Date() },
    });

    if (product.draft) {
      const edited = parseUserEdited(product.draft.userEditedJson);
      if (!edited.price && product.draft.price < costPrice) {
        const settings = await getAppSettings();
        let suggested = costPrice;
        try {
          suggested = simulateCosts({
            costPrice,
            listingTypeId: product.draft.listingTypeId || "gold_special",
            marginPercent: product.draft.marginPercentOverride ?? settings.marginPercent,
          }).suggestedPrice;
        } catch {
          suggested = costPrice;
        }
        await prisma.listingDraft.update({
          where: { id: product.draft.id },
          data: { price: suggested },
        });
      }
    }

    return { changed: true, costPrice };
  } catch (err) {
    return { changed: false, error: err instanceof Error ? err.message : String(err) };
  }
}
