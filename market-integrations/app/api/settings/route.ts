import { NextRequest, NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/ml/auth";
import {
  getAppSettings,
  hasAiApiKey,
  hasMlClientSecret,
  hasShopeePartnerKey,
  isListingTypeId,
  isShippingMode,
  updateAppSettings,
} from "@/lib/settings";
import { isAiProviderId } from "@/lib/agent/providers/meta";
import { isAutoSyncMode } from "@/lib/sync/auto-sync-policy";
import { getTunnelInfo } from "@/lib/tunnel/manager";

export async function GET() {
  const settings = await getAppSettings();
  const ml = await getAuthStatus();
  const tunnel = getTunnelInfo();
  const hasSecret = await hasMlClientSecret();
  const hasAiKey = await hasAiApiKey();
  const hasShopeeKey = await hasShopeePartnerKey();
  return NextResponse.json({
    settings,
    ml,
    tunnelUrl: tunnel.tunnelUrl,
    tunnelStatus: tunnel.tunnelStatus,
    oauthCallbackUrl: tunnel.oauthCallbackUrl,
    notificationsCallbackUrl: tunnel.notificationsCallbackUrl,
    hasMlClientSecret: hasSecret,
    hasAiApiKey: hasAiKey,
    hasShopeePartnerKey: hasShopeeKey,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const patch: Parameters<typeof updateAppSettings>[0] = {};

  if (body.marginPercent !== undefined) {
    const marginPercent = Number(body.marginPercent);
    if (!(marginPercent >= 0 && marginPercent < 100)) {
      return NextResponse.json({ error: "marginPercent inválido" }, { status: 400 });
    }
    patch.marginPercent = marginPercent;
  }

  if (body.autoSyncMode !== undefined) {
    if (!isAutoSyncMode(String(body.autoSyncMode))) {
      return NextResponse.json({ error: "autoSyncMode inválido" }, { status: 400 });
    }
    patch.autoSyncMode = body.autoSyncMode;
  }

  if (body.autoPauseWhenUnavailable !== undefined) {
    patch.autoPauseWhenUnavailable = Boolean(body.autoPauseWhenUnavailable);
  }

  if (body.ollamaBaseUrl !== undefined) {
    const url = String(body.ollamaBaseUrl).trim();
    if (!url) {
      return NextResponse.json({ error: "ollamaBaseUrl inválido" }, { status: 400 });
    }
    patch.ollamaBaseUrl = url;
  }

  if (body.ollamaModel !== undefined) {
    const model = String(body.ollamaModel).trim();
    if (!model) {
      return NextResponse.json({ error: "ollamaModel inválido" }, { status: 400 });
    }
    patch.ollamaModel = model;
  }

  if (body.aiProvider !== undefined) {
    const provider = String(body.aiProvider).trim();
    if (!isAiProviderId(provider)) {
      return NextResponse.json({ error: "aiProvider inválido" }, { status: 400 });
    }
    patch.aiProvider = provider;
  }

  if (body.aiBaseUrl !== undefined) {
    patch.aiBaseUrl = String(body.aiBaseUrl).trim();
  }

  if (body.aiModel !== undefined) {
    patch.aiModel = String(body.aiModel).trim();
  }

  if (body.aiCliCommand !== undefined) {
    patch.aiCliCommand = String(body.aiCliCommand).trim();
  }

  if (body.aiCliArgs !== undefined) {
    patch.aiCliArgs = Array.isArray(body.aiCliArgs) ? body.aiCliArgs.map(String) : [];
  }

  if (body.aiApiKey !== undefined) {
    const key = String(body.aiApiKey);
    // Empty string = leave unchanged (UI may send placeholder)
    if (key.trim() && !/^•+$/.test(key.trim())) {
      patch.aiApiKey = key.trim();
    }
  }

  if (body.aiMaxTokens !== undefined) {
    const aiMaxTokens = Number(body.aiMaxTokens);
    if (!(Number.isInteger(aiMaxTokens) && aiMaxTokens >= 256 && aiMaxTokens <= 128000)) {
      return NextResponse.json(
        { error: "aiMaxTokens inválido (use um inteiro entre 256 e 128000)" },
        { status: 400 }
      );
    }
    patch.aiMaxTokens = aiMaxTokens;
  }

  if (body.defaultListingTypeId !== undefined) {
    const listingTypeId = String(body.defaultListingTypeId).trim();
    if (!isListingTypeId(listingTypeId)) {
      return NextResponse.json(
        { error: "defaultListingTypeId inválido (use gold_special, gold_pro ou gold)" },
        { status: 400 }
      );
    }
    patch.defaultListingTypeId = listingTypeId;
  }

  if (body.defaultShippingMode !== undefined) {
    const shippingMode = String(body.defaultShippingMode).trim();
    if (!isShippingMode(shippingMode)) {
      return NextResponse.json(
        { error: "defaultShippingMode inválido (use me2, custom ou not_specified)" },
        { status: 400 }
      );
    }
    patch.defaultShippingMode = shippingMode;
  }

  if (body.defaultFreeShipping !== undefined) {
    patch.defaultFreeShipping = Boolean(body.defaultFreeShipping);
  }

  if (body.defaultLocalPickUp !== undefined) {
    patch.defaultLocalPickUp = Boolean(body.defaultLocalPickUp);
  }

  if (body.defaultWarrantyType !== undefined) {
    const warrantyType = String(body.defaultWarrantyType).trim();
    if (!warrantyType) {
      return NextResponse.json(
        { error: "defaultWarrantyType inválido" },
        { status: 400 }
      );
    }
    patch.defaultWarrantyType = warrantyType;
  }

  if (body.defaultWarrantyTime !== undefined) {
    const warrantyTime = String(body.defaultWarrantyTime).trim();
    if (!warrantyTime) {
      return NextResponse.json(
        { error: "defaultWarrantyTime inválido" },
        { status: 400 }
      );
    }
    patch.defaultWarrantyTime = warrantyTime;
  }

  if (body.catalogStockPercent !== undefined) {
    const catalogStockPercent = Number(body.catalogStockPercent);
    if (!(catalogStockPercent >= 0 && catalogStockPercent <= 100)) {
      return NextResponse.json(
        { error: "catalogStockPercent inválido (use 0 a 100)" },
        { status: 400 }
      );
    }
    patch.catalogStockPercent = catalogStockPercent;
  }

  if (body.shopeeDefaultWeightKg !== undefined) {
    const weight = Number(body.shopeeDefaultWeightKg);
    if (!(weight > 0)) {
      return NextResponse.json({ error: "shopeeDefaultWeightKg inválido" }, { status: 400 });
    }
    patch.shopeeDefaultWeightKg = weight;
  }

  if (body.shopeeDefaultDaysToShip !== undefined) {
    const dts = Number(body.shopeeDefaultDaysToShip);
    if (!(dts >= 0 && Number.isInteger(dts))) {
      return NextResponse.json({ error: "shopeeDefaultDaysToShip inválido" }, { status: 400 });
    }
    patch.shopeeDefaultDaysToShip = dts;
  }

  if (body.shopeePartnerKey !== undefined) {
    const key = String(body.shopeePartnerKey);
    if (key.trim() && !/^•+$/.test(key.trim())) {
      patch.shopeePartnerKey = key.trim();
    }
  }

  if (body.mlClientSecret !== undefined) {
    const secret = String(body.mlClientSecret);
    // Empty string = leave unchanged (UI may send placeholder)
    if (secret.trim() && !/^•+$/.test(secret.trim())) {
      patch.mlClientSecret = secret.trim();
    }
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const settings = await updateAppSettings(patch);
  const hasSecret = await hasMlClientSecret();
  const hasAiKey = await hasAiApiKey();
  const hasShopeeKey = await hasShopeePartnerKey();
  const tunnel = getTunnelInfo();
  // Never echo the secrets back
  return NextResponse.json({
    settings,
    hasMlClientSecret: hasSecret,
    hasAiApiKey: hasAiKey,
    hasShopeePartnerKey: hasShopeeKey,
    tunnelUrl: tunnel.tunnelUrl,
    tunnelStatus: tunnel.tunnelStatus,
    oauthCallbackUrl: tunnel.oauthCallbackUrl,
    notificationsCallbackUrl: tunnel.notificationsCallbackUrl,
  });
}
