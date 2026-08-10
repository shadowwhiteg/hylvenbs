import { decodeHtmlEntities, extractTagBlock } from "@/lib/scrape/html";

export type ParsedPrice = {
  /** Current price the buyer pays (sale price when on sale, lowest of a range). */
  value: number;
  min: number;
  max: number;
  isRange: boolean;
  onSale: boolean;
  /** Original ("de") price when the product is on sale. */
  regularPrice: number | null;
  found: boolean;
};

const EMPTY_PRICE: ParsedPrice = {
  value: 0,
  min: 0,
  max: 0,
  isRange: false,
  onSale: false,
  regularPrice: null,
  found: false,
};

/**
 * Parse a single pt-BR money token ("1.234,56", "149,00", "1.500").
 * The last separator only counts as decimal when 1-2 digits follow it,
 * so thousand separators are never mistaken for cents.
 */
export function parseBrlAmount(raw: string): number | null {
  const cleaned = decodeHtmlEntities(raw).replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return null;

  const sepIndex = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  const decimals = sepIndex >= 0 ? cleaned.length - sepIndex - 1 : 0;

  const normalized =
    sepIndex >= 0 && decimals >= 1 && decimals <= 2
      ? `${cleaned.slice(0, sepIndex).replace(/[.,]/g, "")}.${cleaned.slice(sepIndex + 1)}`
      : cleaned.replace(/[.,]/g, "");

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Back-compat helper: first money value found in a text blob, 0 when absent. */
export function parsePrice(text: string): number {
  const parsed = parsePriceText(text);
  return parsed.found ? parsed.value : 0;
}

/** All money tokens of a plain-text blob, in document order. */
function amountsFromText(text: string): number[] {
  const decoded = decodeHtmlEntities(text);
  const tokens = decoded.match(/R\$\s*[\d.,]*\d/gi) ?? decoded.match(/\d[\d.,]*/g) ?? [];
  return tokens
    .map((token) => parseBrlAmount(token))
    .filter((n): n is number => n !== null && n > 0);
}

function fromAmounts(
  amounts: number[],
  extra: Partial<ParsedPrice> = {}
): ParsedPrice {
  if (!amounts.length) return { ...EMPTY_PRICE, ...extra };
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  return {
    value: min,
    min,
    max,
    isRange: min !== max,
    onSale: false,
    regularPrice: null,
    found: true,
    ...extra,
  };
}

/** Parse money out of a plain-text price label (no HTML semantics). */
export function parsePriceText(text: string): ParsedPrice {
  return fromAmounts(amountsFromText(text));
}

/** Money tokens inside a WooCommerce price fragment. */
function amountsFromFragment(fragment: string): number[] {
  const bdiAmounts = Array.from(
    fragment.matchAll(/<bdi[^>]*>([\s\S]*?)<\/bdi>/gi)
  ).flatMap((m) => amountsFromText(m[1].replace(/<[^>]+>/g, " ")));
  if (bdiAmounts.length) return bdiAmounts;

  const spanAmounts = Array.from(
    fragment.matchAll(
      /<span[^>]*class=["'][^"']*woocommerce-Price-amount[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
    )
  ).flatMap((m) => amountsFromText(m[1].replace(/<[^>]+>/g, " ")));
  if (spanAmounts.length) return spanAmounts;

  return amountsFromText(fragment.replace(/<[^>]+>/g, " "));
}

/**
 * Parse a WooCommerce price fragment, honouring sale markup
 * (`<del>` old price + `<ins>` current price) and price ranges.
 */
export function parsePriceFromFragment(fragment: string): ParsedPrice {
  if (!fragment.trim()) return { ...EMPTY_PRICE };

  const insMatches = Array.from(fragment.matchAll(/<ins[^>]*>([\s\S]*?)<\/ins>/gi));
  const delMatches = Array.from(fragment.matchAll(/<del[^>]*>([\s\S]*?)<\/del>/gi));

  if (insMatches.length) {
    const current = insMatches.flatMap((m) => amountsFromFragment(m[1]));
    const regular = delMatches.flatMap((m) => amountsFromFragment(m[1]));
    return fromAmounts(current, {
      onSale: current.length > 0,
      regularPrice: regular.length ? Math.min(...regular) : null,
    });
  }

  const withoutDel = fragment.replace(/<del[^>]*>[\s\S]*?<\/del>/gi, " ");
  return fromAmounts(amountsFromFragment(withoutDel), {
    regularPrice: delMatches.length
      ? Math.min(...delMatches.flatMap((m) => amountsFromFragment(m[1])))
      : null,
  });
}

/**
 * Locate the product price element in a page and parse it.
 * Only `.price` containers are considered so unrelated money on the page
 * (shipping banners, footer, related products) never leaks into the cost.
 */
export function parsePriceFromHtml(html: string): ParsedPrice {
  const containers = Array.from(
    html.matchAll(/<(p|span|div)[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>/gi)
  );

  for (const container of containers) {
    const fragment = extractTagBlock(html, container.index, container[1]);
    const parsed = parsePriceFromFragment(fragment);
    if (parsed.found) return parsed;
  }

  return { ...EMPTY_PRICE };
}
