import { NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/ml/auth";
import { hasMlClientSecret } from "@/lib/settings";
import { getTunnelInfo } from "@/lib/tunnel/manager";

export async function GET() {
  const status = await getAuthStatus();
  const tunnel = getTunnelInfo();
  const hasSecret = await hasMlClientSecret();
  return NextResponse.json({
    ...status,
    tunnelUrl: tunnel.tunnelUrl,
    tunnelStatus: tunnel.tunnelStatus,
    oauthCallbackUrl: tunnel.oauthCallbackUrl,
    notificationsCallbackUrl: tunnel.notificationsCallbackUrl,
    hasMlClientSecret: hasSecret,
  });
}
