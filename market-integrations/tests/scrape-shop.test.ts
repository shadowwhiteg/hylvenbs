import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseLastPageNumber, parseProductSitemapUrls, parseShopCards } from "@/lib/scrape/parse";
import { collectCatalogCards, collectShopCards } from "@/lib/scrape/meudrop";
import { CookieJar, type ScrapeSession } from "@/lib/scrape/session";

const shopHtml = readFileSync(join(__dirname, "fixtures/meudrop-shop-page.html"), "utf8");
const BASE = "https://meudropbrasil.com/loja";

describe("parseLastPageNumber", () => {
  it("returns the highest page of the WooCommerce pagination", () => {
    expect(parseLastPageNumber(shopHtml)).toBe(8);
  });

  it("returns 1 without pagination", () => {
    expect(parseLastPageNumber("<ul class='products'></ul>")).toBe(1);
  });
});

describe("parseShopCards", () => {
  const cards = parseShopCards(shopHtml, BASE);

  it("reads every card of the page", () => {
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.externalId)).toEqual([
      "liquidificador-blq1280p",
      "smart-tv-50-4k",
      "chinelo-solemar-feminino-2",
    ]);
  });

  it("reads title, price, stock and sku", () => {
    expect(cards[0]).toMatchObject({
      title: "Liquidificador BLQ1280P Com 4 Lâminas Inox 2,7L 1150W Cor Preto Britânia",
      stock: 48,
      sku: "BLQ1280P",
      inStock: true,
    });
    expect(cards[0].price.value).toBe(149);
    expect(cards[0].image).toBe(
      "https://meudropbrasil.com/wp-content/uploads/2026/02/liq-300x300.png"
    );
  });

  it("uses the sale price of a discounted card", () => {
    expect(cards[1].price.value).toBe(1899.9);
    expect(cards[1].price.regularPrice).toBe(2499);
  });

  it("flags out-of-stock cards and range prices", () => {
    expect(cards[2].inStock).toBe(false);
    expect(cards[2].price).toMatchObject({ value: 12.74, isRange: true });
  });

  it("keeps the product categories from the css classes", () => {
    expect(cards[0].categorySlugs).toEqual(["mastermind", "mentorado"]);
  });
});

function sessionFor(pages: Record<string, string>): ScrapeSession {
  return {
    jar: new CookieJar(),
    loggedIn: true,
    async fetchText(url: string) {
      const html = pages[url];
      if (!html) throw new Error(`HTTP 404 em ${url}`);
      return html;
    },
  };
}

function pageWith(slug: string, lastPage: number): string {
  return `<ul class="products">
    <li class="product type-product status-publish instock">
      <a href="https://meudropbrasil.com/produto/${slug}/" class="woocommerce-LoopProduct-link">
        <h2 class="woocommerce-loop-product__title">${slug}</h2>
        <span class="price"><bdi>R$&nbsp;10,00</bdi></span>
      </a>
    </li>
  </ul>
  <a class="page-numbers" href="https://meudropbrasil.com/loja/page/${lastPage}/">${lastPage}</a>`;
}

describe("collectShopCards", () => {
  it("follows every pagination page until the end", async () => {
    const session = sessionFor({
      [`${BASE}/`]: pageWith("p1", 3),
      [`${BASE}/page/2/`]: pageWith("p2", 3),
      [`${BASE}/page/3/`]: pageWith("p3", 3),
    });

    const result = await collectShopCards(session, BASE, { maxPages: 30, delayMs: 0 });
    expect(result.cards.map((c) => c.externalId)).toEqual(["p1", "p2", "p3"]);
    expect(result.pages).toBe(3);
    expect(result.warnings).toEqual([]);
  });

  it("stops early on an empty page", async () => {
    const session = sessionFor({
      [`${BASE}/`]: pageWith("p1", 5),
      [`${BASE}/page/2/`]: '<ul class="products"></ul>',
    });

    const result = await collectShopCards(session, BASE, { maxPages: 30, delayMs: 0 });
    expect(result.cards).toHaveLength(1);
  });

  it("respects the page cap and warns", async () => {
    const session = sessionFor({
      [`${BASE}/`]: pageWith("p1", 99),
      [`${BASE}/page/2/`]: pageWith("p2", 99),
    });

    const result = await collectShopCards(session, BASE, { maxPages: 2, delayMs: 0 });
    expect(result.cards).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/Limite de 2 páginas/);
  });

  it("warns and keeps what it got when a page fails", async () => {
    const session = sessionFor({ [`${BASE}/`]: pageWith("p1", 4) });
    const result = await collectShopCards(session, BASE, { maxPages: 30, delayMs: 0 });
    expect(result.cards).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/Falha ao carregar página 2/);
  });

  it("deduplicates products repeated across pages", async () => {
    const session = sessionFor({
      [`${BASE}/`]: pageWith("same", 2),
      [`${BASE}/page/2/`]: pageWith("same", 2),
    });
    const result = await collectShopCards(session, BASE, { maxPages: 30, delayMs: 0 });
    expect(result.cards).toHaveLength(1);
  });
});

describe("parseProductSitemapUrls", () => {
  it("keeps only /produto/ locs and normalizes trailing slash", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://meudropbrasil.com/produto/alpha</loc></url>
        <url><loc>https://meudropbrasil.com/produto/beta/</loc></url>
        <url><loc>https://meudropbrasil.com/loja/</loc></url>
      </urlset>`;
    expect(parseProductSitemapUrls(xml)).toEqual([
      "https://meudropbrasil.com/produto/alpha/",
      "https://meudropbrasil.com/produto/beta/",
    ]);
  });
});

describe("collectCatalogCards", () => {
  it("merges sitemap-only products into the shop archive", async () => {
    const session = sessionFor({
      [`${BASE}/`]: pageWith("shop-only", 1),
      "https://meudropbrasil.com/wp-sitemap.xml":
        "<sitemapindex><sitemap><loc>https://meudropbrasil.com/wp-sitemap-posts-product-1.xml</loc></sitemap></sitemapindex>",
      "https://meudropbrasil.com/wp-sitemap-posts-product-1.xml": `<?xml version="1.0"?>
        <urlset>
          <url><loc>https://meudropbrasil.com/produto/shop-only/</loc></url>
          <url><loc>https://meudropbrasil.com/produto/sitemap-only/</loc></url>
        </urlset>`,
    });

    const result = await collectCatalogCards(session, "https://meudropbrasil.com", BASE, {
      maxPages: 30,
      delayMs: 0,
    });
    expect(result.cards.map((c) => c.externalId).sort()).toEqual(["shop-only", "sitemap-only"]);
    expect(result.fromSitemap).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/Sitemap acrescentou 1/);
  });
});
