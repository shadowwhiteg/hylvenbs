import {
  normalizeAttributeName,
  parseAttributeList,
} from "@/lib/agent/attributes";
import type { GtinPolicy } from "@/lib/ml/category-attributes";
import {
  getGtinFormatError,
  normalizeGtinValue,
  readGtinFromAttributesJson,
} from "@/lib/ml/gtin-draft";

export {
  normalizeGtinValue,
  readGtinFromAttributesJson,
  readValidGtinFromAttributesJson,
  upsertGtinInAttributesJson,
  getGtinFormatError,
  isValidGtinCheckDigit,
} from "@/lib/ml/gtin-draft";

export type MlApiAttribute = {
  id: string;
  value_name: string;
  value_id?: string;
};

/** Motivos aceitos pelo ML quando GTIN não está disponível (value_id MLB). */
export const EMPTY_GTIN_REASON_VALUES = {
  artesanal: { value_id: "17055158", value_name: "Artesanal" },
  kit: { value_id: "17055159", value_name: "Kit" },
  naoRegistrado: { value_id: "17055160", value_name: "No registrado" },
  outro: { value_id: "17055161", value_name: "Otro" },
} as const;

function normalizeKey(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Atributos do scrape que não devem ir para a API (fiscal/logística interna). */
const SKIP_SCRAPED_KEYS = new Set([
  "ncm",
  "dimensoes",
  "dimensoes da embalagem",
  "dimensoes do produto",
  "codigo ncm",
]);

/** Nomes comuns do fornecedor → id do Mercado Livre. */
const SCRAPED_NAME_TO_ML_ID: Record<string, string> = {
  "forma da fruteira": "FRUIT_BOWL_SHAPE",
  diametro: "DIAMETER",
  "diametro externo": "DIAMETER",
  peso: "WEIGHT",
  material: "MATERIAL",
  cor: "COLOR",
  niveis: "NUMBER_OF_LEVELS",
  voltagem: "VOLTAGE",
  capacidade: "CAPACITY",
  potencia: "POWER",
  "codigo de barras": "GTIN",
  "codigo ean": "GTIN",
  ean: "GTIN",
  gtin: "GTIN",
  upc: "GTIN",
};

function toMlAttributeId(id: string | null): string | null {
  if (!id) return null;
  if (id === "EAN") return "GTIN";
  return id;
}

function resolveMlAttributeId(name: string, rawId?: string): string | null {
  const normalized = normalizeAttributeName(name, rawId);
  if (normalized.id) return toMlAttributeId(normalized.id);

  const key = normalizeKey(name);
  if (SKIP_SCRAPED_KEYS.has(key)) return null;
  return toMlAttributeId(SCRAPED_NAME_TO_ML_ID[key] ?? null);
}

function storeAttribute(
  byId: Map<string, MlApiAttribute>,
  id: string,
  valueName: string
): void {
  if (id === "GTIN") {
    const gtin = normalizeGtinValue(valueName);
    if (!gtin) return;
    byId.set("GTIN", { id: "GTIN", value_name: gtin });
    return;
  }
  // O ML só aceita um inteiro puro aqui ("12"); valores vindos do scrape ou
  // preenchidos por IA às vezes trazem a unidade junto ("12 unidades").
  if (id === "UNITS_PER_PACK") {
    const digits = valueName.match(/\d+/)?.[0];
    if (!digits) return;
    byId.set("UNITS_PER_PACK", { id: "UNITS_PER_PACK", value_name: digits });
    return;
  }
  byId.set(id, { id, value_name: valueName });
}

function applyGtinPolicy(
  byId: Map<string, MlApiAttribute>,
  gtinPolicy?: GtinPolicy
): void {
  if (byId.has("GTIN")) {
    byId.delete("EMPTY_GTIN_REASON");
    return;
  }
  if (!gtinPolicy?.gtinConditionallyRequired) return;
  if (!gtinPolicy.allowsEmptyGtinReason) return;

  const reason = EMPTY_GTIN_REASON_VALUES.naoRegistrado;
  byId.set("EMPTY_GTIN_REASON", {
    id: "EMPTY_GTIN_REASON",
    value_id: reason.value_id,
    value_name: reason.value_name,
  });
}

/** Tenta derivar MODEL a partir do título quando o fornecedor não informa. */
export function inferModelFromTitle(title: string, brand?: string): string | null {
  let model = title.trim();
  if (!model) return null;

  if (brand) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    model = model.replace(new RegExp(escaped, "i"), "").trim();
  }

  model = model
    .replace(
      /^(fruteira|liquidificador|panela|escova|patins|mochila|garrafa|copo|prato|talher|organizador|suporte|cesta|balanca|ventilador|aspirador)\s+(de\s+(mesa|parede|chao|cozinha)\s+)?/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  const candidate = model || title.trim();
  return candidate.slice(0, 60) || null;
}

export type SerializeAttributesOptions = {
  title?: string;
  /** Quando true, preenche MODEL a partir do título se faltar. */
  inferModel?: boolean;
  gtinPolicy?: GtinPolicy;
};

export function hasValidGtin(attributes: MlApiAttribute[]): boolean {
  return attributes.some((a) => a.id === "GTIN" && Boolean(a.value_name));
}

/**
 * Converte atributos salvos no draft (`{name,value}` ou `{id,value_name}`)
 * para o formato exigido pela API de itens do Mercado Livre.
 */
export function serializeAttributesForMl(
  attributesJson: string,
  opts: SerializeAttributesOptions = {}
): MlApiAttribute[] {
  const parsed = parseAttributeList(attributesJson);
  const byId = new Map<string, MlApiAttribute>();

  for (const attr of parsed) {
    const valueName = attr.value_name?.trim();
    if (!valueName) continue;

    const id = resolveMlAttributeId(attr.name, attr.id);
    if (!id) continue;

    storeAttribute(byId, id, valueName);
  }

  if (opts.inferModel !== false && !byId.has("MODEL") && opts.title?.trim()) {
    const brand = byId.get("BRAND")?.value_name;
    const model = inferModelFromTitle(opts.title, brand);
    if (model) {
      byId.set("MODEL", { id: "MODEL", value_name: model });
    }
  }

  applyGtinPolicy(byId, opts.gtinPolicy);

  return [...byId.values()];
}

export function validateGtinRequirement(
  attributes: MlApiAttribute[],
  gtinPolicy?: GtinPolicy,
  attributesJson?: string
): string | null {
  if (!gtinPolicy?.gtinConditionallyRequired) return null;
  if (hasValidGtin(attributes)) return null;

  if (attributesJson) {
    const raw = readGtinFromAttributesJson(attributesJson);
    if (raw) {
      const formatError = getGtinFormatError(raw);
      if (formatError) return formatError;
    }
  }

  if (gtinPolicy.allowsEmptyGtinReason) {
    if (attributes.some((a) => a.id === "EMPTY_GTIN_REASON")) return null;
    return null; // será preenchido automaticamente no payload
  }
  return "GTIN (código de barras/EAN) é obrigatório para esta categoria. Adicione o código real da embalagem antes de publicar.";
}

/** IDs ML pro atributo "Formato de venda" e seu campo condicionalmente obrigatório quando o valor é Kit. */
export const SALE_FORMAT_ATTR_ID = "SALE_FORMAT";
export const UNITS_PER_PACK_ATTR_ID = "UNITS_PER_PACK";

/** true quando os atributos serializados marcam o anúncio como "Formato de venda: Kit". */
export function isSaleFormatKit(attributes: MlApiAttribute[]): boolean {
  const value = attributes.find((a) => a.id === SALE_FORMAT_ATTR_ID)?.value_name;
  return Boolean(value && normalizeKey(value) === "kit");
}

export function hasUnitsPerPack(attributes: MlApiAttribute[]): boolean {
  return attributes.some(
    (a) => a.id === UNITS_PER_PACK_ATTR_ID && String(a.value_name ?? "").trim() !== ""
  );
}

export function getMissingStandardAttributes(
  attributesJson: string,
  required: string[],
  opts: SerializeAttributesOptions = {}
): string[] {
  const serialized = serializeAttributesForMl(attributesJson, opts);
  const present = new Set(serialized.map((a) => a.id));
  return required.filter((id) => !present.has(id));
}
