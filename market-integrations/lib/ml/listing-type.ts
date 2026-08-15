import { prisma } from "@/lib/db";
import { changeItemListingType, getItemListingType } from "@/lib/ml/client";
import type { MlListingType } from "@/lib/ml/listing-type-meta";

export {
  ML_LISTING_TYPES,
  ML_LISTING_TYPE_LABELS,
  parseMlListingType,
  type MlListingType,
} from "@/lib/ml/listing-type-meta";

export type BulkListingTypeResult = {
  updated: number;
  /** Já estavam no tipo pedido — nenhuma chamada foi feita. */
  skipped: number;
  errors: string[];
};

export type ListingTypeDeps = {
  changeFn?: typeof changeItemListingType;
  readFn?: typeof getItemListingType;
  sleepFn?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxRetries?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Mesmo backoff em 429 usado em preço/status (lib/ml/promotions-sync.ts). */
async function changeWithBackoff(
  itemId: string,
  listingTypeId: MlListingType,
  deps: ListingTypeDeps
) {
  const changeFn = deps.changeFn ?? changeItemListingType;
  const maxRetries = deps.maxRetries ?? 3;
  const sleepFn = deps.sleepFn ?? sleep;

  let last: Awaited<ReturnType<typeof changeItemListingType>> | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await changeFn(itemId, listingTypeId);
    if (last.ok) return last;
    if (last.status === 429 && attempt < maxRetries) {
      await sleepFn(500 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  return last!;
}

/**
 * Espelha o tipo no snapshot e no rascunho do produto. Sempre juntos: deixar só
 * o snapshot atualizado faz a margem exibida usar a comissão da faixa errada.
 */
async function syncLocalListingType(id: string, listingTypeId: MlListingType) {
  await prisma.mlListing
    .update({ where: { id }, data: { listingTypeId } })
    .catch(() => undefined);
  await prisma.listingDraft
    .updateMany({ where: { product: { mlItemId: id } }, data: { listingTypeId } })
    .catch(() => undefined);
}

/**
 * Converte anúncios já publicados para Clássico/Premium.
 *
 * Além do snapshot local, sincroniza `ListingDraft.listingTypeId` do produto
 * vinculado: as tabelas de taxa (lib/pricing/marketplace-fees) escolhem a
 * comissão por esse campo, então deixá-lo defasado faria a margem exibida e o
 * recálculo de preço mentirem depois da troca.
 */
export async function applyBulkListingType(
  input: { ids: string[]; listingTypeId: MlListingType },
  deps: ListingTypeDeps = {}
): Promise<BulkListingTypeResult> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const id of input.ids) {
    const current = await prisma.mlListing
      .findUnique({ where: { id }, select: { listingTypeId: true } })
      .catch(() => null);
    if (current?.listingTypeId === input.listingTypeId) {
      skipped += 1;
      continue;
    }

    const res = await changeWithBackoff(id, input.listingTypeId, deps);
    if (!res.ok) {
      // O ML recusa a troca ("not possible to upgrade or downgrade") quando o
      // anúncio JÁ está no tipo pedido. Com o snapshot local defasado isso vira
      // erro falso — então confirmamos o estado real antes de acusar falha, e
      // aproveitamos para corrigir o registro local.
      const readFn = deps.readFn ?? getItemListingType;
      const current = await readFn(id).catch(() => null);
      if (current?.ok && current.data?.listing_type_id === input.listingTypeId) {
        await syncLocalListingType(id, input.listingTypeId);
        skipped += 1;
        continue;
      }
      const detail =
        typeof res.data?.message === "string" ? `: ${res.data.message}` : "";
      errors.push(`${id}: HTTP ${res.status}${detail}`);
      continue;
    }

    // O ML às vezes responde 200 sem trocar de fato; confia no que ele devolveu.
    const applied = res.data?.listing_type_id;
    if (applied && applied !== input.listingTypeId) {
      errors.push(`${id}: ML manteve ${applied}`);
      continue;
    }

    await syncLocalListingType(id, input.listingTypeId);
    updated += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, skipped, errors };
}
