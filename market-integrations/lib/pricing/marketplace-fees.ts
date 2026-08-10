/**
 * Tabelas de taxas por marketplace (fonte: Taxas.md) e o solver de preço que
 * desconta comissão + taxa fixa ANTES de aplicar a margem de lucro.
 *
 * O ponto delicado: comissão e taxa fixa dependem da faixa de preço, e o preço
 * depende delas. Por isso `solvePriceForMargin` testa cada faixa e só aceita o
 * candidato cujo preço realmente cai dentro da faixa que o gerou.
 *
 * Mantido separado de `simulator.ts` de propósito — aquele é usado por 12 fluxos
 * (sync de preço, kits, promoções) e mudar sua fórmula mexeria em todos.
 */

export type FeeTier = {
  /** Preço mínimo da faixa, inclusivo. */
  min: number;
  /** Preço máximo da faixa, inclusivo. `null` = sem teto. */
  max: number | null;
  /** Comissão percentual sobre o preço de venda (0.20 = 20%). */
  commissionRate: number;
  /** Taxa fixa por item, em reais. */
  fixedFee: number;
};

/** Shopee — vendedor CNPJ. */
export const SHOPEE_CNPJ_TIERS: FeeTier[] = [
  { min: 0, max: 79.99, commissionRate: 0.2, fixedFee: 4 },
  { min: 80, max: 99.99, commissionRate: 0.14, fixedFee: 16 },
  { min: 100, max: 199.99, commissionRate: 0.14, fixedFee: 20 },
  { min: 200, max: 499.99, commissionRate: 0.14, fixedFee: 26 },
  { min: 500, max: null, commissionRate: 0.14, fixedFee: 26 },
];

/**
 * Mercado Livre. A comissão varia por categoria (Clássico 10–14%, Premium
 * 15–19%); usamos o teto da faixa para não subestimar o custo. A taxa fixa por
 * unidade só existe abaixo de R$ 79.
 */
const ML_COMMISSION: Record<string, number> = {
  gold_special: 0.14,
  gold_pro: 0.19,
};

export const ML_FIXED_FEE_BANDS: { max: number | null; fixedFee: number }[] = [
  { max: 29, fixedFee: 6.25 },
  { max: 50, fixedFee: 6.5 },
  { max: 79, fixedFee: 6.75 },
  { max: null, fixedFee: 0 },
];

export function mlCommissionRate(listingTypeId: string): number {
  return ML_COMMISSION[listingTypeId] ?? ML_COMMISSION.gold_special;
}

export function mlTiers(listingTypeId: string): FeeTier[] {
  const commissionRate = mlCommissionRate(listingTypeId);
  let min = 0;
  return ML_FIXED_FEE_BANDS.map((band) => {
    const tier: FeeTier = {
      min,
      max: band.max,
      commissionRate,
      fixedFee: band.fixedFee,
    };
    if (band.max !== null) min = band.max + 0.01;
    return tier;
  });
}

export type Marketplace = "ml" | "shopee";

export function tiersFor(marketplace: Marketplace, listingTypeId = "gold_special"): FeeTier[] {
  return marketplace === "shopee" ? SHOPEE_CNPJ_TIERS : mlTiers(listingTypeId);
}

function tierAtPrice(tiers: FeeTier[], price: number): FeeTier {
  const hit = tiers.find((t) => price >= t.min && (t.max === null || price <= t.max));
  return hit ?? tiers[tiers.length - 1];
}

/** Comissão + taxa fixa que o marketplace cobra num preço de venda já definido. */
export function feesForPrice(
  price: number,
  marketplace: Marketplace,
  listingTypeId = "gold_special"
): { commissionRate: number; commission: number; fixedFee: number; total: number } {
  const tier = tierAtPrice(tiersFor(marketplace, listingTypeId), price);
  const commission = round2(price * tier.commissionRate);
  return {
    commissionRate: tier.commissionRate,
    commission,
    fixedFee: tier.fixedFee,
    total: round2(commission + tier.fixedFee),
  };
}

export type PriceSolution = {
  price: number;
  commissionRate: number;
  commission: number;
  fixedFee: number;
  shipping: number;
  cost: number;
  /** Lucro em reais depois de custo, frete, comissão e taxa fixa. */
  profit: number;
  /** Lucro real como % do preço — igual ao pedido, salvo quando houve clamp. */
  effectiveMarginPercent: number;
  /**
   * true quando nenhuma faixa fecha de forma consistente (o preço calculado cai
   * fora da própria faixa). Nesse caso usamos o piso da faixa seguinte, e a
   * margem efetiva fica ACIMA da pedida.
   */
  clamped: boolean;
};

/**
 * Preço que entrega `marginPercent` de lucro líquido sobre o preço de venda,
 * já descontadas comissão, taxa fixa e frete.
 *
 * preço = (custo + frete + taxaFixa) / (1 − comissão − margem)
 */
export function solvePriceForMargin(input: {
  cost: number;
  marginPercent: number;
  marketplace: Marketplace;
  listingTypeId?: string;
  shipping?: number;
}): PriceSolution {
  const cost = Number(input.cost);
  const shipping = Number(input.shipping ?? 0);
  const marginPercent = Number(input.marginPercent);

  if (!(cost > 0)) throw new Error("custo deve ser maior que zero");
  if (shipping < 0) throw new Error("frete não pode ser negativo");
  if (!Number.isFinite(marginPercent) || marginPercent < 0) {
    throw new Error("margem deve ser >= 0");
  }

  const tiers = tiersFor(input.marketplace, input.listingTypeId);
  const marginRate = marginPercent / 100;

  const candidates: { tier: FeeTier; price: number; fits: boolean }[] = [];
  for (const tier of tiers) {
    const denominator = 1 - tier.commissionRate - marginRate;
    if (denominator <= 0) continue;
    const price = ceil2((cost + shipping + tier.fixedFee) / denominator);
    const fits = price >= tier.min && (tier.max === null || price <= tier.max);
    candidates.push({ tier, price, fits });
  }

  if (!candidates.length) {
    throw new Error(
      `margem de ${marginPercent}% é inviável: comissão + margem alcançam 100% do preço`
    );
  }

  const fitting = candidates.filter((c) => c.fits).sort((a, b) => a.price - b.price);
  let chosen = fitting[0];
  let clamped = false;

  if (!chosen) {
    // Sem faixa consistente: o preço "salta" a faixa. Usamos o piso da faixa
    // cujo cálculo ficou abaixo dela — é o menor preço que ainda cobre a margem.
    const above = candidates
      .filter((c) => c.price < c.tier.min)
      .sort((a, b) => a.tier.min - b.tier.min)[0];
    if (above) {
      chosen = { ...above, price: above.tier.min };
    } else {
      chosen = candidates.sort((a, b) => a.price - b.price)[0];
    }
    clamped = true;
  }

  const price = chosen.price;
  const commission = round2(price * chosen.tier.commissionRate);
  const profit = round2(price - cost - shipping - commission - chosen.tier.fixedFee);

  return {
    price,
    commissionRate: chosen.tier.commissionRate,
    commission,
    fixedFee: chosen.tier.fixedFee,
    shipping: round2(shipping),
    cost: round2(cost),
    profit,
    effectiveMarginPercent: price > 0 ? round2((profit / price) * 100) : 0,
    clamped,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Arredonda para cima: nunca ficar abaixo da margem pedida por centavo de arredondamento. */
function ceil2(n: number): number {
  return Math.ceil(n * 100) / 100;
}
