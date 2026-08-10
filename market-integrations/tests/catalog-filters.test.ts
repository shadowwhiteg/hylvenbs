import { describe, expect, it } from "vitest";
import {
  buildProductOrderBy,
  buildProductWhere,
  countPictures,
  hasAttributes,
  matchesInMemoryFilters,
  needsInMemoryFiltering,
  parseCatalogFilters,
  serializeCatalogFilters,
  type CatalogFilters,
  type InMemoryProduct,
} from "@/lib/catalog/filters";

function parse(query: string): CatalogFilters {
  return parseCatalogFilters(new URLSearchParams(query));
}

describe("parseCatalogFilters", () => {
  it("uses defaults when query is empty", () => {
    expect(parse("")).toEqual({ page: 1, pageSize: 50 });
  });

  it("parses text filters and trims them", () => {
    const filters = parse("q=%20fone%20&status=synced&listingType=gold_pro");
    expect(filters.q).toBe("fone");
    expect(filters.status).toBe("synced");
    expect(filters.listingType).toBe("gold_pro");
  });

  it("ignores empty strings", () => {
    const filters = parse("q=&status=%20&listingType=");
    expect(filters.q).toBeUndefined();
    expect(filters.status).toBeUndefined();
    expect(filters.listingType).toBeUndefined();
  });

  it("parses booleans from 1/true/yes and 0/false/no", () => {
    expect(parse("hasVideo=1").hasVideo).toBe(true);
    expect(parse("hasVideo=true").hasVideo).toBe(true);
    expect(parse("hasVideo=TRUE").hasVideo).toBe(true);
    expect(parse("hasVideo=yes").hasVideo).toBe(true);
    expect(parse("hasVideo=0").hasVideo).toBe(false);
    expect(parse("hasVideo=false").hasVideo).toBe(false);
    expect(parse("hasVideo=no").hasVideo).toBe(false);
  });

  it("ignores invalid booleans", () => {
    expect(parse("hasImages=maybe").hasImages).toBeUndefined();
    expect(parse("freeShipping=2").freeShipping).toBeUndefined();
    expect(parse("hasCatalog=").hasCatalog).toBeUndefined();
  });

  it("parses published as yes/no and accepts boolean-like values", () => {
    expect(parse("published=yes").published).toBe("yes");
    expect(parse("published=no").published).toBe("no");
    expect(parse("published=1").published).toBe("yes");
    expect(parse("published=false").published).toBe("no");
    expect(parse("published=talvez").published).toBeUndefined();
  });

  it("parses numeric ranges and drops invalid numbers", () => {
    const filters = parse("priceMin=10.5&priceMax=abc&costMin=&costMax=99");
    expect(filters.priceMin).toBe(10.5);
    expect(filters.priceMax).toBeUndefined();
    expect(filters.costMin).toBeUndefined();
    expect(filters.costMax).toBe(99);
    expect(parse("priceMin=Infinity").priceMin).toBeUndefined();
  });

  it("accepts only known enum values", () => {
    expect(parse("stock=in").stock).toBe("in");
    expect(parse("stock=out").stock).toBe("out");
    expect(parse("stock=whatever").stock).toBeUndefined();
    expect(parse("marketplace=ml").marketplace).toBe("ml");
    expect(parse("marketplace=shopee").marketplace).toBe("shopee");
    expect(parse("marketplace=amazon").marketplace).toBeUndefined();
    expect(parse("sort=price&dir=desc").sort).toBe("price");
    expect(parse("sort=price&dir=desc").dir).toBe("desc");
    expect(parse("sort=random").sort).toBeUndefined();
    expect(parse("dir=sideways").dir).toBeUndefined();
  });

  it("clamps page to >= 1", () => {
    expect(parse("page=3").page).toBe(3);
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-7").page).toBe(1);
    expect(parse("page=2.9").page).toBe(2);
    expect(parse("page=xyz").page).toBe(1);
  });

  it("clamps pageSize between 1 and 500", () => {
    expect(parse("pageSize=25").pageSize).toBe(25);
    expect(parse("pageSize=0").pageSize).toBe(1);
    expect(parse("pageSize=-10").pageSize).toBe(1);
    expect(parse("pageSize=9999").pageSize).toBe(500);
    expect(parse("pageSize=nope").pageSize).toBe(50);
  });

  it("keeps false booleans instead of dropping them", () => {
    const filters = parse("hasVideo=0&missingAttributes=0");
    expect(Object.hasOwn(filters, "hasVideo")).toBe(true);
    expect(filters.hasVideo).toBe(false);
    expect(filters.missingAttributes).toBe(false);
  });
});

describe("serializeCatalogFilters", () => {
  it("round-trips through parseCatalogFilters", () => {
    const original = parse("q=fone&hasVideo=1&freeShipping=0&priceMin=10&sort=price&dir=desc");
    const roundTripped = parseCatalogFilters(serializeCatalogFilters(original));
    expect(roundTripped).toEqual(original);
  });
});

describe("buildProductWhere", () => {
  it("returns an empty object when there is nothing to filter", () => {
    expect(buildProductWhere({ page: 1, pageSize: 50 })).toEqual({});
  });

  it("searches title, externalId and sku", () => {
    const where = buildProductWhere({ q: "fone" });
    expect(where.AND).toEqual([
      {
        OR: [
          { title: { contains: "fone" } },
          { externalId: { contains: "fone" } },
          { sku: { contains: "fone" } },
        ],
      },
    ]);
  });

  it("maps published to mlItemId by default", () => {
    expect(buildProductWhere({ published: "yes" }).AND).toEqual([{ mlItemId: { not: null } }]);
    expect(buildProductWhere({ published: "no" }).AND).toEqual([{ mlItemId: null }]);
    expect(buildProductWhere({ published: "no", marketplace: "ml" }).AND).toEqual([
      { mlItemId: null },
    ]);
  });

  it("maps published to shopeeItemId when marketplace=shopee", () => {
    expect(buildProductWhere({ published: "no", marketplace: "shopee" }).AND).toEqual([
      { shopeeItemId: null },
    ]);
    expect(buildProductWhere({ published: "yes", marketplace: "shopee" }).AND).toEqual([
      { shopeeItemId: { not: null } },
    ]);
  });

  it("maps stock in/out", () => {
    expect(buildProductWhere({ stock: "in" }).AND).toEqual([{ stock: { gt: 0 } }]);
    expect(buildProductWhere({ stock: "out" }).AND).toEqual([
      { OR: [{ stock: null }, { stock: { lte: 0 } }] },
    ]);
  });

  it("maps draft-backed filters through the relation", () => {
    const where = buildProductWhere({
      priceMin: 10,
      priceMax: 20,
      freeShipping: true,
      listingType: "gold_pro",
      hasCatalog: true,
    });
    expect(where.AND).toEqual([
      { draft: { is: { price: { gte: 10 } } } },
      { draft: { is: { price: { lte: 20 } } } },
      { draft: { is: { freeShipping: true } } },
      { draft: { is: { listingTypeId: "gold_pro" } } },
      { draft: { is: { catalogProductId: { not: null } } } },
    ]);
  });

  it("treats a missing draft as missing category and missing catalog", () => {
    expect(buildProductWhere({ missingCategory: true }).AND).toEqual([
      { OR: [{ draft: { is: null } }, { draft: { is: { categoryId: "" } } }] },
    ]);
    expect(buildProductWhere({ hasCatalog: false }).AND).toEqual([
      { OR: [{ draft: { is: null } }, { draft: { is: { catalogProductId: null } } }] },
    ]);
  });

  it("treats an empty videoUrl as no video", () => {
    expect(buildProductWhere({ hasVideo: true }).AND).toEqual([
      { AND: [{ videoUrl: { not: null } }, { videoUrl: { not: "" } }] },
    ]);
    expect(buildProductWhere({ hasVideo: false }).AND).toEqual([
      { OR: [{ videoUrl: null }, { videoUrl: "" }] },
    ]);
  });
});

describe("buildProductOrderBy", () => {
  it("defaults to most recently updated first", () => {
    expect(buildProductOrderBy({})).toEqual({ updatedAt: "desc" });
  });

  it("orders price through the draft relation", () => {
    expect(buildProductOrderBy({ sort: "price", dir: "desc" })).toEqual({
      draft: { price: "desc" },
    });
  });

  it("uses ascending as the default direction for non-date sorts", () => {
    expect(buildProductOrderBy({ sort: "title" })).toEqual({ title: "asc" });
    expect(buildProductOrderBy({ sort: "cost" })).toEqual({ costPrice: "asc" });
    expect(buildProductOrderBy({ sort: "stock", dir: "desc" })).toEqual({ stock: "desc" });
  });
});

describe("countPictures / hasAttributes", () => {
  it("survives malformed JSON", () => {
    expect(countPictures("not json")).toBe(0);
    expect(countPictures("{}")).toBe(0);
    expect(countPictures(null)).toBe(0);
    expect(countPictures('["a","b"]')).toBe(2);
  });

  it("considers attributes from the product or from the draft", () => {
    expect(hasAttributes({ pictures: "[]", attributesJson: "[]", draft: null })).toBe(false);
    expect(
      hasAttributes({ pictures: "[]", attributesJson: '[{"id":"BRAND"}]', draft: null })
    ).toBe(true);
    expect(
      hasAttributes({
        pictures: "[]",
        attributesJson: "[]",
        draft: { attributes: '[{"id":"BRAND"}]' },
      })
    ).toBe(true);
  });
});

describe("needsInMemoryFiltering", () => {
  it("is true only for JSON-backed filters", () => {
    expect(needsInMemoryFiltering({ q: "fone", status: "synced" })).toBe(false);
    expect(needsInMemoryFiltering({ hasImages: false })).toBe(true);
    expect(needsInMemoryFiltering({ missingAttributes: true })).toBe(true);
  });
});

describe("matchesInMemoryFilters", () => {
  const withEverything: InMemoryProduct = {
    pictures: '["https://img/1.jpg"]',
    attributesJson: '[{"id":"BRAND","value_name":"Acme"}]',
    draft: { attributes: "[]" },
  };
  const withNothing: InMemoryProduct = {
    pictures: "[]",
    attributesJson: "[]",
    draft: { attributes: "[]" },
  };

  it("passes everything when no in-memory filter is set", () => {
    expect(matchesInMemoryFilters(withNothing, {})).toBe(true);
    expect(matchesInMemoryFilters(withEverything, { q: "fone" })).toBe(true);
  });

  it("filters by hasImages in both directions", () => {
    expect(matchesInMemoryFilters(withEverything, { hasImages: true })).toBe(true);
    expect(matchesInMemoryFilters(withEverything, { hasImages: false })).toBe(false);
    expect(matchesInMemoryFilters(withNothing, { hasImages: true })).toBe(false);
    expect(matchesInMemoryFilters(withNothing, { hasImages: false })).toBe(true);
  });

  it("filters by missingAttributes in both directions", () => {
    expect(matchesInMemoryFilters(withNothing, { missingAttributes: true })).toBe(true);
    expect(matchesInMemoryFilters(withNothing, { missingAttributes: false })).toBe(false);
    expect(matchesInMemoryFilters(withEverything, { missingAttributes: true })).toBe(false);
    expect(matchesInMemoryFilters(withEverything, { missingAttributes: false })).toBe(true);
  });

  it("treats malformed JSON as empty", () => {
    const broken: InMemoryProduct = {
      pictures: "<<broken>>",
      attributesJson: "<<broken>>",
      draft: null,
    };
    expect(matchesInMemoryFilters(broken, { hasImages: false })).toBe(true);
    expect(matchesInMemoryFilters(broken, { missingAttributes: true })).toBe(true);
  });

  it("combines both filters", () => {
    expect(
      matchesInMemoryFilters(withEverything, { hasImages: true, missingAttributes: true })
    ).toBe(false);
    expect(
      matchesInMemoryFilters(withEverything, { hasImages: true, missingAttributes: false })
    ).toBe(true);
  });
});
