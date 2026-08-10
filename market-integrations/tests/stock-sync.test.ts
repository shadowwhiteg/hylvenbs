import { beforeEach, describe, expect, it, vi } from "vitest";

const { mlListingFindMany, mlListingUpdate, productFindMany } = vi.hoisted(() => ({
  mlListingFindMany: vi.fn(),
  mlListingUpdate: vi.fn(),
  productFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlListing: { findMany: mlListingFindMany, update: mlListingUpdate },
    product: { findMany: productFindMany },
  },
}));

import { syncListingStockFromCatalog } from "@/lib/ml/stock-sync";

describe("syncListingStockFromCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlListingUpdate.mockResolvedValue({});
  });

  it("updates quantity when the Meu Drop stock differs from the ML listing", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB1", availableQuantity: 5, status: "active" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", stock: 12 }]);
    const updateItemFn = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {}, raw: "{}" });

    const result = await syncListingStockFromCatalog(undefined, { updateItemFn, delayMs: 0 });

    expect(updateItemFn).toHaveBeenCalledWith("MLB1", { available_quantity: 12 });
    expect(mlListingUpdate).toHaveBeenCalledWith({
      where: { id: "MLB1" },
      data: { availableQuantity: 12, status: "active" },
    });
    expect(result).toEqual({ updated: 1, paused: 0, skipped: 0, errors: [] });
  });

  it("zeroes quantity and pauses an active listing when Meu Drop stock is 0", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB1", availableQuantity: 8, status: "active" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", stock: 0 }]);
    const updateItemFn = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {}, raw: "{}" });

    const result = await syncListingStockFromCatalog(undefined, { updateItemFn, delayMs: 0 });

    expect(updateItemFn).toHaveBeenCalledWith("MLB1", { available_quantity: 0, status: "paused" });
    expect(result.paused).toBe(1);
  });

  it("treats a null Meu Drop stock as 0 and pauses the listing", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB1", availableQuantity: 3, status: "active" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", stock: null }]);
    const updateItemFn = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {}, raw: "{}" });

    await syncListingStockFromCatalog(undefined, { updateItemFn, delayMs: 0 });

    expect(updateItemFn).toHaveBeenCalledWith("MLB1", { available_quantity: 0, status: "paused" });
  });

  it("never re-activates a listing that's already paused, even with stock back", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB1", availableQuantity: 0, status: "paused" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", stock: 10 }]);
    const updateItemFn = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {}, raw: "{}" });

    await syncListingStockFromCatalog(undefined, { updateItemFn, delayMs: 0 });

    // Só a quantidade muda; status não é tocado (pode ter sido pausado por outro motivo).
    expect(updateItemFn).toHaveBeenCalledWith("MLB1", { available_quantity: 10 });
  });

  it("skips avulso listings that have no linked Meu Drop product", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB_AVULSO", availableQuantity: 5, status: "active" }]);
    productFindMany.mockResolvedValue([]);
    const updateItemFn = vi.fn();

    const result = await syncListingStockFromCatalog(undefined, { updateItemFn, delayMs: 0 });

    expect(updateItemFn).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("skips when nothing changed", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB1", availableQuantity: 7, status: "active" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", stock: 7 }]);
    const updateItemFn = vi.fn();

    const result = await syncListingStockFromCatalog(undefined, { updateItemFn, delayMs: 0 });

    expect(updateItemFn).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("restricts the sync to the given ids", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB1", availableQuantity: 1, status: "active" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", stock: 5 }]);
    const updateItemFn = vi.fn().mockResolvedValue({ ok: true, status: 200, data: {}, raw: "{}" });

    await syncListingStockFromCatalog(["MLB1"], { updateItemFn, delayMs: 0 });

    expect(mlListingFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["MLB1"] } },
      select: { id: true, availableQuantity: true, status: true },
    });
  });

  it("retries once on 429 then succeeds", async () => {
    mlListingFindMany.mockResolvedValue([{ id: "MLB1", availableQuantity: 1, status: "active" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", stock: 5 }]);
    const updateItemFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, data: {}, raw: "rate" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {}, raw: "{}" });

    const result = await syncListingStockFromCatalog(undefined, {
      updateItemFn,
      delayMs: 0,
      sleepFn: async () => undefined,
      maxRetries: 2,
    });

    expect(updateItemFn).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(1);
  });

  it("collects per-item errors without stopping the batch", async () => {
    mlListingFindMany.mockResolvedValue([
      { id: "MLB1", availableQuantity: 1, status: "active" },
      { id: "MLB2", availableQuantity: 1, status: "active" },
    ]);
    productFindMany.mockResolvedValue([
      { mlItemId: "MLB1", stock: 9 },
      { mlItemId: "MLB2", stock: 9 },
    ]);
    const updateItemFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, data: {}, raw: "boom" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {}, raw: "{}" });

    const result = await syncListingStockFromCatalog(undefined, { updateItemFn, delayMs: 0 });

    expect(result.updated).toBe(1);
    expect(result.errors).toEqual(["MLB1: HTTP 500"]);
  });
});
