import { beforeEach, describe, expect, it, vi } from "vitest";

const { productFindMany, appSettingsUpsert, kitCreate } = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  appSettingsUpsert: vi.fn(),
  kitCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findMany: productFindMany },
    appSettings: { upsert: appSettingsUpsert },
    kit: { create: kitCreate },
  },
}));

import { createKitFromProducts } from "@/lib/kits/create";

describe("createKitFromProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appSettingsUpsert.mockResolvedValue({ marginPercent: 30 });
    kitCreate.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "kit1", ...(data as object) }));
  });

  it("rejects fewer than 2 products", async () => {
    await expect(createKitFromProducts(["p1"])).rejects.toThrow(
      "Selecione ao menos 2 produtos"
    );
    expect(productFindMany).not.toHaveBeenCalled();
  });

  it("rejects when a productId is invalid", async () => {
    productFindMany.mockResolvedValue([{ id: "p1", title: "A", costPrice: 10, description: "", pictures: "[]" }]);
    await expect(createKitFromProducts(["p1", "p2"])).rejects.toThrow(
      "Um ou mais productIds são inválidos"
    );
  });

  it("sums costs, merges pictures and creates the kit + draft", async () => {
    productFindMany.mockResolvedValue([
      { id: "p1", title: "Bola", costPrice: 10, description: "desc1", pictures: '["a.jpg","b.jpg"]' },
      { id: "p2", title: "Rede", costPrice: 5, description: "desc2", pictures: '["b.jpg"]' },
    ]);

    const kit = await createKitFromProducts(["p1", "p2"]);

    expect(kitCreate).toHaveBeenCalledTimes(1);
    const [{ data }] = kitCreate.mock.calls[0];
    expect(data.costPrice).toBe(15);
    expect(data.title).toContain("Bola");
    expect(data.title).toContain("Rede");
    expect(JSON.parse(data.draft.create.pictures)).toEqual(["a.jpg", "b.jpg"]);
    expect(data.draft.create.price).toBeGreaterThan(15);
    expect(kit).toBeDefined();

    const attrs = JSON.parse(data.draft.create.attributes);
    expect(attrs).toEqual(
      expect.arrayContaining([
        { id: "SALE_FORMAT", name: "Formato de venda", value_name: "Kit" },
        { id: "UNITS_PER_PACK", name: "Unidades por kit", value_name: "2" },
      ])
    );
  });
});
