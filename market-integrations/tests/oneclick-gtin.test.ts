import { describe, expect, it } from "vitest";
import { gtinFromProduct, isValidGtin, sanitizeGtinForPublish } from "@/lib/oneclick/gtin";

describe("gtinFromProduct", () => {
  it("preenche GTIN a partir de attributesJson com EAN", () => {
    expect(
      gtinFromProduct({
        attributesJson: JSON.stringify([{ name: "EAN", value: "7891234567895" }]),
      })
    ).toBe("7891234567895");
  });

  it("retorna string vazia sem atributo GTIN/EAN", () => {
    expect(
      gtinFromProduct({
        attributesJson: JSON.stringify([{ name: "Cor", value: "Preto" }]),
      })
    ).toBe("");
  });

  it("prefere draft.attributes quando há dígitos", () => {
    expect(
      gtinFromProduct({
        attributesJson: JSON.stringify([{ name: "EAN", value: "7891234567895" }]),
        draft: {
          attributes: JSON.stringify([{ name: "Código EAN", value: "7890000000009" }]),
        },
      })
    ).toBe("7890000000009");
  });

  it("usa attributesJson quando draft não tem dígitos", () => {
    expect(
      gtinFromProduct({
        attributesJson: JSON.stringify([{ name: "EAN", value: "7891234567895" }]),
        draft: { attributes: JSON.stringify([{ name: "Cor", value: "Azul" }]) },
      })
    ).toBe("7891234567895");
  });
});

describe("sanitizeGtinForPublish", () => {
  it("aceita GTIN com dígito verificador correto", () => {
    expect(isValidGtin("7891234567895")).toBe(true);
    expect(sanitizeGtinForPublish("7891234567895")).toBe("7891234567895");
  });

  it("descarta o placeholder que o ML recusa em vez de derrubar o anúncio", () => {
    expect(isValidGtin("7891234567890")).toBe(false);
    expect(sanitizeGtinForPublish("7891234567890")).toBeNull();
    expect(sanitizeGtinForPublish("787913700041")).toBeNull();
  });

  it("trata vazio/nulo como ausência de GTIN", () => {
    expect(sanitizeGtinForPublish("")).toBeNull();
    expect(sanitizeGtinForPublish(null)).toBeNull();
    expect(sanitizeGtinForPublish("   ")).toBeNull();
  });
});
