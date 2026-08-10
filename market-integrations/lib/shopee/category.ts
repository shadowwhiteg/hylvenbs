import { getAppSettings } from "@/lib/settings";
import { chatWithAiUsingSettings, describeActiveModel, providerLabel } from "@/lib/agent/chat";
import { shopeeFetch } from "@/lib/shopee/client";

export type ShopeeCategory = {
  categoryId: number;
  parentId: number;
  name: string;
  hasChildren: boolean;
};

type CategoryListResponse = {
  response?: {
    category_list?: Array<{
      category_id: number;
      parent_category_id: number;
      original_category_name: string;
      display_category_name?: string;
      has_children: boolean;
    }>;
  };
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache: { at: number; categories: ShopeeCategory[] } | null = null;

/** Lista completa de categorias da loja (idioma da conta) — cacheada em memória por 24h. */
export async function getCategoryList(force = false): Promise<ShopeeCategory[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.categories;
  }

  const res = await shopeeFetch<CategoryListResponse>("/api/v2/product/get_category", {
    method: "GET",
  });
  if (!res.ok) {
    throw new Error(`Falha ao listar categorias Shopee: HTTP ${res.status}`);
  }

  const categories = (res.data.response?.category_list ?? []).map((c) => ({
    categoryId: c.category_id,
    parentId: c.parent_category_id,
    name: c.display_category_name || c.original_category_name,
    hasChildren: c.has_children,
  }));
  cache = { at: Date.now(), categories };
  return categories;
}

export function getLeafCategories(categories: ShopeeCategory[]): ShopeeCategory[] {
  return categories.filter((c) => !c.hasChildren);
}

/** Monta o caminho completo (raiz > ... > folha) de uma categoria a partir da lista plana. */
export function buildCategoryPath(categories: ShopeeCategory[], categoryId: number): string {
  const byId = new Map(categories.map((c) => [c.categoryId, c]));
  const parts: string[] = [];
  let current = byId.get(categoryId);
  const seen = new Set<number>();
  while (current && !seen.has(current.categoryId)) {
    seen.add(current.categoryId);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" > ");
}

export type ShopeeAttributeDefinition = {
  attributeId: number;
  name: string;
  isMandatory: boolean;
  inputType: string;
  values: string[];
};

type AttributesResponse = {
  response?: {
    attribute_list?: Array<{
      attribute_id: number;
      original_attribute_name: string;
      display_attribute_name?: string;
      is_mandatory: boolean;
      attribute_unit?: string[];
      input_validation_type?: string;
      attribute_value_list?: Array<{ value_id: number; original_value_name: string; display_value_name?: string }>;
    }>;
  };
};

export async function getCategoryAttributes(categoryId: number): Promise<ShopeeAttributeDefinition[]> {
  const res = await shopeeFetch<AttributesResponse>(
    `/api/v2/product/get_attributes?category_id=${categoryId}&language=pt-br`,
    { method: "GET" }
  );
  if (!res.ok) {
    throw new Error(`Falha ao buscar atributos da categoria ${categoryId}: HTTP ${res.status}`);
  }
  return (res.data.response?.attribute_list ?? []).map((a) => ({
    attributeId: a.attribute_id,
    name: a.display_attribute_name || a.original_attribute_name,
    isMandatory: a.is_mandatory,
    inputType: a.input_validation_type || "TEXT_FIELD",
    values: (a.attribute_value_list ?? []).map((v) => v.display_value_name || v.original_value_name),
  }));
}

export type ShopeeAiCategoryResult = {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  model: string;
  warnings: string[];
};

function stripReasoning(content: string): string {
  let text = content || "";
  const lastClose = text.lastIndexOf("</think>");
  if (lastClose >= 0) text = text.slice(lastClose + "</think>".length);
  return text.replace(/<\/?think>/gi, "").trim();
}

function stripFences(content: string): string {
  const fence = content.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  return fence ? fence[1].trim() : content;
}

function normalizeTokens(text: string): string[] {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function rankCategories(leaves: ShopeeCategory[], categories: ShopeeCategory[], query: string, limit: number) {
  const tokens = normalizeTokens(query);
  const withPath = leaves.map((leaf) => ({
    leaf,
    path: buildCategoryPath(categories, leaf.categoryId),
  }));
  if (!tokens.length) return withPath.slice(0, limit);

  const scored = withPath.map(({ leaf, path }) => {
    const hay = normalizeTokens(path);
    let score = 0;
    for (const token of tokens) {
      if (hay.some((h) => h.includes(token) || token.includes(h))) score += 1;
    }
    return { leaf, path, score };
  });
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const top = scored.filter((s) => s.score > 0).slice(0, limit);
  if (top.length >= 5) return top.map(({ leaf, path }) => ({ leaf, path }));
  return withPath.slice(0, limit);
}

/**
 * Categorização Shopee: sem preditor equivalente ao do ML, então é sempre via IA,
 * escolhendo entre as categorias-folha reais da loja (get_category).
 */
export async function categorizeWithAi(input: {
  title: string;
  description?: string;
  categoryPath?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ShopeeAiCategoryResult> {
  const settings = await getAppSettings();
  const warnings: string[] = [];

  let categories: ShopeeCategory[];
  try {
    categories = await getCategoryList();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      categoryId: "",
      categoryName: "",
      categoryPath: "",
      model: describeActiveModel(settings),
      warnings: [`Não foi possível carregar categorias da Shopee: ${detail}`],
    };
  }

  const leaves = getLeafCategories(categories);
  const query = [input.title, input.description, input.categoryPath].filter(Boolean).join(" ");
  const candidates = rankCategories(leaves, categories, query, 40);

  const candidateLines = candidates.map((c) => `- ${c.leaf.categoryId}: ${c.path}`).join("\n");

  const system = [
    "Você categoriza produtos para anúncios da Shopee Brasil.",
    "Escolha APENAS uma categoria da lista fornecida.",
    "Responda SOMENTE com JSON válido, sem markdown: ",
    '{"category_id":"12345","category_name":"Nome da categoria"}',
    "Use exatamente o category_id da lista. Prefira categorias folha (mais específicas).",
  ].join("\n");

  const user = [
    `Título: ${input.title}`,
    input.categoryPath ? `Categoria do fornecedor: ${input.categoryPath}` : null,
    "",
    "Descrição:",
    (input.description || "(sem descrição)").slice(0, 2000),
    "",
    "Categorias candidatas (id: caminho):",
    candidateLines,
    "",
    "Escolha a melhor categoria Shopee para este produto.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const { message } = await chatWithAiUsingSettings(settings, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      think: false,
      fetchImpl: input.fetchImpl,
    });

    const text = stripFences(stripReasoning(message?.content || message?.thinking || ""));
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      warnings.push("IA não retornou uma categoria válida");
      return { categoryId: "", categoryName: "", categoryPath: "", model: describeActiveModel(settings), warnings };
    }

    const parsed = JSON.parse(match[0]) as { category_id?: string; category_name?: string };
    const id = (parsed.category_id || "").trim();
    if (!id) {
      warnings.push("IA não retornou category_id");
      return { categoryId: "", categoryName: "", categoryPath: "", model: describeActiveModel(settings), warnings };
    }

    const found = candidates.find((c) => String(c.leaf.categoryId) === id);
    if (found) {
      return {
        categoryId: String(found.leaf.categoryId),
        categoryName: found.leaf.name,
        categoryPath: found.path,
        model: describeActiveModel(settings),
        warnings,
      };
    }

    return {
      categoryId: id,
      categoryName: (parsed.category_name || id).trim(),
      categoryPath: (parsed.category_name || id).trim(),
      model: describeActiveModel(settings),
      warnings,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      categoryId: "",
      categoryName: "",
      categoryPath: "",
      model: describeActiveModel(settings),
      warnings: [`${providerLabel(settings)} indisponível: ${detail}`],
    };
  }
}
