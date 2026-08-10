import { getAppSettings } from "@/lib/settings";
import {
  chatWithAiUsingSettings,
  describeActiveModel,
  providerLabel,
  type ChatMessage,
} from "@/lib/agent/chat";
import { readLlmJson } from "@/lib/agent/json";
import { ML_TITLE_MAX_LENGTH } from "@/lib/agent/title";
import {
  DEFAULT_BUNDLE_DISCOUNT_PERCENT,
  buildKitDescription,
  buildKitTitle,
} from "@/lib/kits/from-ml-listings";

/** Um kit com muitos itens vira um anúncio confuso e caro. */
const MAX_ITEMS_PER_KIT = 4;
const MIN_ITEMS_PER_KIT = 2;
/** Teto de anúncios enviados ao modelo — prompt grande demais degrada modelos pequenos. */
const MAX_LISTINGS_IN_PROMPT = 60;

export type SuggestionCandidate = {
  id: string;
  title: string;
  price: number;
  categoryId?: string | null;
  /** Descrição original do fornecedor (catálogo Meu Drop), usada como material para a IA escrever um anúncio melhor. */
  sourceDescription?: string | null;
};

export type KitSuggestion = {
  title: string;
  description: string;
  rationale: string;
  discountPercent: number;
  items: SuggestionCandidate[];
  grossPrice: number;
  price: number;
  source: "ai" | "fallback";
};

/** Material bruto demais degrada modelos pequenos; corta a descrição-fonte por item. */
const MAX_SOURCE_DESCRIPTION_CHARS = 260;

export type SuggestKitsResult = {
  suggestions: KitSuggestion[];
  model: string;
  warnings: string[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function priceOf(items: SuggestionCandidate[], discountPercent: number) {
  const grossPrice = round2(items.reduce((sum, i) => sum + i.price, 0));
  return { grossPrice, price: round2(grossPrice * (1 - discountPercent / 100)) };
}

export function buildKitSuggestionPrompt(
  candidates: SuggestionCandidate[],
  maxSuggestions: number
): ChatMessage[] {
  // Modelos pequenos erram muito ao copiar IDs longos (MLB7259061230);
  // por isso a referência no prompt é o índice da lista.
  const list = candidates
    .map((c, i) => {
      const desc = (c.sourceDescription || "").trim().slice(0, MAX_SOURCE_DESCRIPTION_CHARS);
      const line = `${i + 1}. ${c.title} — R$ ${c.price.toFixed(2)}`;
      return desc ? `${line}\n   Descrição do fornecedor: ${desc}` : line;
    })
    .join("\n");

  const system = [
    "Você é um copywriter de e-commerce que monta kits (combos) de produtos para anúncios do Mercado Livre Brasil.",
    "Responda SOMENTE com JSON válido, sem markdown, sem comentários e sem explicações.",
    'Formato exato: {"kits":[{"titulo":"Kit Exemplo","descricao":"texto persuasivo","itens":[1,2],"motivo":"produtos complementares","desconto":10}]}',
    `Cada kit deve ter de ${MIN_ITEMS_PER_KIT} a ${MAX_ITEMS_PER_KIT} itens.`,
    "Em 'itens' use APENAS os números da lista, nunca o nome do produto.",
    "Um produto pode aparecer em no máximo um kit.",
    `O 'titulo' deve ter no máximo ${ML_TITLE_MAX_LENGTH} caracteres, começar com 'Kit' e destacar o principal benefício do combo (não apenas concatenar os nomes dos produtos).`,
    "'descricao' é o texto do anúncio: 2 a 4 frases vendendo o combo (por que esses itens combinam, o benefício de comprar junto), seguidas de uma lista com um item por linha começando com '• '. Use como base as 'Descrição do fornecedor' de cada produto quando disponíveis — reaproveite características e diferenciais reais mencionados nelas, não invente especificações que não estão no material fornecido.",
    "Escreva 'titulo' e 'descricao' em português, tom vendedor mas honesto, sem emojis e sem CAPS LOCK.",
    "'desconto' é a porcentagem de desconto do combo, entre 5 e 25.",
    "Agrupe apenas produtos que façam sentido juntos: complementares, mesma linha, mesmo tema ou mesmo público.",
    "Não invente produtos que não estão na lista.",
  ].join("\n");

  const user = [
    "Produtos disponíveis:",
    list,
    "",
    `Monte no máximo ${maxSuggestions} kits com os produtos acima.`,
    "Só agrupe o que realmente combina — é melhor devolver poucos kits bons do que muitos ruins.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function looksLikeKits(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return true;
  if (parsed && typeof parsed === "object") {
    return Array.isArray((parsed as { kits?: unknown }).kits);
  }
  return false;
}

function toRawKits(parsed: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { kits?: unknown })?.kits as unknown[]) || [];
  return list.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function readIndexes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const value of raw) {
    // Aceita 2, "2" e "2. Produto" — modelos pequenos escorregam nesse formato.
    const n = typeof value === "number" ? value : parseInt(String(value).trim(), 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Converte a resposta do modelo em sugestões válidas: descarta índices fora da
 * lista, kits pequenos demais e produtos repetidos entre kits.
 */
export function parseKitSuggestionResponse(
  content: string,
  candidates: SuggestionCandidate[]
): { suggestions: KitSuggestion[]; warnings: string[] } {
  const warnings: string[] = [];
  const parsed = readLlmJson(content, looksLikeKits);
  if (parsed === null) {
    return { suggestions: [], warnings: ["Não foi possível interpretar o JSON devolvido pela IA."] };
  }

  const suggestions: KitSuggestion[] = [];
  const usedIds = new Set<string>();
  let discarded = 0;

  for (const raw of toRawKits(parsed)) {
    const indexes = readIndexes(raw.itens ?? raw.items ?? raw.itemIndexes);
    const items: SuggestionCandidate[] = [];
    const seen = new Set<string>();

    for (const index of indexes) {
      const candidate = candidates[index - 1];
      if (!candidate) continue;
      if (seen.has(candidate.id) || usedIds.has(candidate.id)) continue;
      seen.add(candidate.id);
      items.push(candidate);
      if (items.length >= MAX_ITEMS_PER_KIT) break;
    }

    if (items.length < MIN_ITEMS_PER_KIT) {
      discarded += 1;
      continue;
    }

    const rawDiscount = Number(raw.desconto ?? raw.discount ?? raw.discountPercent);
    const discountPercent = Number.isFinite(rawDiscount)
      ? Math.min(Math.max(rawDiscount, 1), 50)
      : DEFAULT_BUNDLE_DISCOUNT_PERCENT;

    const rawTitle = String(raw.titulo ?? raw.title ?? "").trim();
    const title = (rawTitle || buildKitTitle(items.map((i) => i.title))).slice(
      0,
      ML_TITLE_MAX_LENGTH
    );

    const rawDescription = String(raw.descricao ?? raw.description ?? "").trim();
    const description =
      rawDescription ||
      buildKitDescription(
        items.map((i) => ({ title: i.title, quantity: 1 })),
        { discountPercent }
      );

    for (const item of items) usedIds.add(item.id);
    suggestions.push({
      title,
      description,
      rationale: String(raw.motivo ?? raw.rationale ?? "").trim(),
      discountPercent,
      items,
      ...priceOf(items, discountPercent),
      source: "ai",
    });
  }

  if (discarded) {
    warnings.push(`${discarded} sugestão(ões) descartada(s) por itens inválidos ou insuficientes.`);
  }
  return { suggestions, warnings };
}

/**
 * Plano B sem IA: agrupa por categoria do ML. Garante que o botão sempre
 * devolva algo útil mesmo com o Ollama fora do ar.
 */
export function fallbackSuggestions(
  candidates: SuggestionCandidate[],
  maxSuggestions: number
): KitSuggestion[] {
  const byCategory = new Map<string, SuggestionCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.categoryId || "";
    if (!key) continue;
    const group = byCategory.get(key) ?? [];
    group.push(candidate);
    byCategory.set(key, group);
  }

  const suggestions: KitSuggestion[] = [];
  for (const group of byCategory.values()) {
    if (group.length < MIN_ITEMS_PER_KIT) continue;
    const items = group.slice(0, MAX_ITEMS_PER_KIT);
    suggestions.push({
      title: buildKitTitle(items.map((i) => i.title)),
      description: buildKitDescription(
        items.map((i) => ({ title: i.title, quantity: 1 })),
        { discountPercent: DEFAULT_BUNDLE_DISCOUNT_PERCENT }
      ),
      rationale: "Agrupado automaticamente por categoria do Mercado Livre (IA indisponível).",
      discountPercent: DEFAULT_BUNDLE_DISCOUNT_PERCENT,
      items,
      ...priceOf(items, DEFAULT_BUNDLE_DISCOUNT_PERCENT),
      source: "fallback",
    });
    if (suggestions.length >= maxSuggestions) break;
  }
  return suggestions;
}

export async function suggestKits(
  candidates: SuggestionCandidate[],
  opts?: { maxSuggestions?: number; fetchImpl?: typeof fetch }
): Promise<SuggestKitsResult> {
  const settings = await getAppSettings();
  const maxSuggestions = opts?.maxSuggestions ?? 5;
  const warnings: string[] = [];

  if (candidates.length < MIN_ITEMS_PER_KIT) {
    return {
      suggestions: [],
      model: describeActiveModel(settings),
      warnings: ["São necessários ao menos 2 anúncios importados para sugerir kits."],
    };
  }

  const pool = candidates.slice(0, MAX_LISTINGS_IN_PROMPT);
  if (candidates.length > pool.length) {
    warnings.push(
      `Analisando os ${pool.length} primeiros anúncios de ${candidates.length} (limite do modelo).`
    );
  }

  try {
    const { message } = await chatWithAiUsingSettings(settings, {
      messages: buildKitSuggestionPrompt(pool, maxSuggestions),
      think: false,
      fetchImpl: opts?.fetchImpl,
    });
    const parsed = parseKitSuggestionResponse(
      message?.content || message?.thinking || "",
      pool
    );
    warnings.push(...parsed.warnings);

    if (!parsed.suggestions.length) {
      const fallback = fallbackSuggestions(pool, maxSuggestions);
      warnings.push(
        fallback.length
          ? "A IA não devolveu kits utilizáveis; agrupamos por categoria como alternativa."
          : "A IA não devolveu kits utilizáveis e não há categorias repetidas para agrupar."
      );
      return { suggestions: fallback, model: describeActiveModel(settings), warnings };
    }

    return {
      suggestions: parsed.suggestions.slice(0, maxSuggestions),
      model: describeActiveModel(settings),
      warnings,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const fallback = fallbackSuggestions(pool, maxSuggestions);
    warnings.push(
      `Não foi possível falar com o ${providerLabel(settings)}: ${detail}.` +
        (fallback.length ? " Sugestões geradas por categoria." : "")
    );
    return { suggestions: fallback, model: describeActiveModel(settings), warnings };
  }
}
