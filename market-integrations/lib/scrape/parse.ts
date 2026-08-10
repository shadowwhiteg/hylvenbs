import type { ScrapedAttribute, ScrapedProduct } from "@/lib/sync/merge";
import { isValidGtinCheckDigit } from "@/lib/ml/gtin-draft";
import {
  decodeHtmlEntities,
  extractTagBlock,
  findBlock,
  htmlToPlainText,
  stripTags,
} from "@/lib/scrape/html";
import { parsePriceFromFragment, parsePriceFromHtml, type ParsedPrice } from "@/lib/scrape/price";

export type ShopCard = {
  externalId: string;
  sourceUrl: string;
  title: string;
  price: ParsedPrice;
  stock: number | null;
  sku: string | null;
  image: string | null;
  inStock: boolean;
  categorySlugs: string[];
};

export function slugFromUrl(url: string, fallback: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length) return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    /* not an absolute URL */
  }
  return Buffer.from(fallback).toString("base64url").slice(0, 32);
}

/** Highest `/page/N/` reachable from the pagination block (1 when single page). */
export function parseLastPageNumber(html: string): number {
  const pages = Array.from(html.matchAll(/href=["'][^"']*\/page\/(\d+)\/?[^"']*["']/gi))
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  return pages.length ? Math.max(...pages) : 1;
}

/** Product URLs from a WordPress `wp-sitemap-posts-product-N.xml` body. */
export function parseProductSitemapUrls(xml: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const raw = decodeHtmlEntities(match[1].trim());
    if (!/\/produto\//i.test(raw)) continue;
    const normalized = raw.replace(/\/?$/, "/");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

/** Locs of product sitemaps listed in `wp-sitemap.xml` (empty when the index has none). */
export function parseProductSitemapIndex(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi))
    .map((m) => decodeHtmlEntities(m[1].trim()))
    .filter((url) => /wp-sitemap-posts-product/i.test(url));
}

function absoluteUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function pickImage(fragment: string, baseUrl: string): string | null {
  const candidates = Array.from(
    fragment.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi)
  )
    .map((m) => m[1])
    .filter((src) => !src.startsWith("data:"))
    .filter((src) => !/logo|icon|avatar|sprite|placeholder/i.test(src));
  const src = candidates[0];
  return src ? absoluteUrl(decodeHtmlEntities(src), baseUrl) : null;
}

/** Stock rendered by the shop loop / product page ("13 em estoque", "Estoque: 48"). */
export function parseStockFromText(text: string): number | null {
  const clean = decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();

  if (/esgotado|fora de estoque|indispon[ií]vel|out of stock|sem estoque/.test(lower)) {
    return 0;
  }

  const prefixed = clean.match(
    /(?:estoque|dispon[ií]ve(?:l|is)|em estoque|quantity|qty)[^\d-]{0,20}(\d+)/i
  );
  if (prefixed) return Number(prefixed[1]);

  const suffixed = clean.match(/(\d+)\s*(?:em estoque|unidades?|pe[çc]as?|pcs?|itens?)/i);
  if (suffixed) return Number(suffixed[1]);

  const onlyDigits = clean.match(/^\s*(\d+)\s*$/);
  if (onlyDigits) return Number(onlyDigits[1]);

  if (/em estoque|dispon[ií]vel|in stock/.test(lower)) return null;
  return null;
}

/** Parse every product card of a WooCommerce shop archive page. */
export function parseShopCards(html: string, baseUrl: string): ShopCard[] {
  const cards: ShopCard[] = [];
  const seen = new Set<string>();
  const openings = Array.from(
    html.matchAll(/<li[^>]*class=["'][^"']*\bproduct\b[^"']*\btype-product\b[^"']*["'][^>]*>/gi)
  );

  for (const opening of openings) {
    const fragment = extractTagBlock(html, opening.index, "li");
    if (!fragment) continue;

    const hrefMatch = fragment.match(
      /<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*woocommerce-LoopProduct-link[^"']*["']/i
    ) || fragment.match(/<a[^>]+href=["']([^"']*\/produto\/[^"']+)["']/i);
    if (!hrefMatch) continue;

    const sourceUrl = absoluteUrl(decodeHtmlEntities(hrefMatch[1]), baseUrl).split("?")[0];
    if (seen.has(sourceUrl)) continue;

    const titleMatch = fragment.match(
      /<h\d[^>]*class=["'][^"']*woocommerce-loop-product__title[^"']*["'][^>]*>([\s\S]*?)<\/h\d>/i
    );
    const title = titleMatch ? stripTags(titleMatch[1]) : "";
    if (!title) continue;

    seen.add(sourceUrl);

    const priceOpen = fragment.match(/<span[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>/i);
    const price = priceOpen
      ? parsePriceFromFragment(extractTagBlock(fragment, priceOpen.index ?? 0, "span"))
      : parsePriceFromHtml(fragment);

    const stockText = fragment.match(
      /<div[^>]*class=["'][^"']*wc-loop-stock[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    )?.[1];
    const classes = opening[0];

    cards.push({
      externalId: slugFromUrl(sourceUrl, title),
      sourceUrl,
      title,
      price,
      stock: stockText ? parseStockFromText(stripTags(stockText)) : null,
      sku: fragment.match(/data-product_sku=["']([^"']*)["']/i)?.[1]?.trim() || null,
      image: pickImage(fragment, baseUrl),
      inStock: !/\boutofstock\b/i.test(classes),
      categorySlugs: Array.from(classes.matchAll(/product_cat-([a-z0-9_-]+)/gi)).map(
        (m) => m[1]
      ),
    });
  }

  return cards;
}

/** WooCommerce "Informação adicional" table (th/td rows). */
export function parseAttributesFromHtml(html: string): ScrapedAttribute[] {
  const attrs: ScrapedAttribute[] = [];
  const seen = new Set<string>();

  const table =
    findBlock(html, /<table[^>]*class=["'][^"']*shop_attributes[^"']*["'][^>]*>/i, "table") ??
    findBlock(
      html,
      /<table[^>]*class=["'][^"']*woocommerce-product-attributes[^"']*["'][^>]*>/i,
      "table"
    ) ??
    html;

  for (const row of table.matchAll(
    /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi
  )) {
    const name = stripTags(row[1]).replace(/:$/, "").trim();
    const value = stripTags(row[2]);
    const key = name.toLowerCase();
    if (!name || !value || seen.has(key)) continue;
    seen.add(key);
    attrs.push({ name, value });
  }

  return attrs;
}

const KEY_VALUE_LINE = /^([A-Za-zÀ-ÿ0-9º°/\s.()-]{2,40}?)\s*[:–-]\s*(.+)$/;
const NOISE_KEYS = /^(descri[çc][ãa]o|caracter[íi]sticas?( principais)?|obs|observa[çc][õo]es)$/i;
const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

const EAN_GTIN_NEAR_DIGITS_RE =
  /\b(?:(?:c[óo]digo\s+)?(?:ean|gtin|upc)|c[óo]digo\s+de\s+barras?|barcode)\b[^\d]{0,40}(\d[\d\s.\-]{6,22}\d)/gi;

function normalizeAttrKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GTIN_ATTR_KEYS = new Set([
  "gtin",
  "ean",
  "upc",
  "codigo de barras",
  "codigo de barra",
  "codigo ean",
  "codigo universal",
  "barcode",
]);

function isGtinAttrName(name: string): boolean {
  return GTIN_ATTR_KEYS.has(normalizeAttrKey(name));
}

function gtinDigitsFromValue(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return VALID_GTIN_LENGTHS.has(digits.length) ? digits : null;
}

function pickPreferredGtin(candidates: string[]): string | null {
  if (!candidates.length) return null;
  return candidates.find((c) => isValidGtinCheckDigit(c)) ?? candidates[0] ?? null;
}

/**
 * Find EAN/GTIN/UPC / código de barras in free text (multiline or prose).
 * Prefers a candidate that passes the GS1 check digit; falls back to length-valid digits.
 */
export function extractEanGtinFromText(text: string): string | null {
  if (!text) return null;
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(EAN_GTIN_NEAR_DIGITS_RE)) {
    const digits = gtinDigitsFromValue(match[1] ?? "");
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    candidates.push(digits);
  }

  return pickPreferredGtin(candidates);
}

/** Keep a single canonical `{ name: "EAN", value }` — first valid wins; drop synonym rows. */
function normalizeEanAttributes(attrs: ScrapedAttribute[]): ScrapedAttribute[] {
  let eanValue: string | null = null;
  const out: ScrapedAttribute[] = [];

  for (const attr of attrs) {
    if (!isGtinAttrName(attr.name)) {
      out.push(attr);
      continue;
    }
    if (eanValue) continue;
    const digits =
      gtinDigitsFromValue(attr.value) ??
      extractEanGtinFromText(`${attr.name}: ${attr.value}`);
    if (!digits) continue;
    eanValue = digits;
    out.push({ name: "EAN", value: digits });
  }

  return out;
}

/** Extract "Nome: Valor" lines (short description bullet lists) as attributes. */
export function parseAttributesFromText(text: string): ScrapedAttribute[] {
  const attrs: ScrapedAttribute[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/^[•*\-\u2022]\s*/, "").trim();
    if (!line || line.length > 160) continue;

    const lineEan = extractEanGtinFromText(line);
    if (lineEan) {
      if (!seen.has("ean")) {
        seen.add("ean");
        attrs.push({ name: "EAN", value: lineEan });
      }
      continue;
    }

    const ncm = line.match(/\bncm\b[^\d]{0,10}([\d.]{8,12})/i);
    if (ncm) {
      if (!seen.has("ncm")) {
        seen.add("ncm");
        attrs.push({ name: "NCM", value: ncm[1] });
      }
      continue;
    }

    const kv = line.match(KEY_VALUE_LINE);
    if (!kv) continue;
    const name = kv[1].trim();
    const value = kv[2].trim();
    if (isGtinAttrName(name)) {
      if (seen.has("ean")) continue;
      const digits = gtinDigitsFromValue(value);
      if (!digits) continue;
      seen.add("ean");
      attrs.push({ name: "EAN", value: digits });
      continue;
    }
    const key = name.toLowerCase();
    if (!value || value.length > 120 || NOISE_KEYS.test(name) || seen.has(key)) continue;
    if (!/[A-Za-zÀ-ÿ]/.test(name)) continue;
    seen.add(key);
    attrs.push({ name, value });
  }

  // Prose / long lines that skip the ≤160 filter still yield an EAN when labelled.
  if (!seen.has("ean")) {
    const proseEan = extractEanGtinFromText(text);
    if (proseEan) {
      seen.add("ean");
      attrs.push({ name: "EAN", value: proseEan });
    }
  }

  return attrs;
}

/**
 * ML's WARRANTY_TIME sale term only accepts "<number> <dias|meses|anos>"
 * (e.g. "90 dias") — anything else, even a leading match with trailing
 * words ("30 dias contra defeitos de fabricação"), is rejected outright.
 */
function normalizeWarrantyValue(raw: string): string | null {
  const match = raw.match(/(\d{1,3})\s*(dias?|meses?|m[êe]s|anos?)/i);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  const normalizedUnit = /^dia/.test(unit) ? "dias" : /^m[êe]s/.test(unit) ? "meses" : "anos";
  return `${match[1]} ${normalizedUnit}`;
}

/**
 * Warranty declared by the supplier, e.g. "12 meses" / "3 meses de garantia".
 * Returns null so the caller can fall back to the seller's default warranty.
 */
export function parseWarranty(
  attributes: ScrapedAttribute[],
  text: string
): string | null {
  const fromAttribute = attributes.find((a) => /garantia/i.test(a.name))?.value;
  const normalizedAttribute = fromAttribute ? normalizeWarrantyValue(fromAttribute) : null;
  if (normalizedAttribute) return normalizedAttribute;

  const match = text.match(
    /garantia[^.\n]{0,20}?(\d{1,3})\s*(dias?|meses?|m[êe]s|anos?)/i
  ) ?? text.match(/(\d{1,3})\s*(dias?|meses?|anos?)\s+de\s+garantia/i);
  if (!match) return null;

  return `${match[1]} ${match[2].toLowerCase()}`;
}

function galleryBlock(html: string): string | null {
  return findBlock(
    html,
    /<div[^>]*class=["'][^"']*woocommerce-product-gallery__wrapper[^"']*["'][^>]*>/i,
    "div"
  );
}

/** Stock rendered on a WooCommerce product detail page (`<p class="stock">`). */
export function parseStockFromHtml(html: string): number | null {
  const stockText =
    html.match(/<p[^>]*class=["'][^"']*\bstock\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  const outOfStock = /\bout-of-stock\b/i.test(html.match(/class=["'][^"']*\bstock\b[^"']*["']/i)?.[0] ?? "");
  return stockText ? parseStockFromText(stripTags(stockText)) : outOfStock ? 0 : null;
}

/** Full-size gallery images, largest variant first, thumbnails removed. */
export function parseGalleryFromHtml(html: string, baseUrl: string): string[] {
  const block = galleryBlock(html) ?? html;
  const urls: string[] = [];

  const push = (raw: string) => {
    const url = absoluteUrl(decodeHtmlEntities(raw).trim(), baseUrl);
    if (!/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) return;
    if (/logo|sprite|placeholder|webp-express/i.test(url)) return;
    if (!urls.includes(url)) urls.push(url);
  };

  for (const m of block.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of block.matchAll(/data-large_image=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of block.matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi)) {
    if (!m[1].startsWith("data:")) push(m[1]);
  }

  // Drop resized duplicates (foo-300x300.jpg) when the original is present.
  const originals = new Set(urls.filter((u) => !/-\d{2,4}x\d{2,4}\.[a-z]+$/i.test(u)));
  const deduped = urls.filter((url) => {
    const original = url.replace(/-\d{2,4}x\d{2,4}(\.[a-z]+)$/i, "$1");
    return original === url || !originals.has(original);
  });

  return deduped.slice(0, 12);
}

/**
 * Product video only: the gallery `<video>`/`<source>` or an embedded
 * YouTube/Vimeo iframe. Plain links are ignored so the site's own social
 * media links in the footer never end up attached to a product.
 */
export function extractVideoUrlFromHtml(html: string, baseUrl?: string): string | null {
  const block = galleryBlock(html) ?? html;
  const resolve = (src: string) =>
    baseUrl ? absoluteUrl(decodeHtmlEntities(src), baseUrl) : decodeHtmlEntities(src);

  const source = block.match(/<source[^>]+src=["']([^"']+\.(?:mp4|webm|mov)[^"']*)["']/i);
  if (source) return resolve(source[1]);

  const videoTag = block.match(/<video[^>]+src=["']([^"']+)["']/i);
  if (videoTag) return resolve(videoTag[1]);

  const iframe = html.match(
    /<iframe[^>]+src=["']([^"']*(?:youtube\.com\/embed|youtu\.be|player\.vimeo\.com)[^"']*)["']/i
  );
  if (iframe) return decodeHtmlEntities(iframe[1]);

  return null;
}

function extractDescription(html: string): { short: string; long: string } {
  const shortBlock = findBlock(
    html,
    /<div[^>]*class=["'][^"']*woocommerce-product-details__short-description[^"']*["'][^>]*>/i,
    "div"
  );
  const longBlock =
    findBlock(html, /<div[^>]*id=["']tab-description["'][^>]*>/i, "div") ??
    findBlock(
      html,
      /<div[^>]*class=["'][^"']*woocommerce-Tabs-panel--description[^"']*["'][^>]*>/i,
      "div"
    );

  const long = longBlock ? htmlToPlainText(longBlock).replace(/^Descri[çc][ãa]o\s*/i, "") : "";
  return { short: shortBlock ? htmlToPlainText(shortBlock) : "", long };
}

export type ParsedDetail = ScrapedProduct & { warnings: string[] };

/** Parse an enriched product detail page (pure; no Playwright needed). */
export function parseProductDetailFromHtml(
  html: string,
  base: Pick<ScrapedProduct, "externalId" | "sourceUrl" | "title" | "costPrice" | "description" | "pictures"> &
    Partial<ScrapedProduct>
): ParsedDetail {
  const warnings: string[] = [];
  const baseUrl = base.sourceUrl;

  const titleMatch =
    html.match(/<h\d[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h\d>/i) ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const pageTitle = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  const title =
    (titleMatch ? stripTags(titleMatch[1]) : "") ||
    (pageTitle ? stripTags(pageTitle).split(/\s+[–|-]\s+/)[0] : "") ||
    base.title;
  if (!titleMatch) warnings.push("título não encontrado no HTML do produto");

  const price = parsePriceFromHtml(html);
  if (!price.found) {
    warnings.push("preço não encontrado (produto pode exigir login ou estar sem preço)");
  } else if (price.isRange) {
    warnings.push(
      `preço em faixa (R$ ${price.min.toFixed(2)} – R$ ${price.max.toFixed(2)}); usando o menor`
    );
  }

  const { short, long } = extractDescription(html);
  const description = [long, short].filter(Boolean).join("\n\n").trim() || base.description;
  if (!long && !short) warnings.push("descrição não encontrada");

  const pictures = parseGalleryFromHtml(html, baseUrl);
  if (!pictures.length) warnings.push("nenhuma imagem encontrada na galeria");

  const stock = parseStockFromHtml(html);
  if (stock === null) warnings.push("estoque não encontrado");

  const tableAttributes = parseAttributesFromHtml(html);
  const textAttributes = parseAttributesFromText([short, long].filter(Boolean).join("\n\n"));
  const attributes = normalizeEanAttributes([...tableAttributes, ...textAttributes].reduce<ScrapedAttribute[]>(
    (acc, attr) => {
      if (!acc.some((a) => a.name.toLowerCase() === attr.name.toLowerCase())) {
        acc.push(attr);
      }
      return acc;
    },
    []
  ));
  if (!attributes.length) warnings.push("nenhuma característica encontrada");

  const sku =
    stripTags(html.match(/<span[^>]*class=["']sku["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "") ||
    base.sku ||
    null;

  const categoriesBlock = findBlock(
    html,
    /<span[^>]*class=["'][^"']*posted_in[^"']*["'][^>]*>/i,
    "span"
  );
  const categories = categoriesBlock
    ? Array.from(categoriesBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)).map((m) => stripTags(m[1]))
    : [];

  const videoUrl = extractVideoUrlFromHtml(html, baseUrl);

  const weight = tableAttributes.find((a) => /^peso$/i.test(a.name))?.value;
  const dimensions = tableAttributes.find((a) => /^dimens/i.test(a.name))?.value;
  const warranty = parseWarranty(attributes, `${short}\n${long}`) ?? base.warranty ?? null;

  return {
    ...base,
    title: title || base.title,
    description,
    costPrice: price.found ? price.value : base.costPrice,
    pictures: pictures.length ? pictures : base.pictures,
    stock: stock ?? base.stock ?? null,
    videoUrl,
    attributes,
    sku,
    categoryPath: categories.length ? categories.join(" > ") : base.categoryPath ?? null,
    warranty,
    extraInfo: {
      shortDescription: short || undefined,
      categories: categories.length ? categories : undefined,
      weight,
      dimensions,
      priceIsRange: price.isRange || undefined,
      priceMin: price.isRange ? price.min : undefined,
      priceMax: price.isRange ? price.max : undefined,
      regularPrice: price.regularPrice ?? undefined,
      onSale: price.onSale || undefined,
    },
    warnings,
  };
}
