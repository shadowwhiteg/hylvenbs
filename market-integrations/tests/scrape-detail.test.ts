import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  extractEanGtinFromText,
  extractVideoUrlFromHtml,
  parseAttributesFromHtml,
  parseAttributesFromText,
  parseGalleryFromHtml,
  parseProductDetailFromHtml,
  parseStockFromText,
  parseWarranty,
} from "@/lib/scrape/meudrop";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf8");
}

const detail = fixture("meudrop-product-detail.html");
const sale = fixture("meudrop-product-sale.html");
const range = fixture("meudrop-product-range.html");
const eanLong = fixture("meudrop-product-ean-long.html");
const eanBarcodeTable = fixture("meudrop-product-ean-barcode-table.html");

const base = {
  externalId: "fone-bluetooth",
  sourceUrl: "https://meudropbrasil.com/produto/fone-bluetooth/",
  title: "fallback",
  costPrice: 1,
  description: "fallback",
  pictures: [],
};

describe("parseStockFromText", () => {
  it("parses estoque N", () => {
    expect(parseStockFromText("Estoque: 12 unidades")).toBe(12);
  });

  it("parses the single product page wording", () => {
    expect(parseStockFromText("13 em estoque")).toBe(13);
  });

  it("detects esgotado", () => {
    expect(parseStockFromText("Produto esgotado")).toBe(0);
    expect(parseStockFromText("Fora de estoque")).toBe(0);
  });

  it("returns null when the quantity is not published", () => {
    expect(parseStockFromText("Em estoque")).toBeNull();
    expect(parseStockFromText("")).toBeNull();
  });
});

describe("parseProductDetailFromHtml", () => {
  it("extracts stock, video, attributes and description from fixture", () => {
    const parsed = parseProductDetailFromHtml(detail, base);

    expect(parsed.title).toContain("Fone Bluetooth");
    expect(parsed.costPrice).toBe(89.9);
    expect(parsed.stock).toBe(12);
    expect(parsed.videoUrl).toContain("youtube");
    expect(parsed.attributes?.length).toBeGreaterThanOrEqual(2);
    expect(parsed.attributes?.find((a) => a.name === "Cor")?.value).toBe("Preto");
    expect(parsed.description).toMatch(/cancelamento/i);
    expect(parsed.pictures.length).toBeGreaterThanOrEqual(1);
  });

  it("reads sku, category path and the long description tab", () => {
    const parsed = parseProductDetailFromHtml(detail, base);
    expect(parsed.sku).toBe("FONEPROMAX");
    expect(parsed.categoryPath).toBe("Áudio > Fones");
    expect(parsed.description).toMatch(/drivers de 40 mm/);
    expect(parsed.warnings).toEqual([]);
  });

  it("keeps only full-size gallery images", () => {
    const parsed = parseProductDetailFromHtml(detail, base);
    expect(parsed.pictures).toEqual([
      "https://cdn.example.com/fone-1.jpg",
      "https://cdn.example.com/fone-2.jpg",
    ]);
  });

  it("uses the sale price, not the crossed-out one", () => {
    const parsed = parseProductDetailFromHtml(sale, {
      ...base,
      externalId: "air-fryer",
      sourceUrl: "https://meudropbrasil.com/produto/air-fryer/",
    });
    expect(parsed.costPrice).toBe(1199.9);
    expect(parsed.extraInfo?.regularPrice).toBe(1499.9);
    expect(parsed.extraInfo?.onSale).toBe(true);
    expect(parsed.stock).toBe(7);
  });

  it("picks the gallery mp4 as the product video", () => {
    const parsed = parseProductDetailFromHtml(sale, base);
    expect(parsed.videoUrl).toBe(
      "https://meudropbrasil.com/wp-content/uploads/2024/06/air-fryer-demo.mp4"
    );
  });

  it("derives attributes from the short description when there is no table", () => {
    const parsed = parseProductDetailFromHtml(sale, base);
    const names = (parsed.attributes ?? []).map((a) => a.name);
    expect(names).toContain("Marca");
    expect(names).toContain("Voltagem");
    expect(parsed.attributes?.find((a) => a.name === "EAN")?.value).toBe("7899876543210");
    expect(parsed.attributes?.find((a) => a.name === "NCM")?.value).toBe("85166000");
  });

  it("warns and uses the lowest price for variable products", () => {
    const parsed = parseProductDetailFromHtml(range, base);
    expect(parsed.costPrice).toBe(12.74);
    expect(parsed.stock).toBe(0);
    expect(parsed.extraInfo?.priceIsRange).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("faixa"))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("característica"))).toBe(true);
  });

  it("warns instead of guessing when the price is hidden for guests", () => {
    const guest = detail.replace(
      /<p class="price">[\s\S]*?<\/p>/,
      '<p class="price"></p>'
    );
    const parsed = parseProductDetailFromHtml(guest, base);
    expect(parsed.costPrice).toBe(base.costPrice);
    expect(parsed.warnings.some((w) => w.startsWith("preço"))).toBe(true);
  });

  it("extracts EAN from the long description when short has none", () => {
    const parsed = parseProductDetailFromHtml(eanLong, {
      ...base,
      externalId: "caneca-termica",
      sourceUrl: "https://meudropbrasil.com/produto/caneca-termica/",
    });
    expect(parsed.attributes?.find((a) => a.name === "EAN")?.value).toBe("7893699163605");
    expect(parsed.attributes?.filter((a) => /^ean$/i.test(a.name))).toHaveLength(1);
    expect(parsed.description).toMatch(/código de barras/i);
  });

  it("normalises 'Código de barras' from Informação adicional to EAN", () => {
    const parsed = parseProductDetailFromHtml(eanBarcodeTable, {
      ...base,
      externalId: "garrafa-squeeze",
      sourceUrl: "https://meudropbrasil.com/produto/garrafa-squeeze/",
    });
    expect(parsed.attributes?.find((a) => a.name === "EAN")?.value).toBe("7891234567895");
    expect(parsed.attributes?.some((a) => /c[óo]digo de barras/i.test(a.name))).toBe(false);
    expect(parsed.attributes?.filter((a) => /^ean$/i.test(a.name))).toHaveLength(1);
    expect(parsed.attributes?.find((a) => a.name === "Cor")?.value).toBe("Azul");
  });
});

describe("parseWarranty", () => {
  it("prefers a warranty attribute", () => {
    expect(parseWarranty([{ name: "Garantia", value: "12 meses" }], "")).toBe("12 meses");
  });

  it("reads the warranty from free text", () => {
    expect(parseWarranty([], "Garantia de 3 meses contra defeitos de fábrica")).toBe(
      "3 meses"
    );
    expect(parseWarranty([], "Produto com 1 ano de garantia")).toBe("1 ano");
  });

  it("returns null so the seller default applies", () => {
    expect(parseWarranty([], "Produto novo na caixa")).toBeNull();
  });

  it("strips trailing words from a warranty attribute so only <number> <unit> survives", () => {
    expect(
      parseWarranty([{ name: "Garantia", value: "30 dias contra defeitos de fabricação" }], "")
    ).toBe("30 dias");
    expect(parseWarranty([{ name: "Garantia", value: "30 dias com NF" }], "")).toBe("30 dias");
    expect(parseWarranty([{ name: "Garantia", value: "30 dias sem nota fiscal" }], "")).toBe(
      "30 dias"
    );
  });

  it("falls back to free text / null when the attribute has no number+unit at all", () => {
    expect(
      parseWarranty(
        [
          {
            name: "Garantia",
            value: "Envio imediato para todo o Brasil com Nota Fiscal e Garantia",
          },
        ],
        "Produto com 1 ano de garantia"
      )
    ).toBe("1 ano");
    expect(
      parseWarranty([{ name: "Garantia", value: "Produto descartável – sem garantia" }], "")
    ).toBeNull();
  });
});

describe("extractVideoUrlFromHtml", () => {
  it("finds the embedded youtube iframe", () => {
    expect(extractVideoUrlFromHtml(detail)).toContain("youtube.com/embed");
  });

  it("ignores the site's own social media links in the footer", () => {
    const noProductVideo = detail.replace(/<iframe[\s\S]*?<\/iframe>/, "");
    expect(extractVideoUrlFromHtml(noProductVideo)).toBeNull();
  });
});

describe("parseAttributesFromHtml", () => {
  it("parses the 'Informação adicional' table", () => {
    const attrs = parseAttributesFromHtml(detail);
    expect(attrs.some((a) => a.name === "Marca" && a.value === "DropBrand")).toBe(true);
    expect(attrs.find((a) => a.name === "Dimensões")?.value).toBe("35,0 × 19,5 × 29,0 cm");
  });
});

describe("extractEanGtinFromText", () => {
  it("reads EAN / GTIN / código de barras / barcode labels", () => {
    expect(extractEanGtinFromText("Código EAN: 7893699163605")).toBe("7893699163605");
    expect(extractEanGtinFromText("GTIN 7891234567895")).toBe("7891234567895");
    expect(extractEanGtinFromText("código de barra 7893699163605")).toBe("7893699163605");
    expect(extractEanGtinFromText("barcode: 7891234567895")).toBe("7891234567895");
  });

  it("works in multiline prose and prefers a valid check digit", () => {
    const prose =
      "Detalhes do item.\nO fabricante imprime o código de barras 7893699163605 na caixa.\nOutras infos.";
    expect(extractEanGtinFromText(prose)).toBe("7893699163605");
    expect(
      extractEanGtinFromText("EAN 7899876543210 e também EAN 7893699163605")
    ).toBe("7893699163605");
  });
});

describe("parseAttributesFromText", () => {
  it("reads bullet key/value lines and normalises EAN/NCM", () => {
    const attrs = parseAttributesFromText(
      "Idade: Criança\nGênero: FEMININO\nCor: Rosa\nNCM 95067000\nCódigo EAN: 7893699163605"
    );
    expect(attrs).toEqual([
      { name: "Idade", value: "Criança" },
      { name: "Gênero", value: "FEMININO" },
      { name: "Cor", value: "Rosa" },
      { name: "NCM", value: "95067000" },
      { name: "EAN", value: "7893699163605" },
    ]);
  });

  it("normalises 'Código de barras' key/value to EAN", () => {
    const attrs = parseAttributesFromText("Código de barras: 7891234567895\nCor: Azul");
    expect(attrs.find((a) => a.name === "EAN")?.value).toBe("7891234567895");
    expect(attrs.some((a) => /barras/i.test(a.name))).toBe(false);
  });
});

describe("parseGalleryFromHtml", () => {
  it("resolves relative urls against the product page", () => {
    const html =
      '<div class="woocommerce-product-gallery__wrapper"><div><a href="/wp-content/uploads/a.jpg"><img src="/wp-content/uploads/a-300x300.jpg"></a></div></div>';
    expect(parseGalleryFromHtml(html, "https://meudropbrasil.com/produto/x/")).toEqual([
      "https://meudropbrasil.com/wp-content/uploads/a.jpg",
    ]);
  });
});
