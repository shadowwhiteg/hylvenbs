import { prisma } from "@/lib/db";
import { unlistItem, updateStock } from "@/lib/shopee/client";

export type ShopeeStockSyncDeps = {
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
  deps: ShopeeStockSyncDeps
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

export type ShopeeStockSyncOutcome = {
  updated: number;
  paused: number;
  skipped: number;
  errors: string[];
};

/** Espelha lib/ml/stock-sync.ts: sincroniza estoque com o catálogo Meu Drop; zerou, unlist (nunca reativa sozinho). */
export async function syncShopeeListingStockFromCatalog(
  ids: string[] | undefined,
  deps: ShopeeStockSyncDeps = {}
): Promise<ShopeeStockSyncOutcome> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;
  const stockFn = deps.updateStockFn ?? updateStock;
  const unlistFn = deps.unlistItemFn ?? unlistItem;

  const listings = await prisma.shopeeListing.findMany({
    where: ids?.length ? { id: { in: ids } } : undefined,
    select: { id: true, stock: true, status: true },
  });

  const products = await prisma.product.findMany({
    where: { shopeeItemId: { in: listings.map((l) => l.id) } },
    select: { shopeeItemId: true, stock: true },
  });
  const stockByListing = new Map(products.map((p) => [p.shopeeItemId!, p.stock]));

  let updated = 0;
  let paused = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const listing of listings) {
    if (!stockByListing.has(listing.id)) {
      skipped += 1;
      continue;
    }

    const desired = Math.max(0, stockByListing.get(listing.id) ?? 0);
    const outOfStock = desired <= 0;
    const stockChanged = desired !== listing.stock;
    const shouldPause = outOfStock && listing.status === "NORMAL";

    if (!stockChanged && !shouldPause) {
      skipped += 1;
      continue;
    }

    if (stockChanged) {
      const res = await withBackoff(() => stockFn(listing.id, desired), deps);
      if (!res.ok) {
        errors.push(`${listing.id}: HTTP ${res.status}`);
        continue;
      }
    }

    if (shouldPause) {
      const res = await withBackoff(() => unlistFn(listing.id, true), deps);
      if (!res.ok) {
        errors.push(`${listing.id}: unlist HTTP ${res.status}`);
        continue;
      }
    }

    await prisma.shopeeListing
      .update({
        where: { id: listing.id },
        data: { stock: desired, status: shouldPause ? "UNLIST" : listing.status },
      })
      .catch(() => undefined);

    updated += 1;
    if (shouldPause) paused += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, paused, skipped, errors };
}
