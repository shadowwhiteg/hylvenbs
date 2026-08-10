import { beforeEach, describe, expect, it, vi } from "vitest";
import { simulateCosts } from "@/lib/pricing/simulator";

const { productFindFirst, kitFindFirst, mlListingUpdate, updateItemMock } = vi.hoisted(() => ({
  productFindFirst: vi.fn(),
  kitFindFirst: vi.fn(),
  mlListingUpdate: vi.fn(),
  updateItemMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findFirst: productFindFirst },
    kit: { findFirst: kitFindFirst },
    mlListing: { update: mlListingUpdate },
  },
}));

vi.mock("@/lib/ml/client", () => ({
  updateItem: updateItemMock,
  getItemPromotions: vi.fn(),
  applyItemPromotion: vi.fn(),
  cancelItemPromotion: vi.fn(),
  toMlPromotionStart: () => "2026-08-01T00:00:00",
  toMlPromotionFinish: () => "2026-08-14T23:59:59",
}));

import { applyBulkPrice } from "@/lib/ml/promotions-sync";

describe("applyBulkPrice margin correction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlListingUpdate.mockResolvedValue({});
    updateItemMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "" });
    kitFindFirst.mockResolvedValue(null);
  });

  it("sends simulator suggestedPrice for the given margin % over cost", async () => {
    const costPrice = 100;
    const marginPercent = 30;
    const listingTypeId = "gold_special";
    const expected = simulateCosts({ costPrice, listingTypeId, marginPercent }).suggestedPrice;

    productFindFirst.mockResolvedValue({
      costPrice,
      draft: { listingTypeId },
    });

    const result = await applyBulkPrice(
      { ids: ["MLB123"], marginPercent },
      { delayMs: 0 }
    );

    expect(result).toEqual({ updated: 1, errors: [] });
    expect(updateItemMock).toHaveBeenCalledWith("MLB123", { price: expected });
    expect(mlListingUpdate).toHaveBeenCalledWith({
      where: { id: "MLB123" },
      data: { price: expected },
    });
    // Sanity: 30% margem + 11% taxa ≠ markup linear sobre o custo.
    expect(expected).toBeGreaterThan(costPrice * 1.3);
    expect(expected).toBe(169.49);
  });

  it("falls back to kit cost when product has no cost", async () => {
    productFindFirst.mockResolvedValue({ costPrice: 0, draft: null });
    kitFindFirst.mockResolvedValue({
      costPrice: 80,
      draft: { listingTypeId: "gold_special" },
    });
    const expected = simulateCosts({
      costPrice: 80,
      listingTypeId: "gold_special",
      marginPercent: 20,
    }).suggestedPrice;

    const result = await applyBulkPrice({ ids: ["MLB-KIT"], marginPercent: 20 }, { delayMs: 0 });

    expect(result.updated).toBe(1);
    expect(updateItemMock).toHaveBeenCalledWith("MLB-KIT", { price: expected });
  });

  it("errors when neither product nor kit has cost", async () => {
    productFindFirst.mockResolvedValue(null);
    kitFindFirst.mockResolvedValue(null);

    const result = await applyBulkPrice({ ids: ["MLB-X"], marginPercent: 25 }, { delayMs: 0 });

    expect(result.updated).toBe(0);
    expect(result.errors[0]).toMatch(/sem produto\/custo local/);
    expect(updateItemMock).not.toHaveBeenCalled();
  });
});
