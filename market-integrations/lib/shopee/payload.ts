export type ShopeeAttributeValue = {
  attribute_id: number;
  value: string;
};

export type ShopeeListingDraftLike = {
  title: string;
  description: string;
  price: number;
  stock: number;
  condition: string;
  categoryId: string;
  attributes: string;
  pictures: string;
  itemSku?: string | null;
  brandId?: string | null;
  brandName?: string | null;
  weightKg: number;
  dimensionJson: string;
  logisticsJson: string;
  daysToShip: number;
  videoUrl?: string | null;
};

export const DEFAULT_WEIGHT_KG = 0.3;
export const DEFAULT_DAYS_TO_SHIP = 2;

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseShopeeAttributes(attributesJson: string): ShopeeAttributeValue[] {
  return parseJsonArray(attributesJson)
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const obj = a as Record<string, unknown>;
      const id = Number(obj.attribute_id ?? obj.attributeId);
      const value = String(obj.value ?? obj.value_name ?? "").trim();
      if (!Number.isFinite(id) || !value) return null;
      return { attribute_id: id, value };
    })
    .filter((a): a is ShopeeAttributeValue => a !== null);
}

export type ShopeeMandatoryAttribute = { attributeId: number; name: string };

export function validateDraftForPublish(
  draft: ShopeeListingDraftLike,
  imageCount: number,
  mandatoryAttributes: ShopeeMandatoryAttribute[] = []
): string[] {
  const errors: string[] = [];
  if (!draft.title?.trim()) errors.push("title é obrigatório");
  if (draft.title.length > 120) errors.push("title deve ter no máximo 120 caracteres");
  if (!(draft.price > 0)) errors.push("price deve ser > 0");
  if (!(draft.stock >= 0)) errors.push("stock inválido");
  if (!draft.categoryId?.trim()) errors.push("categoryId é obrigatório");
  if (imageCount < 1) errors.push("é necessária ao menos 1 imagem");
  if (!(draft.weightKg > 0)) errors.push("peso (weightKg) deve ser > 0 — obrigatório pela Shopee");

  const brand = draft.brandName?.trim() || draft.brandId?.trim();
  if (!brand) {
    errors.push("Marca é obrigatória — use 'Sem marca' quando não houver marca identificável");
  }

  const attributes = parseShopeeAttributes(draft.attributes);
  const providedIds = new Set(attributes.map((a) => a.attribute_id));
  for (const mandatory of mandatoryAttributes) {
    if (!providedIds.has(mandatory.attributeId)) {
      errors.push(`Atributo obrigatório ausente: ${mandatory.name}`);
    }
  }

  return errors;
}

/**
 * Monta o payload de add_item/update_item. `imageIds` já deve vir resolvido
 * (upload feito via lib/shopee/media.ts) — este builder é puro/síncrono.
 */
export function buildItemPayload(
  draft: ShopeeListingDraftLike,
  imageIds: string[]
): Record<string, unknown> {
  const dimension = parseJsonObject(draft.dimensionJson);
  const logistics = parseJsonArray(draft.logisticsJson);
  const attributes = parseShopeeAttributes(draft.attributes);

  const payload: Record<string, unknown> = {
    item_name: draft.title.slice(0, 120),
    description: draft.description || draft.title,
    item_sku: draft.itemSku?.trim() || undefined,
    category_id: Number(draft.categoryId),
    price_info: [{ current_price: draft.price }],
    stock_info: [{ stock_type: 0, current_stock: Math.max(0, draft.stock) }],
    condition: draft.condition === "USED" ? "USED" : "NEW",
    item_status: "NORMAL",
    weight: draft.weightKg > 0 ? draft.weightKg : DEFAULT_WEIGHT_KG,
    dimension:
      dimension.length || dimension.width || dimension.height
        ? {
            package_length: Number(dimension.length ?? 0),
            package_width: Number(dimension.width ?? 0),
            package_height: Number(dimension.height ?? 0),
          }
        : undefined,
    logistic_info: logistics.length
      ? logistics
      : undefined,
    days_to_ship: draft.daysToShip > 0 ? draft.daysToShip : DEFAULT_DAYS_TO_SHIP,
    image: imageIds.length ? { image_id_list: imageIds.slice(0, 9) } : undefined,
  };

  if (draft.brandId?.trim()) {
    payload.brand = { brand_id: Number(draft.brandId), original_brand_name: draft.brandName?.trim() || "" };
  } else {
    payload.brand = { brand_id: 0, original_brand_name: draft.brandName?.trim() || "Sem marca" };
  }

  if (attributes.length) {
    payload.attribute_list = attributes.map((a) => ({
      attribute_id: a.attribute_id,
      attribute_value_list: [{ value_id: 0, original_value_name: a.value }],
    }));
  }

  if (draft.videoUrl?.trim()) {
    payload.video_upload_id = draft.videoUrl.trim();
  }

  return payload;
}

export type ShopeeListingDefaultsSettings = {
  shopeeDefaultWeightKg: number;
  shopeeDefaultDaysToShip: number;
};

export type ShopeeListingDefaultsInput = {
  weightKg?: number | null;
  daysToShip?: number | null;
  userEdited?: Record<string, boolean>;
};

export type ShopeeListingDefaultsResult = {
  weightKg: number;
  daysToShip: number;
};

export function resolveListingDefaults(
  input: ShopeeListingDefaultsInput,
  settings: ShopeeListingDefaultsSettings
): ShopeeListingDefaultsResult {
  const edited = input.userEdited ?? {};
  const keep = <T>(field: string, current: T | null | undefined, fallback: T): T =>
    edited[field] && current !== null && current !== undefined ? current : fallback;

  return {
    weightKg: keep("weightKg", input.weightKg, settings.shopeeDefaultWeightKg || DEFAULT_WEIGHT_KG),
    daysToShip: keep(
      "daysToShip",
      input.daysToShip,
      settings.shopeeDefaultDaysToShip ?? DEFAULT_DAYS_TO_SHIP
    ),
  };
}
