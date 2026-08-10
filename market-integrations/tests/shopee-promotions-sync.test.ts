import { beforeEach, describe, expect, it, vi } from "vitest";

const { shopeeListingUpdate, productFindFirst, updatePriceMock, unlistItemMock } = vi.hoisted(() => ({
  shopeeListingUpdate: vi.fn(),
  productFindFirst: vi.fn(),
  updatePriceMock: vi.fn(),
  unlistItemMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    shopeeListing: { update: shopeeListingUpdate },
    product: { findFirst: productFindFirst },
  },
}));

vi.mock("@/lib/shopee/client", () => ({
  updatePrice: updatePriceMock,
  unlistItem: unlistItemMock,
}));

import { applyShopeeBulkPrice, applyShopeeBulkStatus } from "@/lib/shopee/promotions-sync";

describe("applyShopeeBulkPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shopeeListingUpdate.mockResolvedValue({});
  });

  it("applies a fixed price to each id", async () => {
    updatePriceMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyShopeeBulkPrice({ ids: ["1", "2"], price: 40 }, { delayMs: 0 });

    expect(updatePriceMock).toHaveBeenNthCalledWith(1, "1", 40);
    expect(updatePriceMock).toHaveBeenNthCalledWith(2, "2", 40);
    expect(shopeeListingUpdate).toHaveBeenCalledWith({ where: { id: "1" }, data: { price: 40 } });
    expect(result).toEqual({ updated: 2, errors: [] });
  });

  it("computes price from margin using local product cost", async () => {
    productFindFirst.mockResolvedValue({ costPrice: 10 });
    updatePriceMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyShopeeBulkPrice({ ids: ["1"], marginPercent: 50 }, { delayMs: 0 });

    expect(updatePriceMock).toHaveBeenCalledWith("1", expect.any(Number));
    expect(result.updated).toBe(1);
  });

  it("skips ids without local cost when using margin", async () => {
    productFindFirst.mockResolvedValue(null);

    const result = await applyShopeeBulkPrice({ ids: ["1"], marginPercent: 50 }, { delayMs: 0 });

    expect(result.updated).toBe(0);
    expect(result.errors[0]).toContain("1");
    expect(updatePriceMock).not.toHaveBeenCalled();
  });

  it("retries once on 429 then succeeds", async () => {
    updatePriceMock
      .mockResolvedValueOnce({ ok: false, status: 429, data: {}, raw: "" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyShopeeBulkPrice(
      { ids: ["1"], price: 10 },
      { delayMs: 0, sleepFn: async () => undefined, maxRetries: 2 }
    );

    expect(updatePriceMock).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(1);
  });
});

describe("applyShopeeBulkStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shopeeListingUpdate.mockResolvedValue({});
  });

  it("unlists each id when pausing and mirrors status locally", async () => {
    unlistItemMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyShopeeBulkStatus({ ids: ["1", "2"], status: "paused" }, { delayMs: 0 });

    expect(unlistItemMock).toHaveBeenNthCalledWith(1, "1", true);
    expect(unlistItemMock).toHaveBeenNthCalledWith(2, "2", true);
    expect(shopeeListingUpdate).toHaveBeenCalledWith({ where: { id: "1" }, data: { status: "UNLIST" } });
    expect(result).toEqual({ updated: 2, errors: [] });
  });

  it("relists (unlist:false) when reactivating", async () => {
    unlistItemMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "" });

    await applyShopeeBulkStatus({ ids: ["1"], status: "active" }, { delayMs: 0 });

    expect(unlistItemMock).toHaveBeenCalledWith("1", false);
    expect(shopeeListingUpdate).toHaveBeenCalledWith({ where: { id: "1" }, data: { status: "NORMAL" } });
  });

  it("continues past a per-item failure", async () => {
    unlistItemMock
      .mockResolvedValueOnce({ ok: false, status: 500, data: {}, raw: "" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyShopeeBulkStatus(
      { ids: ["1", "2"], status: "paused" },
      { delayMs: 0, maxRetries: 0 }
    );

    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
