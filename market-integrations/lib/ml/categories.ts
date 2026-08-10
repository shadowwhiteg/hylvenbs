import { mlFetch } from "@/lib/ml/client";
import { getAuthStatus } from "@/lib/ml/auth";

const DEFAULT_SITE_ID = "MLB";
const DEFAULT_LIMIT = 3;

export type DomainDiscoveryAttribute = {
  id: string;
  value_id?: string;
  value_name: string;
};

export type DomainDiscoveryResult = {
  domain_id: string;
  domain_name: string;
  category_id: string;
  category_name: string;
  attributes?: DomainDiscoveryAttribute[];
};

export type CategoryPredictInput = {
  title: string;
  siteId?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
};

export type CategoryPredictResult = {
  suggestions: DomainDiscoveryResult[];
  best: DomainDiscoveryResult | null;
  warnings: string[];
};

export async function predictCategoryByTitle(
  input: CategoryPredictInput
): Promise<CategoryPredictResult> {
  const warnings: string[] = [];
  const title = (input.title || "").trim();
  if (!title) {
    return { suggestions: [], best: null, warnings: ["Título vazio para predição"] };
  }

  const auth = await getAuthStatus();
  if (!auth.connected) {
    return {
      suggestions: [],
      best: null,
      warnings: ["Mercado Livre não conectado; preditor indisponível"],
    };
  }

  const siteId = input.siteId || DEFAULT_SITE_ID;
  const limit = Math.min(8, Math.max(1, input.limit ?? DEFAULT_LIMIT));
  const q = encodeURIComponent(title);
  const path = `/sites/${siteId}/domain_discovery/search?limit=${limit}&q=${q}`;

  try {
    const res = await mlFetch<DomainDiscoveryResult[]>(
      path,
      { method: "GET" },
      input.fetchImpl
    );

    if (!res.ok) {
      warnings.push(`Preditor ML retornou HTTP ${res.status}`);
      return { suggestions: [], best: null, warnings };
    }

    const suggestions = Array.isArray(res.data) ? res.data.filter((s) => s?.category_id) : [];
    if (!suggestions.length) {
      warnings.push("Preditor ML não retornou categorias para este título");
    }

    return {
      suggestions,
      best: suggestions[0] ?? null,
      warnings,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warnings.push(`Preditor ML falhou: ${detail}`);
    return { suggestions: [], best: null, warnings };
  }
}
