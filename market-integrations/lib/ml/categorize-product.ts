import { categorizeWithAi } from "@/lib/agent/category";
import {
  predictCategoryByTitle,
  type DomainDiscoveryResult,
} from "@/lib/ml/categories";

export type CategorySuggestion = {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  domainId?: string;
  domainName?: string;
  score?: number;
};

export type CategorizeProductInput = {
  title: string;
  description?: string;
  categoryPath?: string | null;
  siteId?: string;
  fetchImpl?: typeof fetch;
  /** Se true, tenta IA quando o preditor ML falhar (padrão true). */
  allowAiFallback?: boolean;
};

export type CategorizeProductResult = {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  source: "ml_predictor" | "ai" | "none";
  suggestions: CategorySuggestion[];
  warnings: string[];
};

function mapMlSuggestion(s: DomainDiscoveryResult, index: number): CategorySuggestion {
  return {
    categoryId: s.category_id,
    categoryName: s.category_name,
    categoryPath: s.category_name,
    domainId: s.domain_id,
    domainName: s.domain_name,
    score: Math.max(1, 3 - index),
  };
}

export async function categorizeProduct(
  input: CategorizeProductInput
): Promise<CategorizeProductResult> {
  const warnings: string[] = [];
  const title = (input.title || "").trim();
  if (!title) {
    return {
      categoryId: "",
      categoryName: "",
      categoryPath: "",
      source: "none",
      suggestions: [],
      warnings: ["Título vazio para categorização"],
    };
  }

  const allowAiFallback = input.allowAiFallback !== false;

  const ml = await predictCategoryByTitle({
    title,
    siteId: input.siteId,
    fetchImpl: input.fetchImpl,
  });
  warnings.push(...ml.warnings);

  const suggestions = ml.suggestions.map(mapMlSuggestion);
  if (ml.best?.category_id) {
    return {
      categoryId: ml.best.category_id,
      categoryName: ml.best.category_name,
      categoryPath: ml.best.category_name,
      source: "ml_predictor",
      suggestions,
      warnings,
    };
  }

  if (!allowAiFallback) {
    warnings.push("Preditor ML indisponível e fallback de IA desabilitado");
    return {
      categoryId: "",
      categoryName: "",
      categoryPath: "",
      source: "none",
      suggestions,
      warnings,
    };
  }

  const ai = await categorizeWithAi({
    title,
    description: input.description,
    categoryPath: input.categoryPath,
    siteId: input.siteId,
    fetchImpl: input.fetchImpl,
  });
  warnings.push(...ai.warnings);

  if (ai.categoryId) {
    const aiSuggestion: CategorySuggestion = {
      categoryId: ai.categoryId,
      categoryName: ai.categoryName,
      categoryPath: ai.categoryPath,
      score: 1,
    };
    return {
      categoryId: ai.categoryId,
      categoryName: ai.categoryName,
      categoryPath: ai.categoryPath,
      source: "ai",
      suggestions: [aiSuggestion, ...suggestions],
      warnings,
    };
  }

  return {
    categoryId: "",
    categoryName: "",
    categoryPath: "",
    source: "none",
    suggestions,
    warnings,
  };
}
