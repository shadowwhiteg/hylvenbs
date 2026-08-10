import { prisma } from "@/lib/db";
import { unlistItem, updatePrice, updateStock } from "@/lib/shopee/client";
import { simulateCosts } from "@/lib/pricing/simulator";
import { getAppSettings } from "@/lib/settings";
import {
  decideListingSync,
  shouldRecalculatePrice,
  type AutoSyncMode,
} from "@/lib/sync/auto-sync-policy";
import { parseUserEdited } from "@/lib/sync/merge";

export type ShopeeListingSyncDeps = {
  updatePriceFn?: typeof updatePrice;
  updateStockFn?: typeof updateStock;
  unlistItemFn?: typeof unlistItem;
  sleepFn?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxRetries?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withBackoff<T extends { ok: boolean; status: number }>(
  fn: () => Promise<T>,
  deps: ShopeeListingSyncDeps
): Promise<T> {
  const maxRetries = deps.maxRetries ?? 3;
  const sleepFn = deps.sleepFn ?? sleep;

  let last: T | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await fn();
    if (last.ok) return last;
    if (last.status === 429 && attempt < maxRetries) {
      await sleepFn(500 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  return last!;
}

export async function runShopeeListingSync(deps: ShopeeListingSyncDeps = {}) {
  const run = await prisma.shopeeSyncRun.create({ data: { status: "running" } });
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  try {
    const settings = await getAppSettings();
    const mode = settings.autoSyncMode as AutoSyncMode;
    const delayMs = deps.delayMs ?? 200;
    const sleepFn = deps.sleepFn ?? sleep;
    const priceFn = deps.updatePriceFn ?? updatePrice;
    const stockFn = deps.updateStockFn ?? updateStock;
    const unlistFn = deps.unlistItemFn ?? unlistItem;

    if (mode === "manual") {
      return prisma.shopeeSyncRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          finishedAt: new Date(),
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
          error: "autoSyncMode=manual; nenhum push automático",
        },
      });
    }

    const products = await prisma.product.findMany({
      where: { shopeeItemId: { not: null } },
      include: { shopeeDraft: true },
    });

    for (const product of products) {
      if (!product.shopeeItemId || !product.shopeeDraft) {
        skippedCount += 1;
        continue;
      }

      const edited = parseUserEdited(product.shopeeDraft.userEditedJson);
      const decision = decideListingSync({
        mode,
        autoPauseWhenUnavailable: settings.autoPauseWhenUnavailable,
        hasMlItemId: true,
        productStatus: product.status,
        priceUserEdited: Boolean(edited.price),
        stock: product.stock,
      });

      if (!decision.shouldPush) {
        skippedCount += 1;
        continue;
      }

      let price = product.shopeeDraft.price;
      const margin = settings.marginPercent;

      const recalc = shouldRecalculatePrice({
        mode,
        priceUserEdited: Boolean(edited.price),
        treatAsUnavailable: decision.treatAsUnavailable,
      });

      if (recalc.recalculate && product.costPrice > 0) {
        try {
          price = simulateCosts({
            costPrice: product.costPrice,
            listingTypeId: "gold_special",
            marginPercent: margin,
          }).suggestedPrice;

          if (!edited.price) {
            await prisma.shopeeListingDraft.update({
              where: { id: product.shopeeDraft.id },
              data: { price },
            });
          }
        } catch (err) {
          errors.push(
            `${product.shopeeItemId}: recalc ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      const quantity = decision.treatAsUnavailable
        ? 0
        : Math.max(0, product.shopeeDraft.stock ?? product.stock ?? 0);

      if (quantity !== product.shopeeDraft.stock) {
        await prisma.shopeeListingDraft.update({
          where: { id: product.shopeeDraft.id },
          data: { stock: quantity },
        });
      }

      try {
        if (decision.updateQuantity) {
          const result = await withBackoff(() => stockFn(product.shopeeItemId!, quantity), deps);
          if (!result.ok) {
            errorCount += 1;
            errors.push(`${product.shopeeItemId}: estoque HTTP ${result.status}`);
          } else {
            updatedCount += 1;
          }
        }

        if (decision.updatePrice && price > 0) {
          const result = await withBackoff(() => priceFn(product.shopeeItemId!, price), deps);
          if (!result.ok) {
            errorCount += 1;
            errors.push(`${product.shopeeItemId}: preço HTTP ${result.status}`);
          } else {
            updatedCount += 1;
          }
        }

        if (!decision.updateQuantity && !decision.updatePrice) {
          skippedCount += 1;
        }

        if (decision.pauseListing) {
          const paused = await withBackoff(() => unlistFn(product.shopeeItemId!, true), deps);
          if (!paused.ok) {
            errorCount += 1;
            errors.push(`${product.shopeeItemId}: unlist HTTP ${paused.status}`);
          }
        }
      } catch (err) {
        errorCount += 1;
        errors.push(`${product.shopeeItemId}: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (delayMs > 0) await sleepFn(delayMs);
    }

    return prisma.shopeeSyncRun.update({
      where: { id: run.id },
      data: {
        status: errorCount && !updatedCount ? "error" : "success",
        finishedAt: new Date(),
        updatedCount,
        skippedCount,
        errorCount,
        error: errors.length ? errors.slice(0, 20).join("; ") : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return prisma.shopeeSyncRun.update({
      where: { id: run.id },
      data: {
        status: "error",
        finishedAt: new Date(),
        updatedCount,
        skippedCount,
        errorCount: errorCount + 1,
        error: message,
      },
    });
  }
}
