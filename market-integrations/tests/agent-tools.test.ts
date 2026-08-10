import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  productFindMany,
  listingDraftUpdate,
  syncRunFindFirst,
  mlSyncRunFindFirst,
  getAppSettingsMock,
  updateAppSettingsMock,
  getAuthStatusMock,
  runCatalogSyncMock,
  runMlListingSyncMock,
  enqueuePublishMock,
  simulateCostsMock,
} = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  listingDraftUpdate: vi.fn(),
  syncRunFindFirst: vi.fn(),
  mlSyncRunFindFirst: vi.fn(),
  getAppSettingsMock: vi.fn(),
  updateAppSettingsMock: vi.fn(),
  getAuthStatusMock: vi.fn(),
  runCatalogSyncMock: vi.fn(),
  runMlListingSyncMock: vi.fn(),
  enqueuePublishMock: vi.fn(),
  simulateCostsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findMany: productFindMany },
    listingDraft: { update: listingDraftUpdate },
    syncRun: { findFirst: syncRunFindFirst },
    mlSyncRun: { findFirst: mlSyncRunFindFirst },
    shopeeToken: { findUnique: vi.fn().mockResolvedValue(null) },
    shopeeSyncRun: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: getAppSettingsMock,
  updateAppSettings: updateAppSettingsMock,
}));

vi.mock("@/lib/ml/auth", () => ({
  getAuthStatus: getAuthStatusMock,
}));

vi.mock("@/lib/sync/run", () => ({
  runCatalogSync: runCatalogSyncMock,
}));

vi.mock("@/lib/ml/listing-sync", () => ({
  runMlListingSync: runMlListingSyncMock,
}));

vi.mock("@/lib/publish/worker", () => ({
  enqueuePublish: enqueuePublishMock,
}));

vi.mock("@/lib/pricing/simulator", () => ({
  simulateCosts: simulateCostsMock,
}));

import { executeAgentTool } from "@/lib/agent/tools";

describe("executeAgentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sync_catalog delegates", async () => {
    runCatalogSyncMock.mockResolvedValue({ id: "s1", status: "success" });
    const r = await executeAgentTool("sync_catalog", { skipMlSync: true });
    expect(r.ok).toBe(true);
    expect(runCatalogSyncMock).toHaveBeenCalledWith({ skipMlSync: true });
  });

  it("list_products maps fields", async () => {
    productFindMany.mockResolvedValue([
      {
        id: "p1",
        title: "Fone",
        status: "published",
        costPrice: 10,
        stock: 2,
        mlItemId: "MLB1",
        draft: { price: 20 },
      },
    ]);
    const r = await executeAgentTool("list_products", { limit: 10 });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([
      {
        id: "p1",
        title: "Fone",
        status: "published",
        costPrice: 10,
        stock: 2,
        draftPrice: 20,
        mlItemId: "MLB1",
      },
    ]);
  });

  it("apply_margin recalculates and updates draft", async () => {
    productFindMany.mockResolvedValue([
      {
        id: "p1",
        costPrice: 100,
        draft: {
          id: "d1",
          listingTypeId: "gold_special",
          userEditedJson: "{}",
          marginPercentOverride: null,
        },
      },
    ]);
    simulateCostsMock.mockReturnValue({ suggestedPrice: 168.54 });
    listingDraftUpdate.mockResolvedValue({});

    const r = await executeAgentTool("apply_margin", {
      productIds: ["p1"],
      marginPercent: 30,
    });
    expect(r.ok).toBe(true);
    expect(listingDraftUpdate).toHaveBeenCalled();
    expect((r.data as { updated: number }).updated).toBe(1);
  });

  it("update_settings validates mode", async () => {
    const r = await executeAgentTool("update_settings", { autoSyncMode: "nope" });
    expect(r.ok).toBe(false);
  });

  it("update_settings writes valid patch", async () => {
    updateAppSettingsMock.mockResolvedValue({
      autoSyncMode: "stock_only",
      marginPercent: 40,
    });
    const r = await executeAgentTool("update_settings", {
      autoSyncMode: "stock_only",
      marginPercent: 40,
    });
    expect(r.ok).toBe(true);
    expect(updateAppSettingsMock).toHaveBeenCalled();
  });

  it("get_status aggregates", async () => {
    getAuthStatusMock.mockResolvedValue({ connected: true });
    syncRunFindFirst.mockResolvedValue({ status: "success" });
    mlSyncRunFindFirst.mockResolvedValue({ status: "success" });
    getAppSettingsMock.mockResolvedValue({ autoSyncMode: "always" });
    const r = await executeAgentTool("get_status", {});
    expect(r.ok).toBe(true);
    expect((r.data as { ml: { connected: boolean } }).ml.connected).toBe(true);
  });

  it("unknown tool fails", async () => {
    const r = await executeAgentTool("nope", {});
    expect(r.ok).toBe(false);
  });
});
