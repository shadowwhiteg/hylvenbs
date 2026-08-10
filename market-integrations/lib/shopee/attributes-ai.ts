import { getAppSettings } from "@/lib/settings";
import { chatWithAiUsingSettings, describeActiveModel, providerLabel } from "@/lib/agent/chat";
import { readLlmJson } from "@/lib/agent/json";
import type { ShopeeAttributeDefinition } from "@/lib/shopee/category";
import type { ShopeeAttributeValue } from "@/lib/shopee/payload";

export type FillShopeeAttributesResult = {
  attributes: ShopeeAttributeValue[];
  model: string;
  warnings: string[];
};

/**
 * Preenche com IA os valores dos atributos exigidos pela categoria Shopee escolhida,
 * a partir do título/descrição/características já coletadas do fornecedor.
 * Diferente do ML (ids fixos tipo BRAND/MODEL), a Shopee usa attribute_id numérico
 * específico por categoria — por isso a lista de atributos-alvo vem de getCategoryAttributes.
 */
export async function fillShopeeAttributesWithAi(
  input: {
    title: string;
    description: string;
    scrapedAttributes: Array<{ name: string; value: string }>;
    attributeDefs: ShopeeAttributeDefinition[];
  },
  opts?: { fetchImpl?: typeof fetch }
): Promise<FillShopeeAttributesResult> {
  const settings = await getAppSettings();

  if (!input.attributeDefs.length) {
    return { attributes: [], model: describeActiveModel(settings), warnings: [] };
  }

  const known = (input.scrapedAttributes || [])
    .filter((a) => a?.name && a?.value)
    .map((a) => `- ${a.name}: ${a.value}`)
    .join("\n");

  const attrLines = input.attributeDefs
    .map((a) => {
      const options = a.values.length ? ` (opções: ${a.values.slice(0, 30).join(" | ")})` : "";
      return `- attribute_id ${a.attributeId}: ${a.name}${a.isMandatory ? " [obrigatório]" : ""}${options}`;
    })
    .join("\n");

  const system = [
    "Você extrai características (atributos) de produtos para anúncios da Shopee Brasil.",
    "Responda SOMENTE com JSON válido, sem markdown: ",
    '{"attributes":[{"attribute_id":123,"value":"texto ou uma das opções listadas"}]}',
    "Use exatamente o attribute_id fornecido. Quando o atributo tiver opções, escolha uma delas literalmente.",
    "Só inclua atributos comprovados pelo título, pela descrição ou pelas características informadas.",
    "Nunca invente dados: se a informação não existir, omita o atributo — EXCETO quando o atributo for de marca, que é sempre obrigatória: se não houver marca identificável, use 'Sem marca'.",
  ].join("\n");

  const user = [
    `Título: ${input.title || "(sem título)"}`,
    "",
    "Descrição:",
    (input.description || "(sem descrição)").slice(0, 4000),
    "",
    "Características já coletadas do fornecedor:",
    known || "(nenhuma)",
    "",
    "Atributos exigidos/disponíveis pela categoria Shopee escolhida:",
    attrLines,
    "",
    "Devolva o JSON com os valores preenchidos.",
  ].join("\n");

  try {
    const { message } = await chatWithAiUsingSettings(settings, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      think: false,
      fetchImpl: opts?.fetchImpl,
    });

    const content = message?.content || message?.thinking || "";
    const parsed = readLlmJson(content, (p) => {
      if (Array.isArray(p)) return true;
      if (p && typeof p === "object") return Array.isArray((p as { attributes?: unknown }).attributes);
      return false;
    });

    if (parsed === null) {
      return {
        attributes: [],
        model: describeActiveModel(settings),
        warnings: ["Não foi possível interpretar o JSON devolvido pela IA."],
      };
    }

    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { attributes?: unknown[] }).attributes ?? []);

    const validIds = new Set(input.attributeDefs.map((a) => a.attributeId));
    const attributes: ShopeeAttributeValue[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as Record<string, unknown>;
      const id = Number(obj.attribute_id ?? obj.attributeId);
      const value = String(obj.value ?? obj.value_name ?? "").trim();
      if (!Number.isFinite(id) || !validIds.has(id) || !value) continue;
      attributes.push({ attribute_id: id, value });
    }

    return { attributes, model: describeActiveModel(settings), warnings: [] };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      attributes: [],
      model: describeActiveModel(settings),
      warnings: [`${providerLabel(settings)} indisponível: ${detail}`],
    };
  }
}
