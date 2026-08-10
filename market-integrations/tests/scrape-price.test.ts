import { describe, expect, it } from "vitest";
import {
  parseBrlAmount,
  parsePrice,
  parsePriceFromFragment,
  parsePriceFromHtml,
} from "@/lib/scrape/price";

describe("parseBrlAmount", () => {
  it("reads cents after a comma", () => {
    expect(parseBrlAmount("149,00")).toBe(149);
    expect(parseBrlAmount("12,74")).toBe(12.74);
  });

  it("treats dots as thousand separators", () => {
    expect(parseBrlAmount("1.499,90")).toBe(1499.9);
    expect(parseBrlAmount("1.234.567,89")).toBe(1234567.89);
    expect(parseBrlAmount("R$ 1.500")).toBe(1500);
  });

  it("ignores currency symbols and entities", () => {
    expect(parseBrlAmount("R$&nbsp;89,90")).toBe(89.9);
    expect(parseBrlAmount("&#82;&#36;\u00a0149,00")).toBe(149);
  });

  it("returns null without digits", () => {
    expect(parseBrlAmount("Consulte")).toBeNull();
  });
});

describe("parsePriceFromFragment", () => {
  it("prefers the sale price inside <ins> over the old <del> price", () => {
    const fragment = `
      <del><span class="woocommerce-Price-amount"><bdi>R$&nbsp;1.499,90</bdi></span></del>
      <ins><span class="woocommerce-Price-amount"><bdi>R$&nbsp;1.199,90</bdi></span></ins>`;
    const parsed = parsePriceFromFragment(fragment);
    expect(parsed.value).toBe(1199.9);
    expect(parsed.regularPrice).toBe(1499.9);
    expect(parsed.onSale).toBe(true);
    expect(parsed.isRange).toBe(false);
  });

  it("uses the lowest amount of a price range", () => {
    const fragment = `
      <span class="woocommerce-Price-amount"><bdi>R$&nbsp;12,74</bdi></span> &#8211;
      <span class="woocommerce-Price-amount"><bdi>R$&nbsp;12,90</bdi></span>`;
    const parsed = parsePriceFromFragment(fragment);
    expect(parsed).toMatchObject({ value: 12.74, min: 12.74, max: 12.9, isRange: true });
  });

  it("reports not found for an empty price element", () => {
    expect(parsePriceFromFragment("").found).toBe(false);
    expect(parsePriceFromFragment("<bdi></bdi>").found).toBe(false);
  });
});

describe("parsePriceFromHtml", () => {
  it("only looks inside .price containers", () => {
    const html = `
      <p>Frete a partir de R$ 19,90</p>
      <div class="elementor-widget">
        <p class="price"><span class="woocommerce-Price-amount"><bdi>R$&nbsp;249,90</bdi></span></p>
      </div>
      <footer>Parcele em 12x de R$ 9,90</footer>`;
    expect(parsePriceFromHtml(html).value).toBe(249.9);
  });

  it("skips an empty price element and keeps looking", () => {
    const html = `
      <p class="price"></p>
      <span class="price"><span class="woocommerce-Price-amount"><bdi>R$&nbsp;59,90</bdi></span></span>`;
    expect(parsePriceFromHtml(html).value).toBe(59.9);
  });

  it("returns not found when the shop hides prices from guests", () => {
    const parsed = parsePriceFromHtml('<p class="price"></p><p>Entre para ver os preços</p>');
    expect(parsed.found).toBe(false);
    expect(parsed.value).toBe(0);
  });

  it("handles nested spans without closing early", () => {
    const html =
      '<span class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">R$</span>&nbsp;1.899,90</bdi></span></span>';
    expect(parsePriceFromHtml(html).value).toBe(1899.9);
  });
});

describe("parsePrice", () => {
  it("stays compatible with plain text input", () => {
    expect(parsePrice("R$ 89,90")).toBe(89.9);
    expect(parsePrice("R$ 1.234,56")).toBe(1234.56);
    expect(parsePrice("sem preço")).toBe(0);
  });
});
