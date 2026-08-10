import { prisma } from "@/lib/db";
import { getSharedScrapeSession } from "@/lib/scrape/session-cache";
import { parseStockFromHtml } from "@/lib/scrape/parse";
import { parseUserEdited } from "@/lib/sync/merge";
import { applyStockPercent } from "@/lib/sync/stock-percent";
import { getAppSettings } from "@/lib/settings";

export type StockSyncOutcome = {
  changed: boolean;
  stock?: number | null;
  error?: string;
};

/**
 * Refetches only the stock of one product straight from its MeuDropBrasil
 * product page (no title/description/image/price changes). Mirrors
 * lib/sync/price-refresh.ts. The draft's availableQuantity is kept in sync
 * unless the seller has set it by hand.
 */
export async function syncProductStockFromSource(
  productId: string
): Promise<StockSyncOutcome> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { draft: true },
  });
  if (!product) return { changed: false, error: "Produto não encontrado" };

  const session = await getSharedScrapeSession();

  try {
    const html = await session.fetchText(product.sourceUrl);
    const sourceStock = parseStockFromHtml(html);
    if (sourceStock === null) {
      return { changed: false, error: "estoque não encontrado na página" };
    }

    if (sourceStock === product.sourceStock) {
      return { changed: false, stock: product.stock };
    }

    const settings = await getAppSettings();
    const stock = applyStockPercent(sourceStock, settings.catalogStockPercent);

    await prisma.product.update({
      where: { id: product.id },
      data: { sourceStock, stock, lastSyncedAt: new Date() },
    });

    if (product.draft) {
      const edited = parseUserEdited(product.draft.userEditedJson);
      if (!edited.availableQuantity) {
        await prisma.listingDraft.update({
          where: { id: product.draft.id },
          data: { availableQuantity: Math.max(0, stock ?? 0) },
        });
      }
    }

    return { changed: true, stock };
  } catch (err) {
    return { changed: false, error: err instanceof Error ? err.message : String(err) };
  }
}
