import { prisma } from "@/lib/db";
import { updateItem } from "@/lib/ml/client";

export type StockSyncDeps = {
  updateItemFn?: typeof updateItem;
  sleepFn?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxRetries?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function putWithBackoff(
  itemId: string,
  payload: Parameters<typeof updateItem>[1],
  deps: StockSyncDeps
) {
  const updateFn = deps.updateItemFn ?? updateItem;
  const maxRetries = deps.maxRetries ?? 3;
  const sleepFn = deps.sleepFn ?? sleep;

  let last: Awaited<ReturnType<typeof updateItem>> | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await updateFn(itemId, payload);
    if (last.ok) return last;
    if (last.status === 429 && attempt < maxRetries) {
      await sleepFn(500 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  return last!;
}

export type StockSyncOutcome = {
  updated: number;
  paused: number;
  skipped: number;
  errors: string[];
};

/**
 * Sincroniza o estoque do ML com o que está registrado do Meu Drop
 * (Product.stock, já ajustado pelo percentual configurado). Zerou lá,
 * pausa o anúncio — nunca reativa sozinho (pode ter sido pausado por outro
 * motivo), então a volta do estoque só atualiza a quantidade.
 */
export async function syncListingStockFromCatalog(
  ids: string[] | undefined,
  deps: StockSyncDeps = {}
): Promise<StockSyncOutcome> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;

  const listings = await prisma.mlListing.findMany({
    where: ids?.length ? { id: { in: ids } } : undefined,
    select: { id: true, availableQuantity: true, status: true },
  });

  const products = await prisma.product.findMany({
    where: { mlItemId: { in: listings.map((l) => l.id) } },
    select: { mlItemId: true, stock: true },
  });
  const stockByListing = new Map(products.map((p) => [p.mlItemId!, p.stock]));

  let updated = 0;
  let paused = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const listing of listings) {
    if (!stockByListing.has(listing.id)) {
      skipped += 1; // avulso: sem produto Meu Drop vinculado, nada pra sincronizar
      continue;
    }

    const desired = Math.max(0, stockByListing.get(listing.id) ?? 0);
    const outOfStock = desired <= 0;
    const payload: Parameters<typeof updateItem>[1] = {};

    if (desired !== listing.availableQuantity) payload.available_quantity = desired;
    if (outOfStock && listing.status === "active") payload.status = "paused";

    if (!Object.keys(payload).length) {
      skipped += 1;
      continue;
    }

    const res = await putWithBackoff(listing.id, payload, deps);
    if (!res.ok) {
      errors.push(`${listing.id}: HTTP ${res.status}`);
      continue;
    }

    await prisma.mlListing
      .update({
        where: { id: listing.id },
        data: {
          availableQuantity: desired,
          status: payload.status ?? listing.status,
        },
      })
      .catch(() => undefined);

    updated += 1;
    if (payload.status === "paused") paused += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, paused, skipped, errors };
}
