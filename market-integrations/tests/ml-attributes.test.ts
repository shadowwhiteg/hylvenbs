import { describe, expect, it } from "vitest";
import {
  hasUnitsPerPack,
  inferModelFromTitle,
  isSaleFormatKit,
  serializeAttributesForMl,
  validateGtinRequirement,
} from "@/lib/ml/attributes";
import {
  getGtinFormatError,
  isValidGtinCheckDigit,
  normalizeGtinValue,
  readGtinFromAttributesJson,
  upsertGtinInAttributesJson,
} from "@/lib/ml/gtin-draft";
import { parseGtinPolicy } from "@/lib/ml/category-attributes";
import { buildItemPayload, validateDraftForPublish } from "@/lib/ml/payload";

const fruteiraAttrs = JSON.stringify([
  { name: "Peso", value: "0,000 kg" },
  { name: "Dimensões", value: "29,5 × 10,5 × 29,5 cm" },
  { name: "Marca", value: "ARTHI" },
  { name: "Forma da fruteira", value: "Cesto" },
  { name: "Diâmetro", value: "29,5 cm" },
  { name: "DIMENSOES", value: "29.5cm x 10.5cm x 29.5cm" },
  { name: "NCM", value: "3924.10.00" },
]);

describe("serializeAttributesForMl", () => {
  it("converte Marca → BRAND e ignora NCM/dimensões duplicadas", () => {
    const attrs = serializeAttributesForMl(fruteiraAttrs, {
      title: "Fruteira de Mesa Black Life",
      inferModel: false,
    });
    expect(attrs).toContainEqual({ id: "BRAND", value_name: "ARTHI" });
    expect(attrs).toContainEqual({ id: "FRUIT_BOWL_SHAPE", value_name: "Cesto" });
    expect(attrs).toContainEqual({ id: "DIAMETER", value_name: "29,5 cm" });
    expect(attrs.find((a) => a.id === "NCM")).toBeUndefined();
    expect(attrs.find((a) => a.id === "DIMENSIONS")).toBeUndefined();
  });

  it("infere MODEL a partir do título quando ausente", () => {
    const attrs = serializeAttributesForMl(fruteiraAttrs, {
      title: "Fruteira de Mesa Black Life",
      inferModel: true,
    });
    expect(attrs).toContainEqual({ id: "MODEL", value_name: "Black Life" });
  });

  it("inferModelFromTitle remove tipo genérico e marca", () => {
    expect(inferModelFromTitle("Fruteira de Mesa Black Life", "ARTHI")).toBe(
      "Black Life"
    );
  });

  it("mapeia EAN/código de barras para GTIN normalizado", () => {
    const attrs = serializeAttributesForMl(
      JSON.stringify([{ name: "Código EAN", value: "7893699163605" }])
    );
    expect(attrs).toEqual([{ id: "GTIN", value_name: "7893699163605" }]);
    expect(normalizeGtinValue("7893-6991-6360-5")).toBe("7893699163605");
    expect(isValidGtinCheckDigit("7893699163605")).toBe(true);
    expect(normalizeGtinValue("7891234567890")).toBeNull();
    expect(getGtinFormatError("7891234567890")).toMatch(/Dígito verificador/);
  });

  it("normaliza UNITS_PER_PACK para o número puro, mesmo com texto junto", () => {
    const attrs = serializeAttributesForMl(
      JSON.stringify([
        { name: "Formato de venda", value: "Kit" },
        { name: "Unidades por kit", value: "12 unidades" },
      ])
    );
    expect(attrs).toContainEqual({ id: "UNITS_PER_PACK", value_name: "12" });
  });

  it("descarta UNITS_PER_PACK quando não há nenhum número no valor", () => {
    const attrs = serializeAttributesForMl(
      JSON.stringify([{ name: "Unidades por kit", value: "várias" }])
    );
    expect(attrs.find((a) => a.id === "UNITS_PER_PACK")).toBeUndefined();
  });

  it("adiciona EMPTY_GTIN_REASON quando a categoria permite", () => {
    const policy = parseGtinPolicy([
      { id: "GTIN", tags: { conditional_required: true } },
      { id: "EMPTY_GTIN_REASON", tags: { conditional_required: true } },
    ]);
    const attrs = serializeAttributesForMl("[]", { gtinPolicy: policy });
    expect(attrs).toContainEqual({
      id: "EMPTY_GTIN_REASON",
      value_id: "17055160",
      value_name: "No registrado",
    });
  });

  it("exige GTIN quando a categoria não aceita motivo vazio", () => {
    const policy = parseGtinPolicy([
      { id: "GTIN", tags: { conditional_required: true } },
    ]);
    const attrs = serializeAttributesForMl(fruteiraAttrs, {
      title: "Fruteira de Mesa Black Life",
      gtinPolicy: policy,
    });
    const err = validateGtinRequirement(attrs, policy, fruteiraAttrs);
    expect(err).toMatch(/GTIN/);
    expect(
      validateDraftForPublish(
        {
          title: "Fruteira de Mesa Black Life",
          description: "Desc",
          price: 49.9,
          condition: "new",
          buyingMode: "buy_it_now",
          listingTypeId: "gold_pro",
          categoryId: "MLB271155",
          shippingMode: "me2",
          shippingJson: "{}",
          pictures: JSON.stringify(["https://example.com/a.jpg"]),
          attributes: fruteiraAttrs,
          variations: "[]",
          regulatory: "{}",
          warrantyType: "Garantia do vendedor",
          warrantyTime: "7 dias",
          availableQuantity: 1,
          currencyId: "BRL",
        },
        { gtinPolicy: policy }
      )
    ).toEqual(expect.arrayContaining([expect.stringMatching(/GTIN/)]));
  });
});

describe("gtin draft helpers", () => {
  it("lê e grava GTIN no JSON de características", () => {
    const base = JSON.stringify([{ name: "Marca", value: "ARTHI" }]);
    const updated = upsertGtinInAttributesJson(base, "7893-6991-6360-5");
    expect(readGtinFromAttributesJson(updated)).toBe("7893699163605");
    expect(JSON.parse(updated)).toEqual([
      { name: "Código EAN", value: "7893699163605" },
      { name: "Marca", value: "ARTHI" },
    ]);
    const cleared = upsertGtinInAttributesJson(updated, "");
    expect(readGtinFromAttributesJson(cleared)).toBe("");
    expect(JSON.parse(cleared)).toEqual([{ name: "Marca", value: "ARTHI" }]);
  });
});

describe("buildItemPayload attributes", () => {
  it("envia atributos no formato da API do ML", () => {
    const payload = buildItemPayload({
      title: "Fruteira de Mesa Black Life",
      description: "Desc",
      price: 49.9,
      condition: "new",
      buyingMode: "buy_it_now",
      listingTypeId: "gold_pro",
      categoryId: "MLB271155",
      shippingMode: "me2",
      shippingJson: "{}",
      pictures: JSON.stringify(["https://example.com/a.jpg"]),
      attributes: fruteiraAttrs,
      variations: "[]",
      regulatory: "{}",
      warrantyType: "Garantia do vendedor",
      warrantyTime: "7 dias",
      availableQuantity: 1,
      currencyId: "BRL",
    });

    expect(payload.attributes).toEqual(
      expect.arrayContaining([
        { id: "BRAND", value_name: "ARTHI" },
        { id: "MODEL", value_name: "Black Life" },
        { id: "FRUIT_BOWL_SHAPE", value_name: "Cesto" },
        { id: "DIAMETER", value_name: "29,5 cm" },
      ])
    );
    expect(
      (payload.attributes as Array<{ id?: string; value?: string }>).every(
        (a) => a.id && !("value" in a)
      )
    ).toBe(true);
  });
});

describe("isSaleFormatKit / hasUnitsPerPack", () => {
  it("detects Formato de venda = Kit case-insensitively", () => {
    expect(isSaleFormatKit([{ id: "SALE_FORMAT", value_name: "Kit" }])).toBe(true);
    expect(isSaleFormatKit([{ id: "SALE_FORMAT", value_name: "kit" }])).toBe(true);
    expect(isSaleFormatKit([{ id: "SALE_FORMAT", value_name: "Unidad" }])).toBe(false);
    expect(isSaleFormatKit([])).toBe(false);
  });

  it("only counts Unidades por kit when it has a non-empty value", () => {
    expect(hasUnitsPerPack([{ id: "UNITS_PER_PACK", value_name: "3" }])).toBe(true);
    expect(hasUnitsPerPack([{ id: "UNITS_PER_PACK", value_name: "" }])).toBe(false);
    expect(hasUnitsPerPack([])).toBe(false);
  });
});
