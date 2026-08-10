import { describe, expect, it } from "vitest";
import {
  buildItemPayload,
  parseShopeeAttributes,
  resolveListingDefaults,
  validateDraftForPublish,
  type ShopeeListingDraftLike,
} from "@/lib/shopee/payload";

function draft(overrides: Partial<ShopeeListingDraftLike> = {}): ShopeeListingDraftLike {
  return {
    title: "Bola de Vôlei Profissional",
    description: "Descrição",
    price: 50,
    stock: 10,
    condition: "NEW",
    categoryId: "100182",
    attributes: "[]",
    pictures: JSON.stringify(["http://x/1.jpg"]),
    itemSku: "SKU1",
    brandId: null,
    brandName: "Genérica",
    weightKg: 0.5,
    dimensionJson: JSON.stringify({ length: 10, width: 10, height: 10 }),
    logisticsJson: "[]",
    daysToShip: 2,
    videoUrl: null,
    ...overrides,
  };
}

describe("validateDraftForPublish", () => {
  it("passes for a fully valid draft", () => {
    expect(validateDraftForPublish(draft(), 3)).toEqual([]);
  });

  it("flags missing title, price, category, weight and images", () => {
    const errors = validateDraftForPublish(
      draft({ title: "", price: 0, categoryId: "", weightKg: 0 }),
      0
    );
    expect(errors).toContain("title é obrigatório");
    expect(errors).toContain("price deve ser > 0");
    expect(errors).toContain("categoryId é obrigatório");
    expect(errors).toContain("é necessária ao menos 1 imagem");
    expect(errors).toContain("peso (weightKg) deve ser > 0 — obrigatório pela Shopee");
  });

  it("requires brand, falling back to 'Sem marca' as an accepted value", () => {
    const errors = validateDraftForPublish(draft({ brandName: "", brandId: null }), 1);
    expect(errors.some((e) => e.includes("Marca"))).toBe(true);
    expect(validateDraftForPublish(draft({ brandName: "Sem marca" }), 1)).toEqual([]);
  });

  it("flags missing mandatory category attributes", () => {
    const errors = validateDraftForPublish(draft(), 1, [{ attributeId: 999, name: "Material" }]);
    expect(errors).toContain("Atributo obrigatório ausente: Material");
  });

  it("does not flag a mandatory attribute that is already present", () => {
    const errors = validateDraftForPublish(
      draft({ attributes: JSON.stringify([{ attribute_id: 999, value: "Plástico" }]) }),
      1,
      [{ attributeId: 999, name: "Material" }]
    );
    expect(errors).toEqual([]);
  });
});

describe("buildItemPayload", () => {
  it("builds a payload with resolved image ids and default brand fallback", () => {
    const payload = buildItemPayload(draft({ brandId: null, brandName: "" }), ["img1", "img2"]);
    expect(payload.item_name).toBe("Bola de Vôlei Profissional");
    expect(payload.category_id).toBe(100182);
    expect(payload.price_info).toEqual([{ current_price: 50 }]);
    expect(payload.stock_info).toEqual([{ stock_type: 0, current_stock: 10 }]);
    expect(payload.image).toEqual({ image_id_list: ["img1", "img2"] });
    expect(payload.brand).toEqual({ brand_id: 0, original_brand_name: "Sem marca" });
  });

  it("caps images at 9 and serializes attributes", () => {
    const manyImages = Array.from({ length: 12 }, (_, i) => `img${i}`);
    const payload = buildItemPayload(
      draft({ attributes: JSON.stringify([{ attribute_id: 1, value: "Azul" }]) }),
      manyImages
    );
    expect((payload.image as { image_id_list: string[] }).image_id_list).toHaveLength(9);
    expect(payload.attribute_list).toEqual([
      { attribute_id: 1, attribute_value_list: [{ value_id: 0, original_value_name: "Azul" }] },
    ]);
  });
});

describe("parseShopeeAttributes", () => {
  it("parses valid entries and drops malformed ones", () => {
    const json = JSON.stringify([
      { attribute_id: 1, value: "Azul" },
      { attribute_id: "not-a-number", value: "x" },
      { attribute_id: 2, value: "" },
      {},
    ]);
    expect(parseShopeeAttributes(json)).toEqual([{ attribute_id: 1, value: "Azul" }]);
  });
});

describe("resolveListingDefaults", () => {
  it("uses settings defaults when nothing is user-edited", () => {
    const result = resolveListingDefaults(
      {},
      { shopeeDefaultWeightKg: 0.4, shopeeDefaultDaysToShip: 3 }
    );
    expect(result).toEqual({ weightKg: 0.4, daysToShip: 3 });
  });

  it("preserves user-edited values instead of the settings default", () => {
    const result = resolveListingDefaults(
      { weightKg: 1.2, daysToShip: 5, userEdited: { weightKg: true, daysToShip: true } },
      { shopeeDefaultWeightKg: 0.4, shopeeDefaultDaysToShip: 3 }
    );
    expect(result).toEqual({ weightKg: 1.2, daysToShip: 5 });
  });
});
