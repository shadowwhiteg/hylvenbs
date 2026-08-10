import { getAppSettings } from "@/lib/settings";
import { chatWithAiUsingSettings, describeActiveModel, providerLabel } from "@/lib/agent/chat";
import {
  getLeafCategories,
  rankLeafCategories,
  type LeafCategory,
} from "@/lib/ml/category-dump";

export type AiCategoryResult = {
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

export function parseAiCategoryResponse(
  raw: string,
  candidates: LeafCategory[]
): { categoryId: string; categoryName: string; categoryPath: string } | null {
  const text = stripFences(stripReasoning(raw));
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as {
      category_id?: string;
      categoryId?: string;
      category_name?: string;
      categoryName?: string;
    };
    const id = (parsed.category_id || parsed.categoryId || "").trim();
    if (!id) return null;

    const found = candidates.find((c) => c.id === id);
    if (found) {
      return { categoryId: found.id, categoryName: found.name, categoryPath: found.path };
    }

    return {
      categoryId: id,
      categoryName: (parsed.category_name || parsed.categoryName || id).trim(),
      categoryPath: (parsed.category_name || parsed.categoryName || id).trim(),
    };
  } catch {
    return null;
  }
}

export async function categorizeWithAi(input: {
  title: string;
  description?: string;
  categoryPath?: string | null;
  siteId?: string;
  fetchImpl?: typeof fetch;
}): Promise<AiCategoryResult> {
  const settings = await getAppSettings();
  const warnings: string[] = [];

  let leaves: LeafCategory[];
  try {
    leaves = await getLeafCategories(input.siteId || "MLB", input.fetchImpl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      categoryId: "",
      categoryName: "",
      categoryPath: "",
      model: describeActiveModel(settings),
      warnings: [`Não foi possível carregar o dump de categorias: ${detail}`],
    };
  }

  const query = [input.title, input.description, input.categoryPath]
    .filter(Boolean)
    .join(" ");
  const candidates = rankLeafCategories(leaves, query, 40);

  const candidateLines = candidates
    .map((c) => `- ${c.id}: ${c.path}`)
    .join("\n");

  const system = [
    "Você categoriza produtos para anúncios do Mercado Livre Brasil (site MLB).",
    "Escolha APENAS uma categoria da lista fornecida.",
    "Responda SOMENTE com JSON válido, sem markdown: ",
    '{"category_id":"MLB1234","category_name":"Nome da categoria"}',
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
    "Escolha a melhor categoria MLB para este produto.",
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

    const parsed = parseAiCategoryResponse(
      message?.content || message?.thinking || "",
      candidates
    );

    if (!parsed?.categoryId) {
      warnings.push("IA não retornou uma categoria válida");
      return {
        categoryId: "",
        categoryName: "",
        categoryPath: "",
        model: describeActiveModel(settings),
        warnings,
      };
    }

    return {
      categoryId: parsed.categoryId,
      categoryName: parsed.categoryName,
      categoryPath: parsed.categoryPath,
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
