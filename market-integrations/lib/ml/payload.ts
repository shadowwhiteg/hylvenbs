import {
  getMissingStandardAttributes,
  hasUnitsPerPack,
  isSaleFormatKit,
  serializeAttributesForMl,
  validateGtinRequirement,
} from "@/lib/ml/attributes";
import type { GtinPolicy } from "@/lib/ml/category-attributes";

export type ListingDraftLike = {
  title: string;
  description: string;
  price: number;
  condition: string;
  buyingMode: string;
  listingTypeId: string;
  categoryId: string;
  shippingMode: string;
  shippingJson: string;
  pictures: string;
  attributes: string;
  variations: string;
  regulatory: string;
  warrantyType: string;
  warrantyTime: string;
  availableQuantity: number;
  currencyId: string;
  freeShipping?: boolean;
  localPickUp?: boolean;
  catalogProductId?: string | null;
  videoId?: string | null;
};

export const DEFAULT_LISTING_TYPE_ID = "gold_pro";
export const DEFAULT_SHIPPING_MODE = "me2";
export const DEFAULT_WARRANTY_TYPE = "Garantia de fábrica";
export const DEFAULT_WARRANTY_TIME = "90 dias";

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

export function validateDraftForPublish(
  draft: ListingDraftLike,
  opts?: { gtinPolicy?: GtinPolicy }
): string[] {
  const errors: string[] = [];
  if (!draft.title?.trim()) errors.push("title is required");
  if (draft.title.length > 60) errors.push("title must be <= 60 characters");
  if (!(draft.price > 0)) errors.push("price must be > 0");
  if (!draft.categoryId?.trim()) errors.push("categoryId is required");
  const pictures = parseJsonArray(draft.pictures);
  if (pictures.length < 1) errors.push("at least one picture is required");

  const serialized = serializeAttributesForMl(draft.attributes, {
    title: draft.title,
    inferModel: true,
    gtinPolicy: opts?.gtinPolicy,
  });

  const missing = getMissingStandardAttributes(draft.attributes, ["BRAND", "MODEL"], {
    title: draft.title,
    inferModel: true,
    gtinPolicy: opts?.gtinPolicy,
  });
  if (missing.includes("BRAND")) {
    errors.push("Marca (BRAND) é obrigatória — preencha nas características ou use IA");
  }
  if (missing.includes("MODEL")) {
    errors.push(
      "Modelo (MODEL) é obrigatório — adicione nas características ou ajuste o título do anúncio"
    );
  }

  const gtinError = validateGtinRequirement(
    serialized,
    opts?.gtinPolicy,
    draft.attributes
  );
  if (gtinError) errors.push(gtinError);

  if (isSaleFormatKit(serialized) && !hasUnitsPerPack(serialized)) {
    errors.push(
      "Unidades por kit (obrigatório) — como 'Formato de venda' é Kit, preencha a quantidade de unidades que compõem o kit"
    );
  }

  return errors;
}

export function buildItemPayload(
  draft: ListingDraftLike,
  opts?: { gtinPolicy?: GtinPolicy }
): Record<string, unknown> {
  const pictureSources = parseJsonArray(draft.pictures).map((p) => {
    if (typeof p === "string") return { source: p };
    if (p && typeof p === "object" && "source" in (p as object)) {
      return { source: String((p as { source: string }).source) };
    }
    return null;
  }).filter(Boolean);

  const shippingExtra = parseJsonObject(draft.shippingJson);
  const attributes = serializeAttributesForMl(draft.attributes, {
    title: draft.title,
    inferModel: true,
    gtinPolicy: opts?.gtinPolicy,
  });
  const variations = parseJsonArray(draft.variations);
  const regulatory = parseJsonObject(draft.regulatory);

  const payload: Record<string, unknown> = {
    title: draft.title.slice(0, 60),
    category_id: draft.categoryId,
    price: draft.price,
    currency_id: draft.currencyId || "BRL",
    available_quantity: draft.availableQuantity || 1,
    buying_mode: draft.buyingMode || "buy_it_now",
    condition: draft.condition || "new",
    listing_type_id: draft.listingTypeId || DEFAULT_LISTING_TYPE_ID,
    pictures: pictureSources,
    sale_terms: [
      {
        id: "WARRANTY_TYPE",
        value_name: draft.warrantyType?.trim() || DEFAULT_WARRANTY_TYPE,
      },
      {
        id: "WARRANTY_TIME",
        value_name: draft.warrantyTime?.trim() || DEFAULT_WARRANTY_TIME,
      },
    ],
    shipping: {
      mode: draft.shippingMode || DEFAULT_SHIPPING_MODE,
      free_shipping: draft.freeShipping ?? true,
      local_pick_up: draft.localPickUp ?? false,
      ...shippingExtra,
    },
  };

  if (draft.catalogProductId?.trim()) {
    payload.catalog_product_id = draft.catalogProductId.trim();
    payload.catalog_listing = true;
  }
  if (draft.videoId?.trim()) {
    payload.video_id = draft.videoId.trim();
  }

  if (attributes.length) payload.attributes = attributes;
  if (variations.length) payload.variations = variations;
  if (Object.keys(regulatory).length) {
    const regulatoryAttrs = Object.entries(regulatory)
      .map(([id, value_name]) => {
        const trimmedId = id.trim();
        const trimmedValue = String(value_name ?? "").trim();
        if (!trimmedId || !trimmedValue) return null;
        return { id: trimmedId, value_name: trimmedValue };
      })
      .filter((attr): attr is { id: string; value_name: string } => attr !== null);

    if (regulatoryAttrs.length) {
      const merged = new Map<string, { id: string; value_name: string }>();
      for (const attr of [...attributes, ...regulatoryAttrs]) {
        merged.set(attr.id, attr);
      }
      payload.attributes = [...merged.values()];
    }
  }

  return payload;
}

export function getDescriptionPlainText(draft: ListingDraftLike): string {
  return draft.description || draft.title;
}

export type ListingDefaultsSettings = {
  defaultListingTypeId: string;
  defaultFreeShipping: boolean;
  defaultLocalPickUp: boolean;
  defaultShippingMode: string;
  defaultWarrantyType: string;
  defaultWarrantyTime: string;
};

export type ListingDefaultsInput = {
  listingTypeId?: string | null;
  shippingMode?: string | null;
  freeShipping?: boolean | null;
  localPickUp?: boolean | null;
  warrantyType?: string | null;
  warrantyTime?: string | null;
  /** Garantia informada pelo fornecedor; vence o default de tempo quando existe. */
  productWarranty?: string | null;
  /** Campos já editados manualmente (nunca sobrescritos). */
  userEdited?: Record<string, boolean>;
};

export type ListingDefaultsResult = {
  listingTypeId: string;
  shippingMode: string;
  freeShipping: boolean;
  localPickUp: boolean;
  warrantyType: string;
  warrantyTime: string;
};

/**
 * Valores de anúncio a gravar num draft: os defaults de AppSettings vencem,
 * exceto em campos marcados como editados pelo usuário, que são preservados.
 */
export function resolveListingDefaults(
  input: ListingDefaultsInput,
  settings: ListingDefaultsSettings
): ListingDefaultsResult {
  const edited = input.userEdited ?? {};
  const keep = <T>(field: string, current: T | null | undefined, fallback: T): T =>
    edited[field] && current !== null && current !== undefined ? current : fallback;

  const warrantyFromProduct = input.productWarranty?.trim();

  return {
    listingTypeId: keep(
      "listingTypeId",
      input.listingTypeId?.trim() || null,
      settings.defaultListingTypeId || DEFAULT_LISTING_TYPE_ID
    ),
    shippingMode: keep(
      "shippingMode",
      input.shippingMode?.trim() || null,
      settings.defaultShippingMode || DEFAULT_SHIPPING_MODE
    ),
    freeShipping: keep("freeShipping", input.freeShipping, settings.defaultFreeShipping),
    localPickUp: keep("localPickUp", input.localPickUp, settings.defaultLocalPickUp),
    warrantyType: keep(
      "warrantyType",
      input.warrantyType?.trim() || null,
      settings.defaultWarrantyType || DEFAULT_WARRANTY_TYPE
    ),
    warrantyTime: keep(
      "warrantyTime",
      input.warrantyTime?.trim() || null,
      warrantyFromProduct || settings.defaultWarrantyTime || DEFAULT_WARRANTY_TIME
    ),
  };
}
