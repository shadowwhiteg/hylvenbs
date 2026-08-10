import { beforeEach, describe, expect, it, vi } from "vitest";

const { mlListingFindMany, productFindMany, productUpdate, kitFindMany } = vi.hoisted(() => ({
  mlListingFindMany: vi.fn(),
  productFindMany: vi.fn(),
  productUpdate: vi.fn(),
  kitFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlListing: { findMany: mlListingFindMany },
    product: { findMany: productFindMany, update: productUpdate },
    kit: { findMany: kitFindMany },
  },
}));

import { matchAvulsoListingsToCatalog, titleSimilarity } from "@/lib/ml-listings/catalog-match";

function listing(overrides: Partial<{
  id: string;
  title: string;
  permalink: string | null;
  attributesJson: string;
}> = {}) {
  return {
    id: "MLB1",
    title: "Fruteira de Mesa Preta",
    permalink: "https://produto.mercadolivre.com.br/MLB1",
    attributesJson: "[]",
    ...overrides,
  };
}

function product(overrides: Partial<{
  id: string;
  title: string;
  sku: string | null;
  attributesJson: string;
  description: string;
}> = {}) {
  return {
    id: "p1",
    title: "Fruteira de Mesa Preta",
    sku: null,
    attributesJson: "[]",
    description: "",
    ...overrides,
  };
}

describe("matchAvulsoListingsToCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kitFindMany.mockResolvedValue([]);
    productUpdate.mockResolvedValue({});
  });

  it("links by SELLER_SKU exact match", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({
        attributesJson: JSON.stringify([{ id: "SELLER_SKU", value_name: "ABC-123" }]),
      }),
    ]);
    productFindMany.mockResolvedValueOnce([]); // already-linked lookup not used here (avulso path uses product.findMany once for candidates)
    productFindMany.mockResolvedValueOnce([product({ id: "p1", sku: "abc-123" })]);

    const result = await matchAvulsoListingsToCatalog();

    expect(result.matched).toBe(1);
    expect(result.details[0]).toMatchObject({ listingId: "MLB1", productId: "p1", method: "sku" });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { mlItemId: "MLB1", mlPermalink: "https://produto.mercadolivre.com.br/MLB1" },
    });
  });

  it("links by GTIN/EAN when no SKU matches", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ attributesJson: JSON.stringify([{ id: "GTIN", value_name: "7891234567890" }]) }),
    ]);
    productFindMany.mockResolvedValueOnce([]);
    productFindMany.mockResolvedValueOnce([
      product({ id: "p1", attributesJson: JSON.stringify([{ name: "EAN", value: "7891234567890" }]) }),
    ]);

    const result = await matchAvulsoListingsToCatalog();

    expect(result.matched).toBe(1);
    expect(result.details[0].method).toBe("ean");
  });

  it("links by high title similarity when there is a single clear candidate", async () => {
    mlListingFindMany.mockResolvedValue([listing({ title: "Fruteira de Mesa Preta Grande" })]);
    productFindMany.mockResolvedValueOnce([]);
    productFindMany.mockResolvedValueOnce([
      product({ id: "p1", title: "Fruteira de Mesa Preta Grande" }),
      product({ id: "p2", title: "Panela de Pressão Elétrica 5L" }),
    ]);

    const result = await matchAvulsoListingsToCatalog();

    expect(result.matched).toBe(1);
    expect(result.details[0]).toMatchObject({ productId: "p1", method: "title" });
  });

  it("does not guess when two candidates are similarly close by title", async () => {
    mlListingFindMany.mockResolvedValue([listing({ title: "Fruteira de Mesa Preta Grande" })]);
    productFindMany.mockResolvedValueOnce([]);
    productFindMany.mockResolvedValueOnce([
      product({ id: "p1", title: "Fruteira de Mesa Preta Grande 3 Andares" }),
      product({ id: "p2", title: "Fruteira de Mesa Preta Grande 2 Andares" }),
    ]);

    const result = await matchAvulsoListingsToCatalog();

    expect(result.matched).toBe(0);
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("skips listings that already have a linked product or kit", async () => {
    mlListingFindMany.mockResolvedValue([listing({ id: "MLB1" }), listing({ id: "MLB2" })]);
    productFindMany.mockResolvedValueOnce([{ mlItemId: "MLB1" }]); // already-linked lookup
    kitFindMany.mockResolvedValueOnce([]);
    productFindMany.mockResolvedValueOnce([]); // candidates for the remaining avulso listing

    const result = await matchAvulsoListingsToCatalog();

    expect(mlListingFindMany).toHaveBeenCalled();
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips when there is no candidate close enough by any method", async () => {
    mlListingFindMany.mockResolvedValue([listing({ title: "Produto Totalmente Diferente XYZ" })]);
    productFindMany.mockResolvedValueOnce([]);
    productFindMany.mockResolvedValueOnce([product({ id: "p1", title: "Fruteira de Mesa Preta" })]);

    const result = await matchAvulsoListingsToCatalog();

    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("restricts the query to the given ids", async () => {
    mlListingFindMany.mockResolvedValue([]);
    await matchAvulsoListingsToCatalog(["MLB1", "MLB2"]);
    expect(mlListingFindMany).toHaveBeenCalledWith({ where: { id: { in: ["MLB1", "MLB2"] } } });
  });

  it("never reuses a candidate product for two different listings", async () => {
    mlListingFindMany.mockResolvedValue([
      listing({ id: "MLB1", attributesJson: JSON.stringify([{ id: "SELLER_SKU", value_name: "SKU-1" }]) }),
      listing({ id: "MLB2", attributesJson: JSON.stringify([{ id: "SELLER_SKU", value_name: "SKU-1" }]) }),
    ]);
    productFindMany.mockResolvedValueOnce([]);
    productFindMany.mockResolvedValueOnce([product({ id: "p1", sku: "SKU-1" })]);

    const result = await matchAvulsoListingsToCatalog();

    expect(result.matched).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

describe("titleSimilarity", () => {
  it("returns 1 for identical titles", () => {
    expect(titleSimilarity("Fruteira de Mesa", "Fruteira de Mesa")).toBe(1);
  });

  it("returns 0 when there is no overlap", () => {
    expect(titleSimilarity("Fruteira de Mesa", "Panela Elétrica")).toBe(0);
  });

  it("is accent/case insensitive", () => {
    expect(titleSimilarity("Fruteira Aço Inoxidável", "fruteira aco inoxidavel")).toBe(1);
  });
});
