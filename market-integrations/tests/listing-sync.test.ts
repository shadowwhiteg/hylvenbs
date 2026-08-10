import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mlSyncRunCreate,
  mlSyncRunUpdate,
  productFindMany,
  listingDraftUpdate,
  getAppSettingsMock,
} = vi.hoisted(() => ({
  mlSyncRunCreate: vi.fn(),
  mlSyncRunUpdate: vi.fn(),
  productFindMany: vi.fn(),
  listingDraftUpdate: vi.fn(),
  getAppSettingsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlSyncRun: {
      create: mlSyncRunCreate,
      update: mlSyncRunUpdate,
    },
    product: {
      findMany: productFindMany,
    },
    listingDraft: {
      update: listingDraftUpdate,
    },
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: getAppSettingsMock,
}));

import { runMlListingSync } from "@/lib/ml/listing-sync";

describe("runMlListingSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlSyncRunCreate.mockResolvedValue({ id: "run1", status: "running" });
    mlSyncRunUpdate.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: "run1",
      ...(data as object),
    }));
    listingDraftUpdate.mockResolvedValue({});
  });

  it("skips PUT when mode is manual", async () => {
    getAppSettingsMock.mockResolvedValue({
      marginPercent: 30,
      autoSyncMode: "manual",
      autoPauseWhenUnavailable: true,
    });
    const updateItemFn = vi.fn();
    const result = await runMlListingSync({ updateItemFn, delayMs: 0 });
    expect(updateItemFn).not.toHaveBeenCalled();
    expect(productFindMany).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
  });

  it("PUTs price and qty in always mode", async () => {
    getAppSettingsMock.mockResolvedValue({
      marginPercent: 30,
      autoSyncMode: "always",
      autoPauseWhenUnavailable: true,
    });
    productFindMany.mockResolvedValue([
      {
        id: "p1",
        status: "published",
        costPrice: 100,
        stock: 5,
        mlItemId: "MLB123",
        draft: {
          id: "d1",
          price: 150,
          listingTypeId: "gold_special",
          availableQuantity: 5,
          marginPercentOverride: null,
          userEditedJson: "{}",
        },
      },
    ]);

    const updateItemFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {},
      raw: "{}",
    });

    const result = await runMlListingSync({
      updateItemFn,
      delayMs: 0,
      sleepFn: async () => undefined,
    });

    expect(updateItemFn).toHaveBeenCalled();
    const [, payload] = updateItemFn.mock.calls[0];
    expect(payload.available_quantity).toBe(5);
    expect(payload.price).toBeGreaterThan(0);
    expect(result.updatedCount).toBe(1);
  });

  it("stock_only omits price", async () => {
    getAppSettingsMock.mockResolvedValue({
      marginPercent: 30,
      autoSyncMode: "stock_only",
      autoPauseWhenUnavailable: true,
    });
    productFindMany.mockResolvedValue([
      {
        id: "p1",
        status: "published",
        costPrice: 100,
        stock: 3,
        mlItemId: "MLB999",
        draft: {
          id: "d1",
          price: 200,
          listingTypeId: "gold_special",
          availableQuantity: 3,
          marginPercentOverride: null,
          userEditedJson: "{}",
        },
      },
    ]);

    const updateItemFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {},
      raw: "{}",
    });

    await runMlListingSync({ updateItemFn, delayMs: 0, sleepFn: async () => undefined });
    const [, payload] = updateItemFn.mock.calls[0];
    expect(payload.available_quantity).toBe(3);
    expect(payload.price).toBeUndefined();
  });

  it("retries on 429", async () => {
    getAppSettingsMock.mockResolvedValue({
      marginPercent: 30,
      autoSyncMode: "stock_only",
      autoPauseWhenUnavailable: false,
    });
    productFindMany.mockResolvedValue([
      {
        id: "p1",
        status: "published",
        costPrice: 50,
        stock: 2,
        mlItemId: "MLB429",
        draft: {
          id: "d1",
          price: 80,
          listingTypeId: "gold_special",
          availableQuantity: 2,
          marginPercentOverride: null,
          userEditedJson: "{}",
        },
      },
    ]);

    const updateItemFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, data: {}, raw: "rate" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {}, raw: "{}" });

    const result = await runMlListingSync({
      updateItemFn,
      delayMs: 0,
      sleepFn: async () => undefined,
      maxRetries: 2,
    });

    expect(updateItemFn).toHaveBeenCalledTimes(2);
    expect(result.updatedCount).toBe(1);
  });
});
