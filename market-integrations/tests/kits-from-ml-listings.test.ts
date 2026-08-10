import { beforeEach, describe, expect, it, vi } from "vitest";

const { mlListingFindMany, productFindMany, kitCreate, getAppSettingsMock } = vi.hoisted(() => ({
  mlListingFindMany: vi.fn(),
  productFindMany: vi.fn(),
  kitCreate: vi.fn(),
  getAppSettingsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlListing: { findMany: mlListingFindMany },
    product: { findMany: productFindMany },
    kit: { create: kitCreate },
  },
}));

vi.mock("@/lib/settings", () => ({ getAppSettings: getAppSettingsMock }));

import {
  buildKitTitle,
  createKitFromMlListings,
  upgradeMlThumbnail,
} from "@/lib/kits/from-ml-listings";

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "MLB1",
    title: "Bola de Vôlei",
    price: 20,
    availableQuantity: 10,
    categoryId: "MLB1334",
    thumbnail: "http://http2.mlstatic.com/D_NQ_NP_123-MLB456-F.jpg",
    ...overrides,
  };
}

describe("buildKitTitle", () => {
  it("keeps full titles when they fit in 60 chars", () => {
    expect(buildKitTitle(["Bola de Vôlei", "Bomba de Ar"])).toBe("Kit Bola de Vôlei + Bomba de Ar");
  });

  it("never exceeds 60 characters even with long titles", () => {
    const title = buildKitTitle([
      "Mochila Bolsa Camuflada Escolar Infantil Juvenil Reforçada Azul Escuro",
      "Kit 24 Canetas Cores Fine Line Ponta Fina 0.4mm Primeira Linha",
      "Calculadora X Cell 8 Dígitos Bateria Interna Xc Ca 800a Cinza",
    ]);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.startsWith("Kit")).toBe(true);
  });

  it("falls back to a generic title when nothing else fits", () => {
    const title = buildKitTitle(Array.from({ length: 12 }, (_, i) => `Produto Bastante Longo ${i}`));
    expect(title.length).toBeLessThanOrEqual(60);
  });
});

describe("upgradeMlThumbnail", () => {
  it("swaps the thumbnail for the 2x variant", () => {
    expect(upgradeMlThumbnail("http://x/D_NQ_NP_123-MLB-F.jpg")).toBe(
      "http://x/D_NQ_NP_2X_123-MLB-F.jpg"
    );
  });

  it("returns null for empty input", () => {
    expect(upgradeMlThumbnail(null)).toBeNull();
    expect(upgradeMlThumbnail("  ")).toBeNull();
  });
});

describe("createKitFromMlListings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppSettingsMock.mockResolvedValue({
      defaultListingTypeId: "gold_pro",
      defaultShippingMode: "me2",
      defaultFreeShipping: true,
      defaultLocalPickUp: false,
      defaultWarrantyType: "Garantia de fábrica",
      defaultWarrantyTime: "90 dias",
    });
    productFindMany.mockResolvedValue([]);
    kitCreate.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: "kit1",
      ...(data as object),
    }));
  });

  it("requires at least 2 listings", async () => {
    await expect(createKitFromMlListings({ listingIds: ["MLB1"] })).rejects.toThrow(
      "ao menos 2 anúncios"
    );
    expect(mlListingFindMany).not.toHaveBeenCalled();
  });

  it("reports which listing ids are missing locally", async () => {
    mlListingFindMany.mockResolvedValue([listing()]);
    await expect(
      createKitFromMlListings({ listingIds: ["MLB1", "MLB404"] })
    ).rejects.toThrow("MLB404");
  });

  it("prices the kit as the sum of listings minus the bundle discount", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1", price: 20 }),
      listing({ id: "MLB2", price: 30, title: "Rede" }),
    ]);

    await createKitFromMlListings({
      listingIds: ["MLB1", "MLB2"],
      bundleDiscountPercent: 10,
    });

    const [{ data }] = kitCreate.mock.calls[0];
    expect(data.draft.create.price).toBe(45);
    expect(data.source).toBe("ml_listings");
    expect(data.items.create).toHaveLength(2);
    expect(data.items.create[0]).toMatchObject({ mlListingId: "MLB1", unitPrice: 20 });
  });

  it("pulls costPrice from the local product when the listing is linked", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1", price: 20 }),
      listing({ id: "MLB2", price: 30 }),
    ]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB1", costPrice: 8 }]);

    await createKitFromMlListings({ listingIds: ["MLB1", "MLB2"] });

    const [{ data }] = kitCreate.mock.calls[0];
    expect(data.costPrice).toBe(8);
  });

  it("caps kit stock at the scarcest item, accounting for quantity", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1", availableQuantity: 10 }),
      listing({ id: "MLB2", availableQuantity: 3 }),
    ]);

    await createKitFromMlListings({
      listingIds: ["MLB1", "MLB2"],
      quantities: { MLB1: 2 },
    });

    const [{ data }] = kitCreate.mock.calls[0];
    // MLB1: floor(10/2)=5, MLB2: floor(3/1)=3 -> 3
    expect(data.draft.create.availableQuantity).toBe(3);
  });

  it("sets Formato de venda=Kit and Unidades por kit as the sum of item quantities", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1" }),
      listing({ id: "MLB2", title: "Rede" }),
    ]);

    await createKitFromMlListings({
      listingIds: ["MLB1", "MLB2"],
      quantities: { MLB1: 2, MLB2: 3 },
    });

    const [{ data }] = kitCreate.mock.calls[0];
    const attrs = JSON.parse(data.draft.create.attributes);
    expect(attrs).toEqual(
      expect.arrayContaining([
        { id: "SALE_FORMAT", name: "Formato de venda", value_name: "Kit" },
        { id: "UNITS_PER_PACK", name: "Unidades por kit", value_name: "5" },
      ])
    );
  });

  it("uses the most frequent categoryId across the listings", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1", categoryId: "CAT_A" }),
      listing({ id: "MLB2", categoryId: "CAT_B" }),
      listing({ id: "MLB3", categoryId: "CAT_B" }),
    ]);

    await createKitFromMlListings({ listingIds: ["MLB1", "MLB2", "MLB3"] });

    const [{ data }] = kitCreate.mock.calls[0];
    expect(data.draft.create.categoryId).toBe("CAT_B");
  });

  it("pulls at least 3 pictures per item from the linked product's gallery", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1" }),
      listing({ id: "MLB2", title: "Rede" }),
    ]);
    productFindMany.mockResolvedValue([
      {
        mlItemId: "MLB1",
        costPrice: 0,
        pictures: JSON.stringify(["http://a/1.jpg", "http://a/2.jpg", "http://a/3.jpg", "http://a/4.jpg"]),
      },
      {
        mlItemId: "MLB2",
        costPrice: 0,
        pictures: JSON.stringify(["http://b/1.jpg", "http://b/2.jpg", "http://b/3.jpg"]),
      },
    ]);

    await createKitFromMlListings({ listingIds: ["MLB1", "MLB2"] });

    const [{ data }] = kitCreate.mock.calls[0];
    const pictures: string[] = JSON.parse(data.draft.create.pictures);
    expect(pictures).toEqual([
      "http://a/1.jpg",
      "http://a/2.jpg",
      "http://a/3.jpg",
      "http://b/1.jpg",
      "http://b/2.jpg",
      "http://b/3.jpg",
    ]);
  });

  it("falls back to the ML thumbnail when the listing has no linked product gallery", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1", thumbnail: "http://x/D_NQ_NP_1-MLB-F.jpg" }),
      listing({ id: "MLB2", title: "Rede", thumbnail: "http://x/D_NQ_NP_2-MLB-F.jpg" }),
    ]);

    await createKitFromMlListings({ listingIds: ["MLB1", "MLB2"] });

    const [{ data }] = kitCreate.mock.calls[0];
    const pictures: string[] = JSON.parse(data.draft.create.pictures);
    expect(pictures).toEqual([
      "http://x/D_NQ_NP_2X_1-MLB-F.jpg",
      "http://x/D_NQ_NP_2X_2-MLB-F.jpg",
    ]);
  });

  it("deduplicates repeated listing ids before validating the minimum", async () => {
    await expect(
      createKitFromMlListings({ listingIds: ["MLB1", "MLB1"] })
    ).rejects.toThrow("ao menos 2 anúncios");
  });
});
