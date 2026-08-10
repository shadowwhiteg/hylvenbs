import type { ScrapedProduct } from "@/lib/sync/merge";
import {
  parseLastPageNumber,
  parseProductDetailFromHtml,
  parseProductSitemapIndex,
  parseProductSitemapUrls,
  parseShopCards,
  slugFromUrl,
  type ShopCard,
} from "@/lib/scrape/parse";
import {
  CookieJar,
  createSession,
  loginWithHttp,
  loginWithPlaywright,
  type ScrapeSession,
} from "@/lib/scrape/session";

export {
  parseAttributesFromHtml,
  parseAttributesFromText,
  extractEanGtinFromText,
  parseGalleryFromHtml,
  parseLastPageNumber,
  parseProductDetailFromHtml,
  parseProductSitemapIndex,
  parseProductSitemapUrls,
  parseShopCards,
  parseStockFromHtml,
  parseStockFromText,
  parseWarranty,
  extractVideoUrlFromHtml,
} from "@/lib/scrape/parse";
export { parseBrlAmount, parsePrice, parsePriceFromHtml } from "@/lib/scrape/price";

export type ScrapeResult = {
  products: ScrapedProduct[];
  warnings: string[];
  stats: {
    pages: number;
    cards: number;
    enriched: number;
    withPrice: number;
    loggedIn: boolean;
    fromSitemap?: number;
  };
};

export type ScrapeOptions = {
  /** Safety net against a broken pagination parser. */
  maxPages?: number;
  /** Parallel detail-page fetches. */
  concurrency?: number;
  /** Pause between detail-page fetches, per worker. */
  delayMs?: number;
  /** Stop after N products (debug / smoke runs). */
  limit?: number;
  /** Skip detail pages and keep only listing data. */
  skipEnrichment?: boolean;
  /** Skip WordPress product sitemap discovery (shop archive only). */
  skipSitemap?: boolean;
  onProgress?: (done: number, total: number) => void;
};

const DEFAULTS = {
  maxPages: 30,
  concurrency: 4,
  delayMs: 150,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function positiveInt(
  explicit: number | undefined,
  fromEnv: string | undefined,
  fallback: number
): number {
  for (const candidate of [explicit, fromEnv ? Number(fromEnv) : undefined]) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate);
    }
  }
  return fallback;
}

function normalizeProductUrl(url: string): string {
  return url.split("?")[0].replace(/\/?$/, "/");
}

function stubCardFromUrl(url: string): ShopCard {
  const sourceUrl = normalizeProductUrl(url);
  const externalId = slugFromUrl(sourceUrl, sourceUrl);
  return {
    externalId,
    sourceUrl,
    title: externalId.replace(/-/g, " "),
    price: {
      value: 0,
      min: 0,
      max: 0,
      isRange: false,
      onSale: false,
      regularPrice: null,
      found: false,
    },
    stock: null,
    sku: null,
    image: null,
    inStock: true,
    categorySlugs: [],
  };
}

function cardToProduct(card: ShopCard): ScrapedProduct {
  return {
    externalId: card.externalId,
    sourceUrl: card.sourceUrl,
    title: card.title,
    costPrice: card.price.found ? card.price.value : 0,
    description: card.title,
    pictures: card.image ? [card.image] : [],
    stock: card.stock ?? (card.inStock ? null : 0),
    videoUrl: null,
    attributes: [],
    sku: card.sku,
    categoryPath: card.categorySlugs.length ? card.categorySlugs.join(" > ") : null,
    warnings: [],
  };
}

/** Walk `/loja/`, `/loja/page/2/`, ... until the pagination is exhausted. */
export async function collectShopCards(
  session: ScrapeSession,
  shopUrl: string,
  options: { maxPages: number; delayMs: number }
): Promise<{ cards: ShopCard[]; pages: number; warnings: string[] }> {
  const warnings: string[] = [];
  const byUrl = new Map<string, ShopCard>();
  const base = shopUrl.replace(/\/$/, "");

  const firstHtml = await session.fetchText(`${base}/`);
  const firstCards = parseShopCards(firstHtml, shopUrl);
  for (const card of firstCards) byUrl.set(normalizeProductUrl(card.sourceUrl), card);

  const lastPage = Math.min(parseLastPageNumber(firstHtml), options.maxPages);
  if (!firstCards.length) warnings.push(`Nenhum produto na primeira página de ${base}/`);

  let pages = 1;
  for (let page = 2; page <= lastPage; page++) {
    let html: string;
    try {
      html = await session.fetchText(`${base}/page/${page}/`);
    } catch (err) {
      warnings.push(
        `Falha ao carregar página ${page}: ${err instanceof Error ? err.message : String(err)}`
      );
      break;
    }

    const cards = parseShopCards(html, shopUrl);
    pages = page;
    if (!cards.length) break;
    for (const card of cards) byUrl.set(normalizeProductUrl(card.sourceUrl), card);
    if (options.delayMs) await sleep(options.delayMs);
  }

  if (lastPage >= options.maxPages) {
    warnings.push(`Limite de ${options.maxPages} páginas atingido; catálogo pode estar incompleto`);
  }

  return { cards: Array.from(byUrl.values()), pages, warnings };
}

/**
 * Discovers every published WooCommerce product via WordPress sitemaps.
 * `/loja/` alone is incomplete on Meu Drop (hidden / catalog-only items).
 */
export async function collectProductUrlsFromSitemap(
  session: ScrapeSession,
  baseUrl: string
): Promise<{ urls: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const base = baseUrl.replace(/\/$/, "");
  let mapUrls: string[] = [];

  try {
    const indexXml = await session.fetchText(`${base}/wp-sitemap.xml`);
    mapUrls = parseProductSitemapIndex(indexXml);
  } catch (err) {
    warnings.push(
      `Falha ao ler wp-sitemap.xml: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!mapUrls.length) {
    mapUrls = [`${base}/wp-sitemap-posts-product-1.xml`];
  }

  const urls = new Set<string>();
  for (const mapUrl of mapUrls) {
    try {
      const xml = await session.fetchText(mapUrl);
      for (const url of parseProductSitemapUrls(xml)) {
        urls.add(normalizeProductUrl(url));
      }
    } catch (err) {
      warnings.push(
        `Falha ao ler sitemap ${mapUrl}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!urls.size) {
    warnings.push("Sitemap de produtos vazio ou inacessível");
  }

  return { urls: Array.from(urls), warnings };
}

/**
 * Shop archive cards plus any product URLs only present in the WP sitemap.
 * Listing data from `/loja/` wins when both sources have the same URL.
 */
export async function collectCatalogCards(
  session: ScrapeSession,
  baseUrl: string,
  shopUrl: string,
  options: { maxPages: number; delayMs: number; skipSitemap?: boolean }
): Promise<{ cards: ShopCard[]; pages: number; fromSitemap: number; warnings: string[] }> {
  const shop = await collectShopCards(session, shopUrl, options);
  const byUrl = new Map(
    shop.cards.map((card) => [normalizeProductUrl(card.sourceUrl), card] as const)
  );
  const warnings = [...shop.warnings];
  let fromSitemap = 0;

  if (!options.skipSitemap) {
    const sitemap = await collectProductUrlsFromSitemap(session, baseUrl);
    warnings.push(...sitemap.warnings);
    for (const url of sitemap.urls) {
      const key = normalizeProductUrl(url);
      if (byUrl.has(key)) continue;
      byUrl.set(key, stubCardFromUrl(key));
      fromSitemap += 1;
    }
    if (fromSitemap) {
      warnings.push(
        `Sitemap acrescentou ${fromSitemap} produto(s) que não aparecem em /loja/ (${byUrl.size} no total)`
      );
    }
  }

  return {
    cards: Array.from(byUrl.values()),
    pages: shop.pages,
    fromSitemap,
    warnings,
  };
}

async function enrichCards(
  session: ScrapeSession,
  cards: ShopCard[],
  options: Required<Pick<ScrapeOptions, "concurrency" | "delayMs">> & {
    onProgress?: ScrapeOptions["onProgress"];
  }
): Promise<{ products: ScrapedProduct[]; warnings: string[] }> {
  const results = new Array<ScrapedProduct>(cards.length);
  const warnings: string[] = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < cards.length) {
      const index = cursor++;
      const card = cards[index];
      const fallback = cardToProduct(card);

      try {
        const html = await session.fetchText(card.sourceUrl);
        const detail = parseProductDetailFromHtml(html, fallback);

        // Listing values win when the detail page could not read them.
        const costPrice = detail.costPrice > 0 ? detail.costPrice : fallback.costPrice;
        const productWarnings = detail.warnings.filter(
          (w) =>
            !(w.startsWith("preço") && costPrice > 0) &&
            !(w.startsWith("estoque") && fallback.stock !== null)
        );

        results[index] = {
          ...detail,
          costPrice,
          stock: detail.stock ?? fallback.stock ?? null,
          sku: detail.sku ?? fallback.sku ?? null,
          categoryPath: detail.categoryPath ?? fallback.categoryPath ?? null,
          warranty: detail.warranty ?? null,
          warnings: productWarnings,
        };

        if (!costPrice) {
          warnings.push(`Preço não encontrado: ${card.sourceUrl}`);
        }
      } catch (err) {
        results[index] = {
          ...fallback,
          warnings: ["página de detalhe não pôde ser lida"],
        };
        warnings.push(
          `Falha ao enriquecer ${card.sourceUrl}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      done += 1;
      options.onProgress?.(done, cards.length);
      if (options.delayMs) await sleep(options.delayMs);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, () => worker())
  );

  return { products: results.filter(Boolean), warnings };
}

export async function scrapeMeuDrop(options: ScrapeOptions = {}): Promise<ScrapeResult> {
  const baseUrl = (process.env.DROP_SITE_URL || "https://meudropbrasil.com").replace(/\/$/, "");
  const shopUrl = `${baseUrl}/loja`;
  const email = process.env.DROP_EMAIL || "";
  const password = process.env.DROP_PASSWORD || "";

  const maxPages = positiveInt(options.maxPages, process.env.DROP_SCRAPE_MAX_PAGES, DEFAULTS.maxPages);
  const concurrency = positiveInt(
    options.concurrency,
    process.env.DROP_SCRAPE_CONCURRENCY,
    DEFAULTS.concurrency
  );
  const delayMs = options.delayMs ?? DEFAULTS.delayMs;

  const warnings: string[] = [];
  const jar = new CookieJar();
  const session = createSession(jar);

  if (email && password) {
    let login = await loginWithHttp(baseUrl, email, password, jar);
    if (!login.ok) {
      warnings.push(`Login HTTP falhou (${login.error}); tentando via navegador`);
      login = await loginWithPlaywright(baseUrl, email, password, jar);
    }
    session.loggedIn = login.ok;
    if (!login.ok) {
      warnings.push(
        `Login no Meu Drop falhou (${login.error}); preços e catálogo completo podem ficar indisponíveis`
      );
    }
  } else {
    warnings.push("DROP_EMAIL/DROP_PASSWORD não configurados; scrape sem login não traz preços");
  }

  const collected = await collectCatalogCards(session, baseUrl, shopUrl, {
    maxPages,
    delayMs,
    skipSitemap: options.skipSitemap,
  });
  warnings.push(...collected.warnings);

  const cards = options.limit ? collected.cards.slice(0, options.limit) : collected.cards;

  if (options.skipEnrichment) {
    const products = cards.map(cardToProduct);
    return {
      products,
      warnings,
      stats: {
        pages: collected.pages,
        cards: cards.length,
        enriched: 0,
        withPrice: products.filter((p) => p.costPrice > 0).length,
        loggedIn: session.loggedIn,
        fromSitemap: collected.fromSitemap,
      },
    };
  }

  const enriched = await enrichCards(session, cards, {
    concurrency,
    delayMs,
    onProgress: options.onProgress,
  });
  warnings.push(...enriched.warnings.slice(0, 20));

  const withPrice = enriched.products.filter((p) => p.costPrice > 0).length;
  if (!enriched.products.length) warnings.push("Nenhum produto encontrado no scrape");
  else if (!withPrice) warnings.push("Nenhum produto veio com preço; verifique as credenciais");

  return {
    products: enriched.products,
    warnings,
    stats: {
      pages: collected.pages,
      cards: cards.length,
      enriched: enriched.products.length,
      withPrice,
      loggedIn: session.loggedIn,
      fromSitemap: collected.fromSitemap,
    },
  };
}

/** Back-compat: listing-only parse used by older callers/tests. */
export function parseProductCardsFromHtml(html: string, baseUrl: string): ScrapedProduct[] {
  return parseShopCards(html, baseUrl).map(cardToProduct);
}
