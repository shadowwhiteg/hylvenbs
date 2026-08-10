import { mlFetch } from "@/lib/ml/client";

const DEFAULT_SITE_ID = "MLB";
const DEFAULT_LIMIT = 10;
const MAX_SUGGESTIONS = 5;
/** Acima disso o vínculo com o catálogo pode ser aplicado automaticamente. */
export const CONFIDENT_SCORE = 0.82;
/** Sem GTIN confirmado nunca chegamos a 1: sobra margem para o match por EAN vencer. */
const MAX_SCORE_WITHOUT_GTIN = 0.94;

export type CatalogAttribute = {
  id?: string;
  name?: string;
  value_name?: string | null;
};

export type CatalogSearchItem = {
  id: string;
  name: string;
  domainId: string | null;
  permalink: string | null;
  pictureUrl: string | null;
  gtin: string | null;
  brand: string | null;
  model: string | null;
};

export type CatalogSuggestion = {
  catalogProductId: string;
  name: string;
  domainId?: string | null;
  permalink?: string | null;
  pictureUrl?: string | null;
  score: number;
  gtin?: string | null;
};

export type CatalogMatchInput = {
  title: string;
  gtin?: string | null;
  brand?: string | null;
  model?: string | null;
  siteId?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
};

export type CatalogMatchResult = {
  suggestions: CatalogSuggestion[];
  bestMatch: CatalogSuggestion | null;
  confident: boolean;
  warnings: string[];
};

const STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "com",
  "para",
  "por",
  "em",
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "no",
  "na",
]);

export function normalizeText(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeGtin(value: string | null | undefined): string {
  return (value || "").replace(/\D+/g, "");
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Sørensen–Dice sobre conjuntos de tokens. */
function diceSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  return (2 * intersection) / (setA.size + setB.size);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function containsAllTokens(haystack: string[], needle: string | null | undefined): boolean {
  const tokens = tokenize(needle || "");
  if (!tokens.length) return false;
  const set = new Set(haystack);
  return tokens.every((t) => set.has(t));
}

/**
 * Score 0..1 de aderência entre o título do produto e o nome do candidato.
 * GTIN idêntico domina; marca e modelo presentes dão bônus.
 */
export function scoreCatalogCandidate(
  productTitle: string,
  candidateName: string,
  extra?: {
    gtin?: string | null;
    candidateGtin?: string | null;
    brand?: string | null;
    model?: string | null;
  }
): number {
  const titleTokens = tokenize(productTitle);
  const candidateTokens = tokenize(candidateName);
  const base = diceSimilarity(titleTokens, candidateTokens);

  const gtin = normalizeGtin(extra?.gtin);
  const candidateGtin = normalizeGtin(extra?.candidateGtin);

  if (gtin && candidateGtin) {
    if (gtin === candidateGtin) return clamp(0.95 + base * 0.05, 0, 1);
    // GTINs conhecidos e diferentes: quase certamente outro produto.
    return clamp(base * 0.5, 0, MAX_SCORE_WITHOUT_GTIN);
  }

  let score = base;
  if (containsAllTokens(candidateTokens, extra?.brand)) score += 0.06;
  if (containsAllTokens(candidateTokens, extra?.model)) score += 0.1;

  return clamp(score, 0, MAX_SCORE_WITHOUT_GTIN);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickAttribute(
  attributes: CatalogAttribute[],
  ids: string[]
): string | null {
  const wanted = new Set(ids.map((id) => id.toUpperCase()));
  for (const attr of attributes) {
    const id = (attr.id || attr.name || "").toUpperCase();
    if (wanted.has(id) && attr.value_name) return String(attr.value_name).trim();
  }
  return null;
}

function toSearchItem(raw: unknown): CatalogSearchItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = firstString(row.id, row.catalog_product_id, row.product_id);
  const name = firstString(row.name, row.title, row.short_description);
  if (!id || !name) return null;

  const attributes = Array.isArray(row.attributes)
    ? (row.attributes as CatalogAttribute[])
    : [];
  const pictures = Array.isArray(row.pictures)
    ? (row.pictures as Array<Record<string, unknown>>)
    : [];
  const firstPicture = pictures.length ? pictures[0] : null;

  return {
    id,
    name,
    domainId: firstString(row.domain_id, row.domainId),
    permalink: firstString(row.permalink, row.url),
    pictureUrl: firstString(
      firstPicture?.secure_url,
      firstPicture?.url,
      row.thumbnail,
      row.picture
    ),
    gtin: pickAttribute(attributes, ["GTIN", "EAN", "UPC"]),
    brand: pickAttribute(attributes, ["BRAND"]),
    model: pickAttribute(attributes, ["MODEL"]),
  };
}

function extractResults(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const row = data as Record<string, unknown>;
  for (const key of ["results", "products", "items", "data"]) {
    if (Array.isArray(row[key])) return row[key] as unknown[];
  }
  return [];
}

const GTIN_KEYS = ["gtin", "ean", "upc", "codigo de barras", "codigo ean"];
const BRAND_KEYS = ["brand", "marca", "fabricante"];
const MODEL_KEYS = ["model", "modelo"];

function valueFromPairs(
  pairs: Array<{ key: string; value: string }>,
  keys: string[]
): string | null {
  const wanted = keys.map((k) => normalizeText(k));
  for (const pair of pairs) {
    if (wanted.includes(pair.key) && pair.value) return pair.value;
  }
  return null;
}

function readAttributePairs(json: string | null | undefined) {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(json || "[]");
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const key = normalizeText(String(row.name ?? row.id ?? ""));
      const value = String(row.value ?? row.value_name ?? "").trim();
      return key ? { key, value } : null;
    })
    .filter((pair): pair is { key: string; value: string } => pair !== null);
}

function isValidGtin(value: string | null): string | null {
  const digits = normalizeGtin(value);
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

/** Tenta descobrir EAN/GTIN, marca e modelo a partir dos atributos e da descrição. */
export function extractProductIdentifiers(input: {
  attributesJson?: string | null;
  description?: string | null;
}): { gtin: string | null; brand: string | null; model: string | null } {
  const pairs = readAttributePairs(input.attributesJson);
  const text = input.description || "";

  const gtinFromText = text.match(
    /\b(?:ean|gtin|upc|c[óo]digo\s+de\s+barras)\s*[:\-–]?\s*([0-9][0-9 .-]{6,17})/i
  );
  const brandFromText = text.match(/\bmarca\s*[:\-–]\s*([^\n<;,.]{2,40})/i);
  const modelFromText = text.match(/\bmodelo\s*[:\-–]\s*([^\n<;,.]{2,40})/i);

  return {
    gtin:
      isValidGtin(valueFromPairs(pairs, GTIN_KEYS)) ??
      isValidGtin(gtinFromText?.[1] ?? null),
    brand: valueFromPairs(pairs, BRAND_KEYS) ?? brandFromText?.[1]?.trim() ?? null,
    model: valueFromPairs(pairs, MODEL_KEYS) ?? modelFromText?.[1]?.trim() ?? null,
  };
}

export async function searchCatalogProducts(
  query: string,
  opts?: { siteId?: string; limit?: number; fetchImpl?: typeof fetch }
): Promise<{ items: CatalogSearchItem[]; warnings: string[] }> {
  const term = (query || "").trim();
  if (!term) return { items: [], warnings: ["Busca sem termo para o catálogo."] };

  const params = new URLSearchParams({
    status: "active",
    site_id: opts?.siteId || DEFAULT_SITE_ID,
    q: term,
    limit: String(Math.min(Math.max(opts?.limit ?? DEFAULT_LIMIT, 1), 50)),
  });

  try {
    const res = await mlFetch<unknown>(
      `/products/search?${params.toString()}`,
      {},
      opts?.fetchImpl
    );
    if (!res.ok) {
      const detail =
        res.data && typeof res.data === "object" && "message" in res.data
          ? String((res.data as { message: unknown }).message)
          : `HTTP ${res.status}`;
      return {
        items: [],
        warnings: [`Busca no catálogo do Mercado Livre falhou: ${detail}`],
      };
    }
    const items = extractResults(res.data)
      .map(toSearchItem)
      .filter((item): item is CatalogSearchItem => item !== null);
    return { items, warnings: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      items: [],
      warnings: [
        `Não foi possível consultar o catálogo do Mercado Livre: ${message}. Verifique a conexão OAuth em Configurações.`,
      ],
    };
  }
}

export async function findCatalogMatch(
  input: CatalogMatchInput
): Promise<CatalogMatchResult> {
  const warnings: string[] = [];
  const title = (input.title || "").trim();
  if (!title) {
    return {
      suggestions: [],
      bestMatch: null,
      confident: false,
      warnings: ["Produto sem título: não é possível buscar no catálogo."],
    };
  }

  const gtin = normalizeGtin(input.gtin);
  const queries: string[] = [];
  if (gtin) queries.push(gtin);
  const byBrandModel = [input.brand, input.model].filter(Boolean).join(" ").trim();
  if (byBrandModel) queries.push(`${byBrandModel} ${title}`.slice(0, 120));
  queries.push(title.slice(0, 120));

  const byId = new Map<string, CatalogSearchItem>();
  for (const query of queries) {
    const { items, warnings: searchWarnings } = await searchCatalogProducts(query, {
      siteId: input.siteId,
      limit: input.limit,
      fetchImpl: input.fetchImpl,
    });
    for (const warning of searchWarnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    for (const item of items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    // Achou por GTIN: não precisa alargar a busca.
    if (query === gtin && items.length) break;
  }

  const suggestions: CatalogSuggestion[] = [...byId.values()]
    .map((item) => ({
      catalogProductId: item.id,
      name: item.name,
      domainId: item.domainId,
      permalink: item.permalink,
      pictureUrl: item.pictureUrl,
      gtin: item.gtin,
      score: scoreCatalogCandidate(title, item.name, {
        gtin: input.gtin,
        candidateGtin: item.gtin,
        brand: input.brand,
        model: input.model,
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  const bestMatch = suggestions[0] ?? null;
  if (!bestMatch && !warnings.length) {
    warnings.push("Nenhum produto correspondente encontrado no catálogo.");
  }

  const gtinMatch = Boolean(
    bestMatch && gtin && normalizeGtin(bestMatch.gtin) === gtin
  );
  const confident = Boolean(
    bestMatch && (bestMatch.score >= CONFIDENT_SCORE || gtinMatch)
  );

  return { suggestions, bestMatch, confident, warnings };
}
