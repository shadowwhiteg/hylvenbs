import { prisma } from "@/lib/db";
import { unlistItem, updatePrice } from "@/lib/shopee/client";
import { simulateCosts } from "@/lib/pricing/simulator";

export type ShopeePromotionsSyncDeps = {
  updatePriceFn?: typeof updatePrice;
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
  deps: ShopeePromotionsSyncDeps
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

export type ShopeeBulkPriceResult = { updated: number; errors: string[] };

export async function applyShopeeBulkPrice(
  input: { ids: string[]; price?: number; marginPercent?: number },
  deps: ShopeePromotionsSyncDeps = {}
): Promise<ShopeeBulkPriceResult> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;
  const priceFn = deps.updatePriceFn ?? updatePrice;
  let updated = 0;
  const errors: string[] = [];

  for (const id of input.ids) {
    let price = input.price;
    if (price == null && input.marginPercent != null) {
      const product = await prisma.product.findFirst({
        where: { shopeeItemId: id },
        select: { costPrice: true },
      });
      if (!product || !(product.costPrice > 0)) {
        errors.push(`${id}: sem produto/custo local para calcular margem`);
        continue;
      }
      price = simulateCosts({
        costPrice: product.costPrice,
        listingTypeId: "gold_special",
        marginPercent: input.marginPercent,
      }).suggestedPrice;
    }
    if (price == null || !(price > 0)) {
      errors.push(`${id}: preço inválido`);
      continue;
    }

    const res = await withBackoff(() => priceFn(id, price!), deps);
    if (!res.ok) {
      errors.push(`${id}: HTTP ${res.status}`);
      continue;
    }
    await prisma.shopeeListing.update({ where: { id }, data: { price } }).catch(() => undefined);
    updated += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, errors };
}

export type ShopeeBulkStatusResult = { updated: number; errors: string[] };

export async function applyShopeeBulkStatus(
  input: { ids: string[]; status: "active" | "paused" },
  deps: ShopeePromotionsSyncDeps = {}
): Promise<ShopeeBulkStatusResult> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;
  const unlistFn = deps.unlistItemFn ?? unlistItem;
  let updated = 0;
  const errors: string[] = [];

  for (const id of input.ids) {
    const res = await withBackoff(() => unlistFn(id, input.status === "paused"), deps);
    if (!res.ok) {
      errors.push(`${id}: HTTP ${res.status}`);
      continue;
    }
    await prisma.shopeeListing
      .update({ where: { id }, data: { status: input.status === "paused" ? "UNLIST" : "NORMAL" } })
      .catch(() => undefined);
    updated += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, errors };
}
