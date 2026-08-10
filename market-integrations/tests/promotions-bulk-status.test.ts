import { beforeEach, describe, expect, it, vi } from "vitest";

const { mlListingUpdate, updateItemMock } = vi.hoisted(() => ({
  mlListingUpdate: vi.fn(),
  updateItemMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlListing: { update: mlListingUpdate },
  },
}));

vi.mock("@/lib/ml/client", () => ({
  getItemPromotions: vi.fn(),
  applyItemPromotion: vi.fn(),
  cancelItemPromotion: vi.fn(),
  updateItem: updateItemMock,
  toMlPromotionStart: () => "2026-08-01T00:00:00",
  toMlPromotionFinish: () => "2026-08-14T23:59:59",
}));

import { applyBulkStatus } from "@/lib/ml/promotions-sync";

describe("applyBulkStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlListingUpdate.mockResolvedValue({});
  });

  it("pauses each id and mirrors the status locally", async () => {
    updateItemMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyBulkStatus({ ids: ["MLB1", "MLB2"], status: "paused" }, { delayMs: 0 });

    expect(updateItemMock).toHaveBeenNthCalledWith(1, "MLB1", { status: "paused" });
    expect(updateItemMock).toHaveBeenNthCalledWith(2, "MLB2", { status: "paused" });
    expect(mlListingUpdate).toHaveBeenCalledWith({
      where: { id: "MLB1" },
      data: { status: "paused" },
    });
    expect(result).toEqual({ updated: 2, errors: [] });
  });

  it("continues past a per-item failure and keeps processing the rest", async () => {
    updateItemMock
      .mockResolvedValueOnce({ ok: false, status: 500, data: {}, raw: "" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyBulkStatus(
      { ids: ["MLB1", "MLB2"], status: "active" },
      { delayMs: 0, maxRetries: 0 }
    );

    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("MLB1");
  });

  it("retries once on 429 then succeeds", async () => {
    updateItemMock
      .mockResolvedValueOnce({ ok: false, status: 429, data: {}, raw: "rate" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {}, raw: "" });

    const result = await applyBulkStatus(
      { ids: ["MLB1"], status: "paused" },
      { delayMs: 0, sleepFn: async () => undefined, maxRetries: 2 }
    );

    expect(updateItemMock).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(1);
  });
});
