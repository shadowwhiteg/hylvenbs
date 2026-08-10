import { prisma } from "@/lib/db";
import {
  applyItemPromotion,
  cancelItemPromotion,
  getItemPromotions,
  toMlPromotionFinish,
  toMlPromotionStart,
  updateItem,
} from "@/lib/ml/client";

/** PRICE_DISCOUNT exige uma janela de vigência; 14 dias é o máximo permitido pelo ML. */
const MAX_PRICE_DISCOUNT_DAYS = 14;

export type PromotionsSyncDeps = {
  updateItemFn?: typeof updateItem;
  sleepFn?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxRetries?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Mesmo padrão de retry em 429 usado em lib/ml/listing-sync.ts, aplicado a preço direto. */
async function putPriceWithBackoff(
  itemId: string,
  price: number,
  deps: PromotionsSyncDeps
) {
  const updateFn = deps.updateItemFn ?? updateItem;
  const maxRetries = deps.maxRetries ?? 3;
  const sleepFn = deps.sleepFn ?? sleep;

  let last: Awaited<ReturnType<typeof updateItem>> | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await updateFn(itemId, { price });
    if (last.ok) return last;
    if (last.status === 429 && attempt < maxRetries) {
      await sleepFn(500 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  return last!;
}

export type BulkPriceResult = {
  updated: number;
  errors: string[];
};

export async function applyBulkPrice(
  input: { ids: string[]; price?: number; marginPercent?: number },
  deps: PromotionsSyncDeps = {}
): Promise<BulkPriceResult> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;
  let updated = 0;
  const errors: string[] = [];

  for (const id of input.ids) {
    let price = input.price;
    if (price == null && input.marginPercent != null) {
      const product = await prisma.product.findFirst({
        where: { mlItemId: id },
        select: { costPrice: true, draft: { select: { listingTypeId: true } } },
      });
      const kit =
        product && product.costPrice > 0
          ? null
          : await prisma.kit.findFirst({
              where: { mlItemId: id },
              select: { costPrice: true, draft: { select: { listingTypeId: true } } },
            });
      const source = product && product.costPrice > 0 ? product : kit;
      if (!source || !(source.costPrice > 0)) {
        errors.push(`${id}: sem produto/custo local para calcular margem`);
        continue;
      }
      const { simulateCosts } = await import("@/lib/pricing/simulator");
      price = simulateCosts({
        costPrice: source.costPrice,
        listingTypeId: source.draft?.listingTypeId || "gold_special",
        marginPercent: input.marginPercent,
      }).suggestedPrice;
    }
    if (price == null || !(price > 0)) {
      errors.push(`${id}: preço inválido`);
      continue;
    }

    const res = await putPriceWithBackoff(id, price, deps);
    if (!res.ok) {
      const detail =
        res.data && typeof res.data === "object" && "message" in res.data
          ? String((res.data as { message?: unknown }).message || "")
          : "";
      const cause =
        res.data &&
        typeof res.data === "object" &&
        "cause" in res.data &&
        Array.isArray((res.data as { cause?: unknown }).cause)
          ? (
              (res.data as { cause: Array<{ code?: string; message?: string }> }).cause
                .map((c) => c.code || c.message)
                .filter(Boolean)
                .slice(0, 2)
                .join(", ")
            )
          : "";
      errors.push(
        `${id}: HTTP ${res.status}` +
          (detail ? ` — ${detail}` : "") +
          (cause ? ` (${cause})` : "")
      );
      continue;
    }
    await prisma.mlListing.update({ where: { id }, data: { price } }).catch(() => undefined);
    updated += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, errors };
}

export type BulkStatusResult = {
  updated: number;
  errors: string[];
};

/** Mesmo padrão de retry em 429 usado pra preço, aplicado à troca de status (pausar/ativar). */
async function putStatusWithBackoff(
  itemId: string,
  status: "active" | "paused",
  deps: PromotionsSyncDeps
) {
  const updateFn = deps.updateItemFn ?? updateItem;
  const maxRetries = deps.maxRetries ?? 3;
  const sleepFn = deps.sleepFn ?? sleep;

  let last: Awaited<ReturnType<typeof updateItem>> | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await updateFn(itemId, { status });
    if (last.ok) return last;
    if (last.status === 429 && attempt < maxRetries) {
      await sleepFn(500 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  return last!;
}

export async function applyBulkStatus(
  input: { ids: string[]; status: "active" | "paused" },
  deps: PromotionsSyncDeps = {}
): Promise<BulkStatusResult> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;
  let updated = 0;
  const errors: string[] = [];

  for (const id of input.ids) {
    const res = await putStatusWithBackoff(id, input.status, deps);
    if (!res.ok) {
      errors.push(`${id}: HTTP ${res.status}`);
      continue;
    }
    await prisma.mlListing
      .update({ where: { id }, data: { status: input.status } })
      .catch(() => undefined);
    updated += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, errors };
}

export async function listItemPromotions(itemId: string) {
  const res = await getItemPromotions(itemId);
  if (!res.ok) {
    return { ok: false as const, error: `HTTP ${res.status}`, promotions: [] };
  }
  return { ok: true as const, promotions: Array.isArray(res.data) ? res.data : [] };
}

export async function applyPromotion(
  itemId: string,
  input: {
    promotionId?: string;
    promotionType: string;
    dealPrice?: number;
    finishDate?: Date;
  }
) {
  const isPriceDiscount = input.promotionType === "PRICE_DISCOUNT";
  const start = isPriceDiscount ? new Date() : undefined;
  // Início e fim contam só a data (ML zera pra 00:00:00/23:59:59), então
  // start + (max-1) dias já cobre a janela cheia de MAX_PRICE_DISCOUNT_DAYS.
  const finish = isPriceDiscount
    ? (input.finishDate ??
      new Date(Date.now() + (MAX_PRICE_DISCOUNT_DAYS - 1) * 24 * 60 * 60 * 1000))
    : undefined;

  const res = await applyItemPromotion(itemId, {
    promotion_id: input.promotionId,
    promotion_type: input.promotionType,
    deal_price: input.dealPrice,
    start_date: start ? toMlPromotionStart(start) : undefined,
    finish_date: finish ? toMlPromotionFinish(finish) : undefined,
  });
  return { ok: res.ok, status: res.status, data: res.data };
}

export async function cancelPromotion(
  itemId: string,
  promotionId: string | undefined,
  promotionType: string
) {
  const res = await cancelItemPromotion(itemId, promotionId, promotionType);
  return { ok: res.ok, status: res.status, data: res.data };
}

async function applyPromotionWithBackoff(
  itemId: string,
  input: { promotionType: string; dealPrice: number },
  deps: PromotionsSyncDeps
) {
  const maxRetries = deps.maxRetries ?? 3;
  const sleepFn = deps.sleepFn ?? sleep;

  let last: Awaited<ReturnType<typeof applyPromotion>> | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await applyPromotion(itemId, input);
    if (last.ok) return last;
    if (last.status === 429 && attempt < maxRetries) {
      await sleepFn(500 * Math.pow(2, attempt));
      continue;
    }
    break;
  }
  return last!;
}

export type BulkDiscountResult = {
  updated: number;
  errors: string[];
};

/**
 * Aplica desconto PRICE_DISCOUNT em massa com uma % escolhida pelo usuário.
 * Cada item tem original_price/min/max diferentes, então busca a promoção
 * candidata de cada um antes de calcular o deal_price — não dá pra assumir
 * um preço fixo comum como no bulk de preço direto.
 */
export async function applyBulkDiscount(
  input: { ids: string[]; percent: number },
  deps: PromotionsSyncDeps = {}
): Promise<BulkDiscountResult> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;
  let updated = 0;
  const errors: string[] = [];

  if (!(input.percent > 0 && input.percent < 100)) {
    return { updated: 0, errors: ["percent inválido (deve ser entre 0 e 100)"] };
  }

  for (const id of input.ids) {
    const list = await listItemPromotions(id);
    if (!list.ok) {
      errors.push(`${id}: falha ao consultar promoções (${list.error})`);
      continue;
    }
    const candidate = list.promotions.find(
      (p) => p.type === "PRICE_DISCOUNT" && p.status === "candidate"
    );
    if (!candidate || !candidate.original_price) {
      errors.push(`${id}: sem desconto PRICE_DISCOUNT disponível para este anúncio`);
      continue;
    }

    const dealPrice = Math.round(candidate.original_price * (1 - input.percent / 100) * 100) / 100;
    const min = candidate.min_discounted_price;
    const max = candidate.max_discounted_price;
    if ((min != null && dealPrice < min) || (max != null && dealPrice > max)) {
      errors.push(
        `${id}: ${input.percent}% (R$ ${dealPrice.toFixed(2)}) fora do intervalo permitido (R$ ${min?.toFixed(2)} a R$ ${max?.toFixed(2)})`
      );
      continue;
    }

    const res = await applyPromotionWithBackoff(
      id,
      { promotionType: "PRICE_DISCOUNT", dealPrice },
      deps
    );
    if (!res.ok) {
      errors.push(`${id}: HTTP ${res.status}`);
      continue;
    }
    await prisma.mlListing.update({ where: { id }, data: { price: dealPrice } }).catch(() => undefined);
    updated += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, errors };
}
