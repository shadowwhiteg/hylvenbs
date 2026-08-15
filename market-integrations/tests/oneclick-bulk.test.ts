import { describe, expect, it } from "vitest";
import {
  buildOneClickBulkProductParams,
  classifyOneClickError,
  formatOneClickBulkSelectionMessage,
  isOneClickSearchableStock,
  selectOneClickBulkCandidates,
  shouldStopBulkPagination,
  summarizeOneClickErrors,
  skuNotFoundMessage,
} from "@/lib/oneclick/bulk";
import { pickSearchResultBySku, normalizeOneClickSku } from "@/lib/oneclick/client";
import {
  collectPublishedSkuKeysFromMlListings,
  collectPublishedSkuKeysFromShopeeListings,
} from "@/lib/oneclick/published-skus";
import { normalizePublishedSkuKey } from "@/lib/oneclick/sku-key";

describe("classifyOneClickError — erros vindos do Meu Drop", () => {
  it("aponta o EAN do cadastro do Meu Drop, não do app", () => {
    expect(
      classifyOneClickError(
        "Product Identifier [GTIN] contains values with invalid format: [7897807425274]"
      )
    ).toBe("EAN inválido no cadastro do Meu Drop");
  });

  it("identifica atributo obrigatório da categoria", () => {
    expect(classifyOneClickError('O campo "Material" é obrigatório e não foi adicionado.')).toBe(
      "Atributo obrigatório da categoria faltando no Meu Drop"
    );
  });
});

describe("One Click bulk stock gate", () => {
  const products = [
    { id: "1", title: "A", sku: "IN-STOCK", stock: 5, mlItemId: null },
    { id: "2", title: "B", sku: "ZERO", stock: 0, mlItemId: null },
    { id: "3", title: "C", sku: "NULL", stock: null, mlItemId: null },
    { id: "4", title: "D", sku: "LINKED", stock: 0, mlItemId: "MLB1" },
    { id: "5", title: "E", sku: "  ", stock: 9, mlItemId: null },
    { id: "6", title: "F", sku: "SHOPEE-OK", stock: 3, shopeeItemId: null, mlItemId: null },
  ];

  it("skips out-of-stock products when selecting unpublished for publish", () => {
    const { selected, skippedOutOfStock, skippedWithoutSku, skippedAlreadyPublished } =
      selectOneClickBulkCandidates(products, "unpublished", "ml");
    expect(selected.map((p) => p.sku)).toEqual(["IN-STOCK", "SHOPEE-OK"]);
    expect(skippedOutOfStock).toBe(2); // ZERO + NULL
    expect(skippedWithoutSku).toBe(1); // blank sku
    expect(skippedAlreadyPublished).toBe(0);
  });

  it("skips products whose SKU already exists on ML listings even without mlItemId", () => {
    const publishedSkus = new Set([normalizePublishedSkuKey("IN-STOCK")]);
    const { selected, skippedAlreadyPublished, skippedOutOfStock } = selectOneClickBulkCandidates(
      products,
      "unpublished",
      "ml",
      publishedSkus
    );
    expect(selected.map((p) => p.sku)).toEqual(["SHOPEE-OK"]);
    expect(skippedAlreadyPublished).toBe(1);
    expect(skippedOutOfStock).toBe(2);
  });

  it("normalizes SKU keys when matching published listings (accents / punctuation)", () => {
    const productsWithAccent = [
      { id: "a", title: "X", sku: "Café-01", stock: 2, mlItemId: null },
      { id: "b", title: "Y", sku: "OTHER", stock: 2, mlItemId: null },
    ];
    const publishedSkus = new Set([normalizePublishedSkuKey("cafe01")]);
    const { selected, skippedAlreadyPublished } = selectOneClickBulkCandidates(
      productsWithAccent,
      "unpublished",
      "ml",
      publishedSkus
    );
    expect(selected.map((p) => p.sku)).toEqual(["OTHER"]);
    expect(skippedAlreadyPublished).toBe(1);
  });

  it("allows sync of already-linked items even with stock 0", () => {
    const { selected, skippedOutOfStock, skippedWithoutSku } = selectOneClickBulkCandidates(
      products,
      "sync",
      "ml"
    );
    expect(selected.map((p) => p.sku)).toEqual(["LINKED"]);
    expect(skippedOutOfStock).toBe(0);
    expect(skippedWithoutSku).toBe(0);
  });

  it("includes products whose stored mlItemId no longer exists as a listing (bug ~26)", () => {
    const stale = [
      { id: "1", title: "Vivo", sku: "LIVE", stock: 5, mlItemId: "MLB-LIVE" },
      { id: "2", title: "Órfão", sku: "STALE", stock: 5, mlItemId: "MLB-GONE" },
      { id: "3", title: "Novo", sku: "NEW", stock: 5, mlItemId: null },
    ];
    const liveListingIds = new Set(["MLB-LIVE"]);
    const { selected, staleLinks } = selectOneClickBulkCandidates(
      stale,
      "unpublished",
      "ml",
      undefined,
      liveListingIds
    );
    expect(selected.map((p) => p.sku)).toEqual(["STALE", "NEW"]);
    expect(staleLinks).toBe(1);
  });

  it("does not offer stale-linked products for sync (nothing to update)", () => {
    const stale = [
      { id: "1", title: "Vivo", sku: "LIVE", stock: 0, mlItemId: "MLB-LIVE" },
      { id: "2", title: "Órfão", sku: "STALE", stock: 0, mlItemId: "MLB-GONE" },
    ];
    const { selected } = selectOneClickBulkCandidates(
      stale,
      "sync",
      "ml",
      undefined,
      new Set(["MLB-LIVE"])
    );
    expect(selected.map((p) => p.sku)).toEqual(["LIVE"]);
  });

  it("keeps trusting stored ids when no live listing set is available", () => {
    const { selected, staleLinks } = selectOneClickBulkCandidates(
      products,
      "unpublished",
      "ml",
      undefined,
      undefined
    );
    expect(selected.map((p) => p.sku)).toEqual(["IN-STOCK", "SHOPEE-OK"]);
    expect(staleLinks).toBe(0);
  });

  it("treats an empty live listing set as 'account has no listings', not as missing data", () => {
    const stale = [
      { id: "1", title: "Órfão", sku: "STALE", stock: 5, mlItemId: "MLB-GONE" },
      { id: "2", title: "Novo", sku: "NEW", stock: 5, mlItemId: null },
    ];
    const { selected, staleLinks } = selectOneClickBulkCandidates(
      stale,
      "unpublished",
      "ml",
      undefined,
      new Set()
    );
    expect(selected.map((p) => p.sku)).toEqual(["STALE", "NEW"]);
    expect(staleLinks).toBe(1);
  });

  it("treats only positive stock as searchable", () => {
    expect(isOneClickSearchableStock(1)).toBe(true);
    expect(isOneClickSearchableStock(0)).toBe(false);
    expect(isOneClickSearchableStock(null)).toBe(false);
    expect(isOneClickSearchableStock(undefined)).toBe(false);
  });
});

describe("Published SKU collectors", () => {
  it("extracts SELLER_SKU from ML attributesJson", () => {
    const skus = collectPublishedSkuKeysFromMlListings([
      {
        attributesJson: JSON.stringify([
          { id: "SELLER_SKU", value_name: "ABC-12" },
          { id: "GTIN", value_name: "789" },
        ]),
      },
      { attributesJson: "[]" },
      {
        attributesJson: JSON.stringify([{ id: "SELLER_SKU", value_name: "abc 12" }]),
      },
    ]);
    expect(skus).toEqual(["abc12"]);
  });

  it("extracts itemSku from Shopee listings", () => {
    const skus = collectPublishedSkuKeysFromShopeeListings([
      { itemSku: "SP-01" },
      { itemSku: null },
      { itemSku: "sp01" },
    ]);
    expect(skus).toEqual(["sp01"]);
  });
});

describe("One Click bulk product query / pagination", () => {
  it("requests unpublished with stock=in and marketplace", () => {
    const params = buildOneClickBulkProductParams("unpublished", "ml", 2, 500);
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("500");
    expect(params.get("published")).toBe("no");
    expect(params.get("stock")).toBe("in");
    expect(params.get("marketplace")).toBe("ml");
  });

  it("requests sync without stock filter", () => {
    const params = buildOneClickBulkProductParams("sync", "shopee", 1);
    expect(params.get("published")).toBe("yes");
    expect(params.get("marketplace")).toBe("shopee");
    expect(params.get("stock")).toBeNull();
  });

  it("does not stop on total=0/undefined when a full page arrives (bug ~25)", () => {
    expect(
      shouldStopBulkPagination({
        batchLength: 500,
        pageSize: 500,
        loadedCount: 500,
        total: 0,
      })
    ).toBe(false);
    expect(
      shouldStopBulkPagination({
        batchLength: 500,
        pageSize: 500,
        loadedCount: 500,
        total: undefined,
      })
    ).toBe(false);
    expect(
      shouldStopBulkPagination({
        batchLength: 25,
        pageSize: 500,
        loadedCount: 25,
        total: 0,
      })
    ).toBe(true);
  });

  it("stops on empty batch, short batch, or loadedCount >= positive total", () => {
    expect(
      shouldStopBulkPagination({
        batchLength: 0,
        pageSize: 500,
        loadedCount: 0,
        total: 100,
      })
    ).toBe(true);
    expect(
      shouldStopBulkPagination({
        batchLength: 120,
        pageSize: 500,
        loadedCount: 620,
        total: 620,
      })
    ).toBe(true);
    expect(
      shouldStopBulkPagination({
        batchLength: 500,
        pageSize: 500,
        loadedCount: 1000,
        total: 1500,
      })
    ).toBe(false);
    expect(
      shouldStopBulkPagination({
        batchLength: 500,
        pageSize: 500,
        loadedCount: 1500,
        total: 1500,
      })
    ).toBe(true);
  });

  it("formats selection feedback with catalog total and skips", () => {
    expect(
      formatOneClickBulkSelectionMessage({
        kind: "unpublished",
        marketplace: "ml",
        selectedCount: 80,
        catalogTotal: 100,
        skippedOutOfStock: 15,
        skippedWithoutSku: 5,
      })
    ).toBe(
      "Selecionados 80 com estoque e sem anúncio ML. Total elegível no catálogo: 100. Ignorados sem estoque: 15. Sem SKU: 5."
    );
  });

  it("formats selection feedback including already-published SKUs on ML", () => {
    expect(
      formatOneClickBulkSelectionMessage({
        kind: "unpublished",
        marketplace: "ml",
        selectedCount: 10,
        catalogTotal: 50,
        skippedOutOfStock: 0,
        skippedWithoutSku: 0,
        skippedAlreadyPublished: 7,
      })
    ).toBe(
      "Selecionados 10 com estoque e sem anúncio ML. Total elegível no catálogo: 50. Ignorados já no ML (SKU): 7."
    );
  });
});

describe("One Click SKU search matching", () => {
  it("trims SKU input", () => {
    expect(normalizeOneClickSku("  ABC  ")).toBe("ABC");
  });

  it("matches exact SKU case-insensitively and rejects title-only hits", () => {
    const results = [
      { id: 1, text: "#1 — Outro produto (SKU: OTHER)" },
      { id: 2, text: "#2 — Canetinhas kit (SKU: touch36)" },
    ];
    expect(pickSearchResultBySku(results, "12canetinhascoloridas")).toBeNull();
    expect(pickSearchResultBySku(results, "touch36")?.id).toBe(2);
    expect(pickSearchResultBySku(results, "TOUCH36")?.id).toBe(2);
  });
});

describe("One Click error messaging", () => {
  it("explains out-of-stock not-found", () => {
    expect(skuNotFoundMessage(0)).toMatch(/sem estoque/i);
    expect(skuNotFoundMessage(5)).toMatch(/indisponível no picker/i);
  });

  it("summarizes error types for the progress panel", () => {
    const summary = summarizeOneClickErrors([
      {
        status: "error",
        error:
          "SKU não encontrado no Meu Drop (sem estoque — o One Click não lista produtos zerados)",
      },
      { status: "error", error: "SKU não encontrado no Meu Drop" },
      {
        status: "conflict",
        error: "SKU já possui anúncio no Mercado Livre; resolva manualmente",
      },
      { status: "success", error: null },
    ]);
    expect(summary[0].count).toBe(2);
    expect(summary[0].label).toMatch(/indisponível no One Click/i);
    expect(summary.some((s) => s.label === "SKU já anunciado" && s.count === 1)).toBe(true);
    expect(classifyOneClickError("The category MLB434378 requires a minimum of price 8")).toMatch(
      /preço/i
    );
  });
});
