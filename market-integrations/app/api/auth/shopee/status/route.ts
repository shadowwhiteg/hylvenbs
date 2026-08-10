import { NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/shopee/auth";
import { hasShopeePartnerKey } from "@/lib/settings";
import { getTunnelInfo } from "@/lib/tunnel/manager";

export async function GET() {
  const status = await getAuthStatus();
  const tunnel = getTunnelInfo();
  const hasKey = await hasShopeePartnerKey();
  return NextResponse.json({
    ...status,
    tunnelUrl: tunnel.tunnelUrl,
    tunnelStatus: tunnel.tunnelStatus,
    shopeeCallbackUrl: tunnel.shopeeCallbackUrl,
    hasShopeePartnerKey: hasKey,
  });
}
