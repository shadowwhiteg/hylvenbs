import { prisma } from "@/lib/db";
import { shopeeFetch } from "@/lib/shopee/client";

/**
 * A Shopee não tem um "desconto do vendedor" avulso por item como o PRICE_DISCOUNT
 * do ML — todo desconto vive dentro de um objeto Discount (com nome/janela própria)
 * que agrupa um ou mais itens. Pra manter uma UX parecida (aplicar/cancelar por
 * anúncio), cada aplicação cria um Discount de item único; cancelar encerra esse
 * Discount inteiro (add_discount/add_discount_item/end_discount).
 */
const DISCOUNT_WINDOW_DAYS = 7;

type AddDiscountResponse = { response?: { discount_id?: number }; error?: string; message?: string };

export async function createSingleItemDiscount(
  itemId: string,
  dealPrice: number,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; discountId?: number; error?: string }> {
  const now = Math.floor(Date.now() / 1000);
  const end = now + DISCOUNT_WINDOW_DAYS * 24 * 60 * 60;

  const addRes = await shopeeFetch<AddDiscountResponse>(
    "/api/v2/discount/add_discount",
    {
      method: "POST",
      body: JSON.stringify({
        discount_name: `Desconto ${itemId} ${new Date().toISOString().slice(0, 10)}`,
        start_time: now + 60,
        end_time: end,
      }),
    },
    fetchImpl
  );
  const discountId = addRes.data.response?.discount_id;
  if (!addRes.ok || !discountId) {
    return { ok: false, error: addRes.data.error || addRes.data.message || `HTTP ${addRes.status}` };
  }

  const itemRes = await shopeeFetch(
    "/api/v2/discount/add_discount_item",
    {
      method: "POST",
      body: JSON.stringify({
        discount_id: discountId,
        item_list: [{ item_id: Number(itemId), purchase_limit: 0, item_promotion_price: dealPrice }],
      }),
    },
    fetchImpl
  );
  if (!itemRes.ok) {
    return { ok: false, error: `HTTP ${itemRes.status}` };
  }

  return { ok: true, discountId };
}

export async function endDiscount(discountId: number, fetchImpl?: typeof fetch) {
  return shopeeFetch(
    "/api/v2/discount/end_discount",
    { method: "POST", body: JSON.stringify({ discount_id: discountId }) },
    fetchImpl
  );
}

export type ShopeePromotionsSyncDeps = {
  sleepFn?: (ms: number) => Promise<void>;
  delayMs?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type ShopeeBulkDiscountResult = { updated: number; errors: string[] };

export async function applyShopeeBulkDiscount(
  input: { ids: string[]; percent: number },
  deps: ShopeePromotionsSyncDeps = {}
): Promise<ShopeeBulkDiscountResult> {
  const delayMs = deps.delayMs ?? 200;
  const sleepFn = deps.sleepFn ?? sleep;
  let updated = 0;
  const errors: string[] = [];

  if (!(input.percent > 0 && input.percent < 100)) {
    return { updated: 0, errors: ["percent inválido (deve ser entre 0 e 100)"] };
  }

  for (const id of input.ids) {
    const listing = await prisma.shopeeListing.findUnique({ where: { id }, select: { price: true } });
    if (!listing || !(listing.price > 0)) {
      errors.push(`${id}: sem preço local para calcular o desconto`);
      continue;
    }
    const dealPrice = Math.round(listing.price * (1 - input.percent / 100) * 100) / 100;
    const result = await createSingleItemDiscount(id, dealPrice);
    if (!result.ok) {
      errors.push(`${id}: ${result.error}`);
      continue;
    }
    updated += 1;
    if (delayMs) await sleepFn(delayMs);
  }

  return { updated, errors };
}
