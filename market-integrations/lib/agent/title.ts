import { getAppSettings } from "@/lib/settings";
import { chatWithAiUsingSettings, providerLabel } from "@/lib/agent/chat";

export const ML_TITLE_MAX_LENGTH = 60;

export function mlTitleNeedsAi(title: string): boolean {
  return title.trim().length > ML_TITLE_MAX_LENGTH;
}

export function isValidMlTitle(title: string | null | undefined): boolean {
  const t = (title || "").trim();
  return t.length > 0 && t.length <= ML_TITLE_MAX_LENGTH;
}

/** Corta no último espaço antes do limite, sem partir palavras. */
export function fallbackMlTitle(originalTitle: string): string {
  const trimmed = originalTitle.trim();
  if (trimmed.length <= ML_TITLE_MAX_LENGTH) return trimmed;

  const slice = trimmed.slice(0, ML_TITLE_MAX_LENGTH);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > ML_TITLE_MAX_LENGTH * 0.5) {
    return slice.slice(0, lastSpace).trim();
  }
  return slice.trim();
}

export function buildMlTitlePrompt(input: {
  originalTitle: string;
  description?: string;
  categoryPath?: string | null;
}): Array<{ role: "system" | "user"; content: string }> {
  const context = [
    input.categoryPath ? `Categoria: ${input.categoryPath}` : "",
    input.description ? `Descrição: ${input.description.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "Você cria títulos de anúncio para o Mercado Livre no Brasil. " +
        `Responda APENAS com o título final, sem aspas, sem explicação, máximo ${ML_TITLE_MAX_LENGTH} caracteres. ` +
        "Mantenha marca, modelo e palavras-chave importantes. Não use emojis.",
    },
    {
      role: "user",
      content: `Título original do fornecedor (${input.originalTitle.length} caracteres):\n${input.originalTitle}\n\n${context}\n\nCrie um título otimizado para o Mercado Livre com no máximo ${ML_TITLE_MAX_LENGTH} caracteres.`,
    },
  ];
}

export function parseMlTitleResponse(raw: string): string {
  let text = (raw || "").trim();
  text = text.replace(/^```[\w]*\n?/i, "").replace(/\n?```$/i, "");
  text = text.replace(/^["']|["']$/g, "").trim();
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) || "";
  return firstLine.slice(0, ML_TITLE_MAX_LENGTH).trim();
}

export type ResolveMlTitleResult = {
  title: string;
  source: "original" | "existing" | "ai" | "fallback";
  warnings: string[];
};

export async function generateMlTitleWithAi(
  input: {
    originalTitle: string;
    description?: string;
    categoryPath?: string | null;
  },
  opts?: { fetchImpl?: typeof fetch }
): Promise<{ title: string; warnings: string[] }> {
  const settings = await getAppSettings();
  const messages = buildMlTitlePrompt(input);

  try {
    const { message } = await chatWithAiUsingSettings(settings, {
      messages,
      think: false,
      fetchImpl: opts?.fetchImpl,
    });
    const parsed = parseMlTitleResponse(message?.content || message?.thinking || "");
    if (!isValidMlTitle(parsed)) {
      return {
        title: fallbackMlTitle(input.originalTitle),
        warnings: ["IA devolveu título inválido; usado fallback por palavras"],
      };
    }
    return { title: parsed, warnings: [] };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      title: fallbackMlTitle(input.originalTitle),
      warnings: [`${providerLabel(settings)} indisponível (${detail}); usado fallback por palavras`],
    };
  }
}

/**
 * Define o título do anúncio ML:
 * - até 60 chars: usa o original;
 * - acima: preserva edição manual válida ou gera com IA (fallback se falhar).
 */
export async function resolveMlTitle(input: {
  originalTitle: string;
  currentMlTitle?: string | null;
  titleEditedByUser?: boolean;
  sourceTitleChanged?: boolean;
  description?: string;
  categoryPath?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ResolveMlTitleResult> {
  const original = input.originalTitle.trim();
  if (!original) {
    return { title: "", source: "fallback", warnings: ["Título original vazio"] };
  }

  if (!mlTitleNeedsAi(original)) {
    return { title: original, source: "original", warnings: [] };
  }

  if (
    input.titleEditedByUser &&
    isValidMlTitle(input.currentMlTitle) &&
    input.currentMlTitle!.trim() !== original
  ) {
    return { title: input.currentMlTitle!.trim(), source: "existing", warnings: [] };
  }

  if (
    !input.sourceTitleChanged &&
    isValidMlTitle(input.currentMlTitle) &&
    input.currentMlTitle!.trim() !== original.slice(0, ML_TITLE_MAX_LENGTH)
  ) {
    return { title: input.currentMlTitle!.trim(), source: "existing", warnings: [] };
  }

  const ai = await generateMlTitleWithAi(
    {
      originalTitle: original,
      description: input.description,
      categoryPath: input.categoryPath,
    },
    { fetchImpl: input.fetchImpl }
  );

  return {
    title: ai.title,
    source: ai.warnings.length ? "fallback" : "ai",
    warnings: ai.warnings,
  };
}
