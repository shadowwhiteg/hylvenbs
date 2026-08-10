import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  productFindMany,
  stockSnapshotFindMany,
  stockSnapshotCreate,
  stockSnapshotUpdate,
  stockChangeLogCreate,
} = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  stockSnapshotFindMany: vi.fn(),
  stockSnapshotCreate: vi.fn(),
  stockSnapshotUpdate: vi.fn(),
  stockChangeLogCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findMany: productFindMany },
    stockSnapshot: {
      findMany: stockSnapshotFindMany,
      create: stockSnapshotCreate,
      update: stockSnapshotUpdate,
    },
    stockChangeLog: { create: stockChangeLogCreate },
  },
}));

import { runStockDiffCheck } from "@/lib/sync/stock-diff";

describe("runStockDiffCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds a snapshot on first run without logging a change", async () => {
    productFindMany.mockResolvedValue([
      { id: "p1", title: "Produto 1", stock: 10, sourceStock: 10 },
    ]);
    stockSnapshotFindMany.mockResolvedValue([]);

    const result = await runStockDiffCheck();

    expect(stockSnapshotCreate).toHaveBeenCalledWith({
      data: { productId: "p1", stock: 10, sourceStock: 10 },
    });
    expect(stockChangeLogCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, changed: 0, seeded: 1 });
  });

  it("logs a change when stock differs from the snapshot", async () => {
    productFindMany.mockResolvedValue([
      { id: "p1", title: "Produto 1", stock: 7, sourceStock: 7 },
    ]);
    stockSnapshotFindMany.mockResolvedValue([
      { productId: "p1", stock: 10, sourceStock: 10 },
    ]);

    const result = await runStockDiffCheck("manual");

    expect(stockChangeLogCreate).toHaveBeenCalledWith({
      data: {
        productId: "p1",
        productTitle: "Produto 1",
        previousStock: 10,
        newStock: 7,
        delta: -3,
        source: "manual",
      },
    });
    expect(stockSnapshotUpdate).toHaveBeenCalledWith({
      where: { productId: "p1" },
      data: { stock: 7, sourceStock: 7 },
    });
    expect(result).toEqual({ checked: 1, changed: 1, seeded: 0 });
  });

  it("does nothing when stock is unchanged", async () => {
    productFindMany.mockResolvedValue([
      { id: "p1", title: "Produto 1", stock: 5, sourceStock: 5 },
    ]);
    stockSnapshotFindMany.mockResolvedValue([
      { productId: "p1", stock: 5, sourceStock: 5 },
    ]);

    const result = await runStockDiffCheck();

    expect(stockChangeLogCreate).not.toHaveBeenCalled();
    expect(stockSnapshotUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, changed: 0, seeded: 0 });
  });
});
