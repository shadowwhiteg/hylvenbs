import { NextResponse } from "next/server";
import { clearStoredTokens, getAuthStatus } from "@/lib/ml/auth";

export async function POST() {
  await clearStoredTokens();
  const status = await getAuthStatus();
  return NextResponse.json({ ok: true, ...status });
}
