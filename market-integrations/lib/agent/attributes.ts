import { getAppSettings } from "@/lib/settings";
import {
  chatWithAiUsingSettings,
  describeActiveModel,
  providerLabel,
  type ChatMessage,
} from "@/lib/agent/chat";
import { readLlmJson } from "@/lib/agent/json";

export type ScrapedAttributeLike = { name: string; value: string };

export type MlAttribute = {
  id?: string;
  name: string;
  value_name: string;
};

export type BuildAttributePromptInput = {
  title: string;
  description: string;
  scrapedAttributes: ScrapedAttributeLike[];
  categoryPath?: string | null;
};

export type FillAttributesResult = {
  attributes: MlAttribute[];
  model: string;
  warnings: string[];
};

type CanonicalAttribute = {
  id: string;
  label: string;
  aliases: string[];
};

/** Nomes mais comuns do Mercado Livre normalizados para PT-BR. */
const CANONICAL_ATTRIBUTES: CanonicalAttribute[] = [
  { id: "BRAND", label: "Marca", aliases: ["brand", "marca", "fabricante"] },
  { id: "MODEL", label: "Modelo", aliases: ["model", "modelo"] },
  { id: "COLOR", label: "Cor", aliases: ["color", "colour", "cor"] },
  { id: "EAN", label: "EAN", aliases: ["ean", "codigo de barras", "codigo ean"] },
  { id: "GTIN", label: "GTIN", aliases: ["gtin", "upc"] },
  {
    id: "ITEM_CONDITION",
    label: "Condição do item",
    aliases: ["item condition", "condicao", "condicao do item", "estado"],
  },
  { id: "LINE", label: "Linha", aliases: ["line", "linha"] },
  { id: "MATERIAL", label: "Material", aliases: ["material"] },
  { id: "MODEL_NUMBER", label: "Número do modelo", aliases: ["model number"] },
  { id: "VOLTAGE", label: "Voltagem", aliases: ["voltage", "voltagem", "tensao"] },
  { id: "WEIGHT", label: "Peso", aliases: ["weight", "peso"] },
  { id: "SALE_FORMAT", label: "Formato de venda", aliases: ["sale format", "formato de venda"] },
  {
    id: "UNITS_PER_PACK",
    label: "Unidades por kit",
    aliases: [
      "units per pack",
      "unidades por kit",
      "unidades no kit",
      "quantidade de unidades no kit",
      "quantidade por kit",
    ],
  },
];

/** Chaves já normalizadas e sem espaços (ex.: "N/A" vira "na"). */
const EMPTY_VALUES = new Set([
  "",
  "na",
  "nd",
  "null",
  "undefined",
  "naoinformado",
  "naoinformada",
  "naoseaplica",
  "seminformacao",
  "desconhecido",
]);

function normalizeKey(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Resolve o nome para o rótulo PT-BR e o id do Mercado Livre quando conhecidos. */
export function normalizeAttributeName(
  rawName: string,
  rawId?: string
): { id?: string; name: string } {
  const idKey = normalizeKey(rawId || "");
  const nameKey = normalizeKey(rawName);
  const canonical = CANONICAL_ATTRIBUTES.find((attr) => {
    const keys = [normalizeKey(attr.id), normalizeKey(attr.label), ...attr.aliases];
    return keys.includes(nameKey) || (idKey ? keys.includes(idKey) : false);
  });
  if (canonical) return { id: canonical.id, name: canonical.label };
  const name = (rawName || "").trim();
  return rawId?.trim() ? { id: rawId.trim(), name } : { name };
}

function isEmptyValue(value: string): boolean {
  return EMPTY_VALUES.has(normalizeKey(value).replace(/\s+/g, ""));
}

/**
 * UNITS_PER_PACK only accepts a bare integer ("12") — the ML API rejects
 * "12 unidades" outright. The AI (or the scraped attribute it echoes) often
 * includes the unit word, so the number is extracted defensively here
 * regardless of what the prompt asked for.
 */
function normalizeAttributeValue(id: string | undefined, rawValue: string): string {
  if (id === "UNITS_PER_PACK") {
    const match = rawValue.match(/\d+/);
    if (match) return match[0];
  }
  return rawValue;
}

/**
 * Lê uma lista de atributos salva em JSON, aceitando tanto o formato do scraper
 * (`{name,value}`) quanto o do Mercado Livre (`{id,name,value_name}`).
 */
export function parseAttributeList(json: string | null | undefined): MlAttribute[] {
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
      const name = String(row.name ?? row.id ?? "").trim();
      if (!name) return null;
      const id = typeof row.id === "string" ? row.id : undefined;
      return {
        ...(id ? { id } : {}),
        name,
        value_name: String(row.value_name ?? row.value ?? "").trim(),
      } satisfies MlAttribute;
    })
    .filter((attr): attr is MlAttribute => attr !== null);
}

export function toScrapedAttributes(
  attributes: MlAttribute[]
): ScrapedAttributeLike[] {
  return attributes.map((attr) => ({ name: attr.name, value: attr.value_name }));
}

export function buildAttributePrompt(
  input: BuildAttributePromptInput
): ChatMessage[] {
  const known = (input.scrapedAttributes || [])
    .filter((attr) => attr?.name && attr?.value)
    .map((attr) => `- ${attr.name}: ${attr.value}`)
    .join("\n");

  const system = [
    "Você extrai características (atributos) de produtos para anúncios do Mercado Livre Brasil.",
    "Responda SOMENTE com JSON válido, sem markdown, sem comentários e sem explicações.",
    'Formato exato: {"attributes":[{"name":"Marca","value_name":"JBL"}]}',
    "Use nomes em português padronizados do Mercado Livre: BRAND=Marca, MODEL=Modelo, COLOR=Cor, EAN/GTIN=EAN, ITEM_CONDITION=Condição do item.",
    "Se o título ou a descrição deixar claro que o produto é vendido como kit/conjunto/jogo com mais de uma unidade (ex.: 'kit com 3 peças', 'jogo de 4 unidades', 'combo 2 em 1'), inclua obrigatoriamente os atributos 'Formato de venda' com valor 'Kit' e 'Unidades por kit' com a quantidade de unidades — nunca deixe 'Unidades por kit' de fora quando 'Formato de venda' for Kit.",
    "'Unidades por kit' deve ser SOMENTE o número (ex.: '12'), nunca com a palavra 'unidades' ou qualquer outro texto junto (ex.: NÃO use '12 unidades').",
    "Só inclua atributos comprovados pelo título, pela descrição ou pelas características informadas.",
    "Nunca invente dados: se a informação não existir, omita o atributo — EXCETO Marca (BRAND), que é sempre obrigatória: se não houver marca identificável (produto genérico, sem marca, ou kit combinando itens de marcas diferentes), use o valor 'Genérica'.",
    "Não repita o mesmo atributo duas vezes e não use valores como 'N/A' ou 'não informado'.",
  ].join("\n");

  const user = [
    `Título: ${input.title || "(sem título)"}`,
    input.categoryPath ? `Categoria de origem: ${input.categoryPath}` : null,
    "",
    "Descrição:",
    (input.description || "(sem descrição)").slice(0, 4000),
    "",
    "Características já coletadas do fornecedor:",
    known || "(nenhuma)",
    "",
    "Devolva o JSON com as características normalizadas e as que faltarem.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function looksLikeAttributes(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return true;
  if (parsed && typeof parsed === "object") {
    return Array.isArray((parsed as { attributes?: unknown }).attributes);
  }
  return false;
}

function toRawList(parsed: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { attributes?: unknown })?.attributes as unknown[]) || [];
  return list.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

export function parseAttributeResponse(content: string): {
  attributes: MlAttribute[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!(content || "").trim()) {
    return { attributes: [], warnings: ["A IA devolveu uma resposta vazia."] };
  }

  const parsed = readLlmJson(content, looksLikeAttributes);
  if (parsed === null) {
    return {
      attributes: [],
      warnings: ["Não foi possível interpretar o JSON devolvido pela IA."],
    };
  }

  const attributes: MlAttribute[] = [];
  const seen = new Set<string>();
  let discarded = 0;

  for (const raw of toRawList(parsed)) {
    const rawName = String(raw.name ?? raw.attribute ?? raw.id ?? "").trim();
    const rawValue = String(raw.value_name ?? raw.value ?? "").trim();
    if (!rawName || isEmptyValue(rawValue)) {
      discarded += 1;
      continue;
    }
    const normalized = normalizeAttributeName(
      rawName,
      typeof raw.id === "string" ? raw.id : undefined
    );
    const key = normalizeKey(normalized.id || normalized.name);
    if (seen.has(key)) {
      discarded += 1;
      continue;
    }
    seen.add(key);
    attributes.push({
      ...(normalized.id ? { id: normalized.id } : {}),
      name: normalized.name,
      value_name: normalizeAttributeValue(normalized.id, rawValue),
    });
  }

  if (discarded) {
    warnings.push(`${discarded} característica(s) descartada(s) por estarem vazias ou duplicadas.`);
  }
  if (!attributes.length && !warnings.length) {
    warnings.push("A IA não devolveu nenhuma característica utilizável.");
  }

  return { attributes, warnings };
}

/** Mantém os atributos existentes e apenas completa o que falta. */
export function mergeAttributes(
  existing: MlAttribute[],
  generated: MlAttribute[]
): MlAttribute[] {
  const merged: MlAttribute[] = [];
  const indexByKey = new Map<string, number>();

  for (const attr of existing || []) {
    const normalized = normalizeAttributeName(attr.name, attr.id);
    const key = normalizeKey(normalized.id || normalized.name);
    if (indexByKey.has(key)) continue;
    indexByKey.set(key, merged.length);
    merged.push({ ...attr });
  }

  for (const attr of generated || []) {
    const normalized = normalizeAttributeName(attr.name, attr.id);
    const key = normalizeKey(normalized.id || normalized.name);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...attr });
      continue;
    }
    const current = merged[index];
    if (isEmptyValue(current.value_name || "")) {
      merged[index] = { ...current, value_name: attr.value_name };
    }
    if (!current.id && attr.id) {
      merged[index] = { ...merged[index], id: attr.id };
    }
  }

  return merged;
}

/**
 * BRAND é sempre obrigatória pro Mercado Livre, mesmo em categorias de
 * produto genérico/sem marca. Quando a IA não identifica marca nenhuma (por
 * instrução, ela nunca inventa dado), garantimos aqui o valor padrão que o
 * próprio ML aceita pra esse caso: "Genérica".
 */
export function ensureBrandAttribute(attributes: MlAttribute[]): MlAttribute[] {
  const isBrand = (attr: MlAttribute) =>
    attr.id === "BRAND" || normalizeAttributeName(attr.name, attr.id).id === "BRAND";
  const hasBrand = attributes.some((attr) => isBrand(attr) && !isEmptyValue(attr.value_name || ""));
  if (hasBrand) return attributes;
  // Remove entradas de BRAND vazias antes de adicionar o fallback, pra não duplicar o id.
  const withoutEmptyBrand = attributes.filter((attr) => !isBrand(attr));
  return [...withoutEmptyBrand, { id: "BRAND", name: "Marca", value_name: "Genérica" }];
}

export async function fillAttributesWithAi(
  input: BuildAttributePromptInput,
  opts?: { fetchImpl?: typeof fetch }
): Promise<FillAttributesResult> {
  const settings = await getAppSettings();
  const messages = buildAttributePrompt(input);

  try {
    const { message } = await chatWithAiUsingSettings(settings, {
      messages,
      // Reasoning models (qwen3, deepseek-r1) otherwise answer with an empty
      // `content` after spending the whole budget thinking.
      think: false,
      fetchImpl: opts?.fetchImpl,
    });
    const { attributes, warnings } = parseAttributeResponse(
      message?.content || message?.thinking || ""
    );
    return { attributes, model: describeActiveModel(settings), warnings };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const label = providerLabel(settings);
    const hint = settings.aiProvider === "ollama" ? ` (${settings.ollamaBaseUrl})` : "";
    return {
      attributes: [],
      model: describeActiveModel(settings),
      warnings: [
        `Não foi possível falar com o ${label}${hint}: ${detail}. Verifique se o serviço está rodando.`,
      ],
    };
  }
}
