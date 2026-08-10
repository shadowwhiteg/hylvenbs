import { describe, expect, it } from "vitest";
import {
  buildItemPayload,
  resolveListingDefaults,
  validateDraftForPublish,
} from "@/lib/ml/payload";

const base = {
  title: "Produto teste ML",
  description: "Descricao",
  price: 199.9,
  condition: "new",
  buyingMode: "buy_it_now",
  listingTypeId: "gold_special",
  categoryId: "MLB1234",
  shippingMode: "me2",
  shippingJson: "{}",
  pictures: JSON.stringify(["https://example.com/a.jpg"]),
  attributes: "[]",
  variations: "[]",
  regulatory: "{}",
  warrantyType: "Garantia de fábrica",
  warrantyTime: "90 dias",
  availableQuantity: 3,
  currencyId: "BRL",
};

const settings = {
  defaultListingTypeId: "gold_pro",
  defaultFreeShipping: true,
  defaultLocalPickUp: false,
  defaultShippingMode: "me2",
  defaultWarrantyType: "Garantia de fábrica",
  defaultWarrantyTime: "90 dias",
};

describe("buildItemPayload", () => {
  it("maps draft to ML item body", () => {
    const payload = buildItemPayload(base);
    expect(payload.title).toBe("Produto teste ML");
    expect(payload.category_id).toBe("MLB1234");
    expect(payload.currency_id).toBe("BRL");
    expect(payload.pictures).toEqual([{ source: "https://example.com/a.jpg" }]);
    expect(payload.sale_terms).toEqual([
      { id: "WARRANTY_TYPE", value_name: "Garantia de fábrica" },
      { id: "WARRANTY_TIME", value_name: "90 dias" },
    ]);
  });

  it("validates required fields", () => {
    expect(validateDraftForPublish({ ...base, categoryId: "" })).toContain(
      "categoryId is required"
    );
    expect(validateDraftForPublish({ ...base, pictures: "[]" })).toContain(
      "at least one picture is required"
    );
  });

  it("blocks publish when Formato de venda is Kit but Unidades por kit is missing", () => {
    const attrs = JSON.stringify([{ id: "SALE_FORMAT", value_name: "Kit" }]);
    const errors = validateDraftForPublish({ ...base, attributes: attrs });
    expect(errors).toContain(
      "Unidades por kit (obrigatório) — como 'Formato de venda' é Kit, preencha a quantidade de unidades que compõem o kit"
    );
  });

  it("does not block publish when Unidades por kit is filled alongside Formato de venda=Kit", () => {
    const attrs = JSON.stringify([
      { id: "SALE_FORMAT", value_name: "Kit" },
      { id: "UNITS_PER_PACK", value_name: "3" },
    ]);
    const errors = validateDraftForPublish({ ...base, attributes: attrs });
    expect(errors.some((e) => e.includes("Unidades por kit"))).toBe(false);
  });

  it("does not require Unidades por kit when Formato de venda is not Kit", () => {
    const errors = validateDraftForPublish(base);
    expect(errors.some((e) => e.includes("Unidades por kit"))).toBe(false);
  });

  it("usa gold_pro quando listingTypeId está vazio", () => {
    const payload = buildItemPayload({ ...base, listingTypeId: "" });
    expect(payload.listing_type_id).toBe("gold_pro");
  });

  it("aplica frete grátis e retirada como default do envio", () => {
    const payload = buildItemPayload(base);
    expect(payload.shipping).toEqual({
      mode: "me2",
      free_shipping: true,
      local_pick_up: false,
    });
  });

  it("respeita freeShipping/localPickUp do draft", () => {
    const payload = buildItemPayload({
      ...base,
      freeShipping: false,
      localPickUp: true,
    });
    expect(payload.shipping).toEqual({
      mode: "me2",
      free_shipping: false,
      local_pick_up: true,
    });
  });

  it("shippingJson continua sobrescrevendo o shipping", () => {
    const payload = buildItemPayload({
      ...base,
      shippingJson: JSON.stringify({ free_shipping: false, dimensions: "10x10x10,500" }),
    });
    expect(payload.shipping).toEqual({
      mode: "me2",
      free_shipping: false,
      local_pick_up: false,
      dimensions: "10x10x10,500",
    });
  });

  it("preenche garantia padrão quando os campos estão vazios", () => {
    const payload = buildItemPayload({ ...base, warrantyType: "", warrantyTime: "" });
    expect(payload.sale_terms).toEqual([
      { id: "WARRANTY_TYPE", value_name: "Garantia de fábrica" },
      { id: "WARRANTY_TIME", value_name: "90 dias" },
    ]);
  });

  it("adiciona catalog_product_id e video_id quando presentes", () => {
    const payload = buildItemPayload({
      ...base,
      catalogProductId: "MLB19889100",
      videoId: "abc123",
    });
    expect(payload.catalog_product_id).toBe("MLB19889100");
    expect(payload.catalog_listing).toBe(true);
    expect(payload.video_id).toBe("abc123");
  });

  it("omite campos de catálogo/vídeo quando vazios", () => {
    const payload = buildItemPayload({
      ...base,
      catalogProductId: null,
      videoId: "",
    });
    expect(payload.catalog_product_id).toBeUndefined();
    expect(payload.catalog_listing).toBeUndefined();
    expect(payload.video_id).toBeUndefined();
  });
});

describe("resolveListingDefaults", () => {
  it("aplica os defaults das configurações", () => {
    const result = resolveListingDefaults(
      { listingTypeId: "gold_special", shippingMode: "custom", freeShipping: false },
      settings
    );
    expect(result).toEqual({
      listingTypeId: "gold_pro",
      shippingMode: "me2",
      freeShipping: true,
      localPickUp: false,
      warrantyType: "Garantia de fábrica",
      warrantyTime: "90 dias",
    });
  });

  it("preserva campos marcados como editados pelo usuário", () => {
    const result = resolveListingDefaults(
      {
        listingTypeId: "gold_special",
        freeShipping: false,
        warrantyTime: "12 meses",
        userEdited: { listingTypeId: true, freeShipping: true },
      },
      settings
    );
    expect(result.listingTypeId).toBe("gold_special");
    expect(result.freeShipping).toBe(false);
    expect(result.warrantyTime).toBe("90 dias");
  });

  it("usa a garantia do produto quando existe", () => {
    const result = resolveListingDefaults(
      { productWarranty: "3 meses" },
      settings
    );
    expect(result.warrantyTime).toBe("3 meses");
  });
});
