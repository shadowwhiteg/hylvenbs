import { describe, expect, it } from "vitest";
import {
  SHOPEE_CNPJ_TIERS,
  feesForPrice,
  mlCommissionRate,
  mlTiers,
  solvePriceForMargin,
} from "@/lib/pricing/marketplace-fees";

describe("Tabela de taxas Shopee (CNPJ)", () => {
  it("cobre as faixas do Taxas.md sem lacuna", () => {
    expect(SHOPEE_CNPJ_TIERS[0]).toMatchObject({ max: 79.99, commissionRate: 0.2, fixedFee: 4 });
    expect(SHOPEE_CNPJ_TIERS[1]).toMatchObject({ min: 80, max: 99.99, fixedFee: 16 });
    expect(SHOPEE_CNPJ_TIERS[2]).toMatchObject({ min: 100, max: 199.99, fixedFee: 20 });
    expect(SHOPEE_CNPJ_TIERS[3]).toMatchObject({ min: 200, max: 499.99, fixedFee: 26 });
    expect(SHOPEE_CNPJ_TIERS[4]).toMatchObject({ min: 500, max: null, fixedFee: 26 });
    for (const tier of SHOPEE_CNPJ_TIERS) {
      expect(tier.commissionRate).toBeGreaterThan(0);
    }
  });

  it("aplica comissão e taxa fixa da faixa do preço", () => {
    expect(feesForPrice(50, "shopee")).toMatchObject({ commission: 10, fixedFee: 4, total: 14 });
    expect(feesForPrice(90, "shopee")).toMatchObject({ commission: 12.6, fixedFee: 16 });
    expect(feesForPrice(150, "shopee")).toMatchObject({ commission: 21, fixedFee: 20 });
    expect(feesForPrice(300, "shopee")).toMatchObject({ commission: 42, fixedFee: 26 });
    expect(feesForPrice(900, "shopee")).toMatchObject({ commission: 126, fixedFee: 26 });
  });
});

describe("Tabela de taxas ML", () => {
  it("usa o teto da comissão por tipo de anúncio", () => {
    expect(mlCommissionRate("gold_special")).toBe(0.14);
    expect(mlCommissionRate("gold_pro")).toBe(0.19);
    expect(mlCommissionRate("desconhecido")).toBe(0.14);
  });

  it("cobra taxa fixa só abaixo de R$ 79", () => {
    expect(feesForPrice(25, "ml").fixedFee).toBe(6.25);
    expect(feesForPrice(40, "ml").fixedFee).toBe(6.5);
    expect(feesForPrice(70, "ml").fixedFee).toBe(6.75);
    expect(feesForPrice(120, "ml").fixedFee).toBe(0);
  });

  it("monta faixas contíguas", () => {
    const tiers = mlTiers("gold_special");
    expect(tiers.map((t) => [t.min, t.max])).toEqual([
      [0, 29],
      [29.01, 50],
      [50.01, 79],
      [79.01, null],
    ]);
  });
});

describe("solvePriceForMargin", () => {
  it("entrega a margem pedida sobre o preço de venda (Shopee, faixa 1)", () => {
    const r = solvePriceForMargin({ cost: 10, marginPercent: 5, marketplace: "shopee" });
    // (10 + 4) / (1 - 0.20 - 0.05) = 18.67
    expect(r.price).toBeCloseTo(18.67, 2);
    expect(r.fixedFee).toBe(4);
    expect(r.commissionRate).toBe(0.2);
    expect(r.effectiveMarginPercent).toBeGreaterThanOrEqual(5);
    expect(r.clamped).toBe(false);
  });

  it("escolhe a faixa consistente quando o preço sobe de faixa", () => {
    // Na faixa 1 daria 85.33 (fora dela). A solução real está na faixa 80–99.99.
    const r = solvePriceForMargin({ cost: 60, marginPercent: 5, marketplace: "shopee" });
    expect(r.price).toBeGreaterThanOrEqual(80);
    expect(r.price).toBeLessThanOrEqual(99.99);
    expect(r.fixedFee).toBe(16);
    expect(r.commissionRate).toBe(0.14);
    expect(r.clamped).toBe(false);
  });

  // Tolerância de 1 centavo: preço e comissão são arredondados para centavos, e
  // a comissão pode arredondar para cima (ex.: custo 40 premium → 11,6869 vira
  // 11,69), consumindo meio centavo do lucro.
  const ONE_CENT = 0.01;

  it("nunca fica abaixo da margem pedida em nenhuma faixa", () => {
    for (const cost of [5, 12, 30, 55, 60, 70, 90, 120, 180, 250, 400, 600, 1200]) {
      const r = solvePriceForMargin({ cost, marginPercent: 5, marketplace: "shopee" });
      const recomputed = feesForPrice(r.price, "shopee");
      const profit = r.price - cost - recomputed.total;
      expect(profit).toBeGreaterThan(0);
      expect(profit).toBeGreaterThanOrEqual(r.price * 0.05 - ONE_CENT);
      // a faixa cobrada de fato tem que ser a que o solver usou
      expect(recomputed.fixedFee).toBe(r.fixedFee);
      expect(recomputed.commissionRate).toBe(r.commissionRate);
    }
  });

  it("mantém a coerência de faixa no ML também", () => {
    for (const cost of [5, 20, 40, 60, 80, 150, 400]) {
      for (const listingTypeId of ["gold_special", "gold_pro"]) {
        const r = solvePriceForMargin({
          cost,
          marginPercent: 5,
          marketplace: "ml",
          listingTypeId,
        });
        const recomputed = feesForPrice(r.price, "ml", listingTypeId);
        expect(recomputed.fixedFee).toBe(r.fixedFee);
        const profit = r.price - cost - recomputed.total;
        expect(profit).toBeGreaterThanOrEqual(r.price * 0.05 - ONE_CENT);
      }
    }
  });

  it("considera o frete como custo antes da margem", () => {
    const sem = solvePriceForMargin({ cost: 50, marginPercent: 5, marketplace: "shopee" });
    const com = solvePriceForMargin({
      cost: 50,
      marginPercent: 5,
      marketplace: "shopee",
      shipping: 20,
    });
    expect(com.price).toBeGreaterThan(sem.price);
    expect(com.shipping).toBe(20);
  });

  it("rejeita margem inviável e custo inválido", () => {
    expect(() =>
      solvePriceForMargin({ cost: 10, marginPercent: 95, marketplace: "shopee" })
    ).toThrow(/inviável/);
    expect(() => solvePriceForMargin({ cost: 0, marginPercent: 5, marketplace: "shopee" })).toThrow(
      /custo/
    );
  });

  it("margem 0 cobre exatamente custo + taxas", () => {
    const r = solvePriceForMargin({ cost: 100, marginPercent: 0, marketplace: "shopee" });
    const fees = feesForPrice(r.price, "shopee");
    expect(r.price - 100 - fees.total).toBeGreaterThanOrEqual(-ONE_CENT);
    expect(r.price - 100 - fees.total).toBeLessThan(0.05);
  });
});
