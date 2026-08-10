import { prisma } from "@/lib/db";
import type { AutoSyncMode } from "@/lib/sync/auto-sync-policy";
import { isAutoSyncMode } from "@/lib/sync/auto-sync-policy";
import { isAiProviderId, type AiProviderId } from "@/lib/agent/providers/meta";
import fs from "fs";
import path from "path";

export const LISTING_TYPE_IDS = ["gold_special", "gold_pro", "gold"] as const;
export const SHIPPING_MODES = ["me2", "custom", "not_specified"] as const;

export type ListingTypeId = (typeof LISTING_TYPE_IDS)[number];
export type ShippingMode = (typeof SHIPPING_MODES)[number];

export function isListingTypeId(value: string): value is ListingTypeId {
  return (LISTING_TYPE_IDS as readonly string[]).includes(value);
}

export function isShippingMode(value: string): value is ShippingMode {
  return (SHIPPING_MODES as readonly string[]).includes(value);
}

export type AppSettingsView = {
  id: string;
  marginPercent: number;
  autoSyncMode: AutoSyncMode;
  autoPauseWhenUnavailable: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  aiProvider: string;
  aiBaseUrl: string | null;
  aiModel: string | null;
  aiCliCommand: string | null;
  aiCliArgs: string;
  aiMaxTokens: number;
  defaultListingTypeId: ListingTypeId;
  defaultFreeShipping: boolean;
  defaultLocalPickUp: boolean;
  defaultShippingMode: ShippingMode;
  defaultWarrantyType: string;
  defaultWarrantyTime: string;
  catalogStockPercent: number;
  shopeeDefaultWeightKg: number;
  shopeeDefaultDaysToShip: number;
};

const DEFAULTS = {
  id: "default",
  marginPercent: Number(process.env.DEFAULT_MARGIN_PERCENT || 30),
  autoSyncMode: "always" as AutoSyncMode,
  autoPauseWhenUnavailable: true,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3.5:4b",
  aiProvider: "ollama",
  aiBaseUrl: null as string | null,
  aiModel: null as string | null,
  aiCliCommand: null as string | null,
  aiCliArgs: "[]",
  aiMaxTokens: 2048,
  defaultListingTypeId: "gold_pro" as ListingTypeId,
  defaultFreeShipping: true,
  defaultLocalPickUp: false,
  defaultShippingMode: "me2" as ShippingMode,
  defaultWarrantyType: "Garantia de fábrica",
  defaultWarrantyTime: "90 dias",
  catalogStockPercent: Number(process.env.CATALOG_STOCK_PERCENT || 100),
  shopeeDefaultWeightKg: 0.3,
  shopeeDefaultDaysToShip: 2,
};

function toView(row: {
  id: string;
  marginPercent: number;
  autoSyncMode: string;
  autoPauseWhenUnavailable: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  aiProvider: string;
  aiBaseUrl: string | null;
  aiModel: string | null;
  aiCliCommand: string | null;
  aiCliArgs: string;
  aiMaxTokens: number;
  defaultListingTypeId: string;
  defaultFreeShipping: boolean;
  defaultLocalPickUp: boolean;
  defaultShippingMode: string;
  defaultWarrantyType: string;
  defaultWarrantyTime: string;
  catalogStockPercent: number;
  shopeeDefaultWeightKg: number;
  shopeeDefaultDaysToShip: number;
}): AppSettingsView {
  return {
    id: row.id,
    marginPercent: row.marginPercent,
    autoSyncMode: isAutoSyncMode(row.autoSyncMode) ? row.autoSyncMode : "always",
    autoPauseWhenUnavailable: row.autoPauseWhenUnavailable,
    ollamaBaseUrl: row.ollamaBaseUrl || DEFAULTS.ollamaBaseUrl,
    ollamaModel: row.ollamaModel || DEFAULTS.ollamaModel,
    aiProvider: isAiProviderId(row.aiProvider) ? row.aiProvider : DEFAULTS.aiProvider,
    aiBaseUrl: row.aiBaseUrl || null,
    aiModel: row.aiModel || null,
    aiCliCommand: row.aiCliCommand || null,
    aiCliArgs: row.aiCliArgs || DEFAULTS.aiCliArgs,
    aiMaxTokens:
      Number.isFinite(row.aiMaxTokens) && row.aiMaxTokens >= 256
        ? Math.min(Math.floor(row.aiMaxTokens), 128000)
        : DEFAULTS.aiMaxTokens,
    defaultListingTypeId: isListingTypeId(row.defaultListingTypeId)
      ? row.defaultListingTypeId
      : DEFAULTS.defaultListingTypeId,
    defaultFreeShipping: row.defaultFreeShipping,
    defaultLocalPickUp: row.defaultLocalPickUp,
    defaultShippingMode: isShippingMode(row.defaultShippingMode)
      ? row.defaultShippingMode
      : DEFAULTS.defaultShippingMode,
    defaultWarrantyType: row.defaultWarrantyType || DEFAULTS.defaultWarrantyType,
    defaultWarrantyTime: row.defaultWarrantyTime || DEFAULTS.defaultWarrantyTime,
    catalogStockPercent:
      Number.isFinite(row.catalogStockPercent) && row.catalogStockPercent >= 0
        ? row.catalogStockPercent
        : DEFAULTS.catalogStockPercent,
    shopeeDefaultWeightKg:
      Number.isFinite(row.shopeeDefaultWeightKg) && row.shopeeDefaultWeightKg > 0
        ? row.shopeeDefaultWeightKg
        : DEFAULTS.shopeeDefaultWeightKg,
    shopeeDefaultDaysToShip:
      Number.isFinite(row.shopeeDefaultDaysToShip) && row.shopeeDefaultDaysToShip >= 0
        ? row.shopeeDefaultDaysToShip
        : DEFAULTS.shopeeDefaultDaysToShip,
  };
}

export async function getAppSettings(): Promise<AppSettingsView> {
  const row = await prisma.appSettings.upsert({
    where: { id: "default" },
    create: { ...DEFAULTS },
    update: {},
  });
  return toView(row);
}

/** True if secret exists in AppSettings or env (never returns the value). */
export async function hasMlClientSecret(): Promise<boolean> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { mlClientSecret: true },
  });
  if (row?.mlClientSecret?.trim()) return true;
  return Boolean(process.env.ML_CLIENT_SECRET?.trim());
}

/**
 * Prefer AppSettings.mlClientSecret over env. Never log the value.
 */
export async function resolveMlClientSecret(): Promise<string> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { mlClientSecret: true },
  });
  const fromDb = row?.mlClientSecret?.trim();
  if (fromDb) return fromDb;
  return (process.env.ML_CLIENT_SECRET || "").trim();
}

/** True if an API key exists for the active provider (DB or env), never returns the value. */
export async function hasAiApiKey(): Promise<boolean> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { aiApiKey: true },
  });
  if (row?.aiApiKey?.trim()) return true;
  return Boolean(process.env.AI_API_KEY?.trim());
}

/** Prefer AppSettings.aiApiKey over env. Never log the value. */
export async function resolveAiApiKey(): Promise<string | null> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { aiApiKey: true },
  });
  const fromDb = row?.aiApiKey?.trim();
  if (fromDb) return fromDb;
  const fromEnv = (process.env.AI_API_KEY || "").trim();
  return fromEnv || null;
}

/** True if a Shopee Partner Key exists (DB or env), never returns the value. */
export async function hasShopeePartnerKey(): Promise<boolean> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { shopeePartnerKey: true },
  });
  if (row?.shopeePartnerKey?.trim()) return true;
  return Boolean(process.env.SHOPEE_PARTNER_KEY?.trim());
}

/** Prefer AppSettings.shopeePartnerKey over env. Never log the value. */
export async function resolveShopeePartnerKey(): Promise<string> {
  const row = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { shopeePartnerKey: true },
  });
  const fromDb = row?.shopeePartnerKey?.trim();
  if (fromDb) return fromDb;
  return (process.env.SHOPEE_PARTNER_KEY || "").trim();
}

/** Upsert ML_CLIENT_SECRET= in `.env` without printing the value. */
function upsertEnvFileSecret(secret: string): void {
  const envPath = path.join(process.cwd(), ".env");
  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch {
    content = "";
  }

  const line = `ML_CLIENT_SECRET=${secret}`;
  if (/^ML_CLIENT_SECRET=.*$/m.test(content)) {
    content = content.replace(/^ML_CLIENT_SECRET=.*$/m, line);
  } else {
    content = content.trimEnd() + (content.trimEnd() ? "\n" : "") + `${line}\n`;
  }

  fs.writeFileSync(envPath, content, "utf8");
  process.env.ML_CLIENT_SECRET = secret;
}

export type UpdateAppSettingsInput = {
  marginPercent?: number;
  autoSyncMode?: AutoSyncMode;
  autoPauseWhenUnavailable?: boolean;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  aiProvider?: AiProviderId;
  aiBaseUrl?: string;
  aiModel?: string;
  aiCliCommand?: string;
  aiCliArgs?: string[];
  aiMaxTokens?: number;
  defaultListingTypeId?: ListingTypeId;
  defaultFreeShipping?: boolean;
  defaultLocalPickUp?: boolean;
  defaultShippingMode?: ShippingMode;
  defaultWarrantyType?: string;
  defaultWarrantyTime?: string;
  catalogStockPercent?: number;
  shopeeDefaultWeightKg?: number;
  shopeeDefaultDaysToShip?: number;
  /** When provided (non-empty), stores server-side and updates `.env`. */
  mlClientSecret?: string;
  /** When provided (non-empty), stores server-side. Empty/omitted leaves the current key unchanged. */
  aiApiKey?: string;
  /** When provided (non-empty), stores server-side. Empty/omitted leaves the current key unchanged. */
  shopeePartnerKey?: string;
};

export async function updateAppSettings(
  input: UpdateAppSettingsInput
): Promise<AppSettingsView> {
  const data: Record<string, unknown> = {};
  if (input.marginPercent !== undefined) data.marginPercent = input.marginPercent;
  if (input.autoSyncMode !== undefined) data.autoSyncMode = input.autoSyncMode;
  if (input.autoPauseWhenUnavailable !== undefined) {
    data.autoPauseWhenUnavailable = input.autoPauseWhenUnavailable;
  }
  if (input.ollamaBaseUrl !== undefined) data.ollamaBaseUrl = input.ollamaBaseUrl;
  if (input.ollamaModel !== undefined) data.ollamaModel = input.ollamaModel;
  if (input.aiProvider !== undefined) data.aiProvider = input.aiProvider;
  if (input.aiBaseUrl !== undefined) data.aiBaseUrl = input.aiBaseUrl;
  if (input.aiModel !== undefined) data.aiModel = input.aiModel;
  if (input.aiCliCommand !== undefined) data.aiCliCommand = input.aiCliCommand;
  if (input.aiCliArgs !== undefined) data.aiCliArgs = JSON.stringify(input.aiCliArgs);
  if (input.aiMaxTokens !== undefined) data.aiMaxTokens = input.aiMaxTokens;
  if (input.defaultListingTypeId !== undefined) {
    data.defaultListingTypeId = input.defaultListingTypeId;
  }
  if (input.defaultFreeShipping !== undefined) {
    data.defaultFreeShipping = input.defaultFreeShipping;
  }
  if (input.defaultLocalPickUp !== undefined) {
    data.defaultLocalPickUp = input.defaultLocalPickUp;
  }
  if (input.defaultShippingMode !== undefined) {
    data.defaultShippingMode = input.defaultShippingMode;
  }
  if (input.defaultWarrantyType !== undefined) {
    data.defaultWarrantyType = input.defaultWarrantyType;
  }
  if (input.defaultWarrantyTime !== undefined) {
    data.defaultWarrantyTime = input.defaultWarrantyTime;
  }
  if (input.catalogStockPercent !== undefined) {
    data.catalogStockPercent = input.catalogStockPercent;
  }
  if (input.shopeeDefaultWeightKg !== undefined) {
    data.shopeeDefaultWeightKg = input.shopeeDefaultWeightKg;
  }
  if (input.shopeeDefaultDaysToShip !== undefined) {
    data.shopeeDefaultDaysToShip = input.shopeeDefaultDaysToShip;
  }

  const percentChanged = input.catalogStockPercent !== undefined;

  if (input.mlClientSecret !== undefined) {
    const secret = String(input.mlClientSecret).trim();
    if (secret) {
      data.mlClientSecret = secret;
      try {
        upsertEnvFileSecret(secret);
      } catch {
        // DB store is enough; .env write is best-effort
      }
    }
  }

  if (input.aiApiKey !== undefined) {
    const key = String(input.aiApiKey).trim();
    if (key) data.aiApiKey = key;
  }

  if (input.shopeePartnerKey !== undefined) {
    const key = String(input.shopeePartnerKey).trim();
    if (key) data.shopeePartnerKey = key;
  }

  const row = await prisma.appSettings.upsert({
    where: { id: "default" },
    create: {
      ...DEFAULTS,
      ...data,
      autoSyncMode: (data.autoSyncMode as string) || DEFAULTS.autoSyncMode,
    },
    update: data,
  });

  if (percentChanged && input.catalogStockPercent !== undefined) {
    const { reapplyCatalogStockPercent } = await import("@/lib/sync/reapply-stock");
    await reapplyCatalogStockPercent(input.catalogStockPercent);
  }

  return toView(row);
}
