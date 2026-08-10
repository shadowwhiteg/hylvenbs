import { beforeEach, describe, expect, it, vi } from "vitest";

const { productFindMany, shopeeListingFindMany, shopeeTokenFindUnique, getAppSettingsMock } = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  shopeeListingFindMany: vi.fn(),
  shopeeTokenFindUnique: vi.fn(),
  getAppSettingsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findMany: productFindMany },
    shopeeListing: { findMany: shopeeListingFindMany },
    shopeeToken: { findUnique: shopeeTokenFindUnique },
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: getAppSettingsMock,
}));

import { executeShopeeAgentTool } from "@/lib/agent/shopee-tools";

describe("executeShopeeAgentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list_shopee_listings queries with filters and limit", async () => {
    shopeeListingFindMany.mockResolvedValue([{ id: "1", title: "Bola" }]);
    const r = await executeShopeeAgentTool("list_shopee_listings", { q: "bola", limit: 10 });
    expect(r.ok).toBe(true);
    expect(shopeeListingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ title: { contains: "bola" } }, { id: { contains: "bola" } }] },
      })
    );
  });

  it("create_kit_from_shopee_listings rejects unpublished products", async () => {
    productFindMany.mockResolvedValue([
      { id: "p1", title: "Item 1", shopeeItemId: null },
      { id: "p2", title: "Item 2", shopeeItemId: "SHP2" },
    ]);
    const r = await executeShopeeAgentTool("create_kit_from_shopee_listings", { productIds: ["p1", "p2"] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Item 1");
  });

  it("set_shopee_price requires price or marginPercent", async () => {
    const r = await executeShopeeAgentTool("set_shopee_price", { shopeeItemIds: ["1"] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("price ou marginPercent");
  });

  it("apply_shopee_bulk_discount validates percent range", async () => {
    const r = await executeShopeeAgentTool("apply_shopee_bulk_discount", {
      shopeeItemIds: ["1"],
      percent: 150,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("percent inválido");
  });

  it("unknown tool fails", async () => {
    const r = await executeShopeeAgentTool("nope", {});
    expect(r.ok).toBe(false);
  });
});
