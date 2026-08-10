import { describe, expect, it } from "vitest";

import {
  matchesMlListingFilters,
  parseMlListingFilters,
  sortMlListings,
  type FilterableListing,
} from "@/lib/ml-listings/filters";

function item(overrides: Partial<FilterableListing> = {}): FilterableListing {
  return {
    id: "MLB1",
    title: "Bola de Vôlei",
    status: "active",
    price: 50,
    availableQuantity: 10,
    product: null,
    kit: null,
    sku: null,
    ean: null,
    hasVideo: false,
    ...overrides,
  };
}

describe("parseMlListingFilters", () => {
  it("ignores invalid enum/number values instead of erroring", () => {
    const params = new URLSearchParams({ origin: "invalido", priceMin: "abc", sort: "price" });
    const filters = parseMlListingFilters(params);
    expect(filters.origin).toBeUndefined();
    expect(filters.priceMin).toBeUndefined();
    expect(filters.sort).toBe("price");
  });

  it("clamps page and pageSize", () => {
    const filters = parseMlListingFilters(new URLSearchParams({ page: "0", pageSize: "99999" }));
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(500);
  });
});

describe("matchesMlListingFilters", () => {
  it("filters by origin: matched/kit/avulso are mutually exclusive", () => {
    const matched = item({ product: { costPrice: 10 } });
    const kit = item({ kit: { costPrice: 20 } });
    const avulso = item();

    expect(matchesMlListingFilters(matched, { origin: "matched" })).toBe(true);
    expect(matchesMlListingFilters(kit, { origin: "matched" })).toBe(false);
    expect(matchesMlListingFilters(avulso, { origin: "avulso" })).toBe(true);
    expect(matchesMlListingFilters(matched, { origin: "avulso" })).toBe(false);
  });

  it("filters by stock in/out", () => {
    expect(matchesMlListingFilters(item({ availableQuantity: 0 }), { stock: "out" })).toBe(true);
    expect(matchesMlListingFilters(item({ availableQuantity: 5 }), { stock: "out" })).toBe(false);
  });

  it("filters by cost range using product OR kit cost, excluding items with neither", () => {
    expect(matchesMlListingFilters(item({ product: { costPrice: 15 } }), { costMin: 10, costMax: 20 })).toBe(
      true
    );
    expect(matchesMlListingFilters(item({ kit: { costPrice: 15 } }), { costMin: 10, costMax: 20 })).toBe(true);
    expect(matchesMlListingFilters(item(), { costMin: 10 })).toBe(false);
  });

  it("filters by missing SKU/EAN", () => {
    expect(matchesMlListingFilters(item({ sku: null }), { missingSku: true })).toBe(true);
    expect(matchesMlListingFilters(item({ sku: "ABC" }), { missingSku: true })).toBe(false);
    expect(matchesMlListingFilters(item({ ean: "789" }), { missingEan: false })).toBe(true);
  });

  it("filters by hasVideo", () => {
    expect(matchesMlListingFilters(item({ hasVideo: true }), { hasVideo: true })).toBe(true);
    expect(matchesMlListingFilters(item({ hasVideo: false }), { hasVideo: true })).toBe(false);
    expect(matchesMlListingFilters(item({ hasVideo: true }), { hasVideo: false })).toBe(false);
  });

  it("searches title, id and sku together", () => {
    const target = item({ id: "MLB999", title: "Produto Genérico", sku: "SKU-XYZ" });
    expect(matchesMlListingFilters(target, { q: "sku-xyz" })).toBe(true);
    expect(matchesMlListingFilters(target, { q: "mlb999" })).toBe(true);
    expect(matchesMlListingFilters(target, { q: "não existe" })).toBe(false);
  });
});

describe("sortMlListings", () => {
  it("sorts by price ascending", () => {
    const items = [
      { ...item({ id: "A", price: 30 }), updatedAt: "2026-01-01" },
      { ...item({ id: "B", price: 10 }), updatedAt: "2026-01-02" },
    ];
    const sorted = sortMlListings(items, { sort: "price", dir: "asc" });
    expect(sorted.map((i) => i.id)).toEqual(["B", "A"]);
  });

  it("defaults to updated desc", () => {
    const items = [
      { ...item({ id: "OLD" }), updatedAt: "2026-01-01" },
      { ...item({ id: "NEW" }), updatedAt: "2026-01-05" },
    ];
    const sorted = sortMlListings(items, {});
    expect(sorted.map((i) => i.id)).toEqual(["NEW", "OLD"]);
  });
});
