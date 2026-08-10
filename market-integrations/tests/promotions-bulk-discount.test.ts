import { beforeEach, describe, expect, it, vi } from "vitest";

const { mlListingUpdate, getItemPromotionsMock, applyItemPromotionMock } = vi.hoisted(() => ({
  mlListingUpdate: vi.fn(),
  getItemPromotionsMock: vi.fn(),
  applyItemPromotionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlListing: { update: mlListingUpdate },
  },
}));

vi.mock("@/lib/ml/client", () => ({
  getItemPromotions: getItemPromotionsMock,
  applyItemPromotion: applyItemPromotionMock,
  cancelItemPromotion: vi.fn(),
  updateItem: vi.fn(),
  toMlPromotionStart: () => "2026-08-01T00:00:00",
  toMlPromotionFinish: () => "2026-08-14T23:59:59",
}));

import { applyBulkDiscount } from "@/lib/ml/promotions-sync";

function candidatePromo(overrides: Record<string, unknown> = {}) {
  return {
    type: "PRICE_DISCOUNT",
    status: "candidate",
    price: 0,
    original_price: 100,
    min_discounted_price: 50,
    max_discounted_price: 95,
    suggested_discounted_price: 90,
    ...overrides,
  };
}

describe("applyBulkDiscount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlListingUpdate.mockResolvedValue({});
  });

  it("rejects an invalid percent up front without calling the API", async () => {
    const result = await applyBulkDiscount({ ids: ["MLB1"], percent: 0 });
    expect(result).toEqual({ updated: 0, errors: ["percent inválido (deve ser entre 0 e 100)"] });
    expect(getItemPromotionsMock).not.toHaveBeenCalled();
  });

  it("applies the computed deal_price when within range", async () => {
    getItemPromotionsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: [candidatePromo()],
    });
    applyItemPromotionMock.mockResolvedValue({ ok: true, status: 201, data: {}, raw: "" });

    const result = await applyBulkDiscount(
      { ids: ["MLB1"], percent: 10 },
      { delayMs: 0 }
    );

    expect(applyItemPromotionMock).toHaveBeenCalledWith(
      "MLB1",
      expect.objectContaining({ promotion_type: "PRICE_DISCOUNT", deal_price: 90 })
    );
    expect(mlListingUpdate).toHaveBeenCalledWith({ where: { id: "MLB1" }, data: { price: 90 } });
    expect(result).toEqual({ updated: 1, errors: [] });
  });

  it("skips an item without a PRICE_DISCOUNT candidate", async () => {
    getItemPromotionsMock.mockResolvedValue({ ok: true, status: 200, raw: "", data: [] });

    const result = await applyBulkDiscount({ ids: ["MLB2"], percent: 10 }, { delayMs: 0 });

    expect(applyItemPromotionMock).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.errors[0]).toContain("sem desconto PRICE_DISCOUNT disponível");
  });

  it("skips an item when the requested % falls outside min/max", async () => {
    getItemPromotionsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: [candidatePromo({ min_discounted_price: 80, max_discounted_price: 95 })],
    });

    // 50% off => deal_price 50, below min_discounted_price 80.
    const result = await applyBulkDiscount({ ids: ["MLB3"], percent: 50 }, { delayMs: 0 });

    expect(applyItemPromotionMock).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.errors[0]).toContain("fora do intervalo permitido");
  });

  it("continues past a per-item failure and keeps processing the rest", async () => {
    getItemPromotionsMock
      .mockResolvedValueOnce({ ok: false, status: 500, raw: "", data: [] })
      .mockResolvedValueOnce({ ok: true, status: 200, raw: "", data: [candidatePromo()] });
    applyItemPromotionMock.mockResolvedValue({ ok: true, status: 201, data: {}, raw: "" });

    const result = await applyBulkDiscount(
      { ids: ["MLB4", "MLB5"], percent: 10 },
      { delayMs: 0 }
    );

    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("MLB4");
  });

  it("retries once on 429 then succeeds", async () => {
    getItemPromotionsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: [candidatePromo()],
    });
    applyItemPromotionMock
      .mockResolvedValueOnce({ ok: false, status: 429, data: {}, raw: "rate" })
      .mockResolvedValueOnce({ ok: true, status: 201, data: {}, raw: "" });

    const result = await applyBulkDiscount(
      { ids: ["MLB6"], percent: 10 },
      { delayMs: 0, sleepFn: async () => undefined, maxRetries: 2 }
    );

    expect(applyItemPromotionMock).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(1);
  });
});
