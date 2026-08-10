import { prisma } from "@/lib/db";
import { updateItem, pauseItem, type UpdateItemPayload } from "@/lib/ml/client";
import { simulateCosts } from "@/lib/pricing/simulator";
import { getAppSettings } from "@/lib/settings";
import {
  decideListingSync,
  shouldRecalculatePrice,
  type AutoSyncMode,
} from "@/lib/sync/auto-sync-policy";
import { parseUserEdited } from "@/lib/sync/merge";

export type ListingSyncDeps = {
  updateItemFn?: typeof updateItem;
  pauseItemFn?: typeof pauseItem;
  sleepFn?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxRetries?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function putWithBackoff(
  itemId: string,
  payload: UpdateItemPayload,
  deps: ListingSyncDeps
) {
  const updateFn = deps.updateItemFn ?? updateItem;
  const maxRetries = deps.maxRetries ?? 3;
  const sleepFn = deps.sleepFn ?? sleep;

  let last: Awaited<ReturnType<typeof updateItem>> | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await updateFn(itemId, payload);
    if (last.ok) return last;
    if (last.status === 429 && attempt < maxRetries) {
      const wait = 500 * Math.pow(2, attempt);
      await sleepFn(wait);
      continue;
    }
    break;
  }
  return last!;
}

export async function runMlListingSync(deps: ListingSyncDeps = {}) {
  const run = await prisma.mlSyncRun.create({ data: { status: "running" } });
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  try {
    const settings = await getAppSettings();
    const mode = settings.autoSyncMode as AutoSyncMode;
    const delayMs = deps.delayMs ?? 200;
    const sleepFn = deps.sleepFn ?? sleep;
    const pauseFn = deps.pauseItemFn ?? pauseItem;

    if (mode === "manual") {
      return prisma.mlSyncRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          finishedAt: new Date(),
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
          error: "autoSyncMode=manual; nenhum PUT automático",
        },
      });
    }

    const products = await prisma.product.findMany({
      where: { mlItemId: { not: null } },
      include: { draft: true },
    });

    for (const product of products) {
      if (!product.mlItemId || !product.draft) {
        skippedCount += 1;
        continue;
      }

      const edited = parseUserEdited(product.draft.userEditedJson);
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

      let price = product.draft.price;
      const margin =
        product.draft.marginPercentOverride ?? settings.marginPercent;

      const recalc = shouldRecalculatePrice({
        mode,
        priceUserEdited: Boolean(edited.price),
        treatAsUnavailable: decision.treatAsUnavailable,
      });

      if (recalc.recalculate && product.costPrice > 0) {
        try {
          price = simulateCosts({
            costPrice: product.costPrice,
            listingTypeId: product.draft.listingTypeId || "gold_special",
            marginPercent: margin,
          }).suggestedPrice;

          if (!edited.price) {
            await prisma.listingDraft.update({
              where: { id: product.draft.id },
              data: { price },
            });
          }
        } catch (err) {
          errors.push(
            `${product.mlItemId}: recalc ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      const quantity = decision.treatAsUnavailable
        ? 0
        : Math.max(0, product.draft.availableQuantity ?? product.stock ?? 0);

      if (!decision.treatAsUnavailable && quantity !== product.draft.availableQuantity) {
        await prisma.listingDraft.update({
          where: { id: product.draft.id },
          data: { availableQuantity: quantity },
        });
      } else if (decision.treatAsUnavailable) {
        await prisma.listingDraft.update({
          where: { id: product.draft.id },
          data: { availableQuantity: 0 },
        });
      }

      const payload: UpdateItemPayload = {};
      if (decision.updateQuantity) payload.available_quantity = quantity;
      if (decision.updatePrice && price > 0) payload.price = price;

      try {
        if (Object.keys(payload).length) {
          const result = await putWithBackoff(product.mlItemId, payload, deps);
          if (!result.ok) {
            errorCount += 1;
            errors.push(
              `${product.mlItemId}: HTTP ${result.status} ${result.raw.slice(0, 120)}`
            );
          } else {
            updatedCount += 1;
          }
        } else {
          skippedCount += 1;
        }

        if (decision.pauseListing) {
          const paused = await pauseFn(product.mlItemId);
          if (!paused.ok) {
            errorCount += 1;
            errors.push(`${product.mlItemId}: pause failed ${paused.status}`);
          }
        }
      } catch (err) {
        errorCount += 1;
        errors.push(
          `${product.mlItemId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (delayMs > 0) await sleepFn(delayMs);
    }

    return prisma.mlSyncRun.update({
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
    return prisma.mlSyncRun.update({
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
