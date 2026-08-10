import { NextResponse } from "next/server";
import { verifyStoredAccessToken } from "@/lib/ml/auth";

export async function POST() {
  const result = await verifyStoredAccessToken();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, connected: false, error: result.error },
      { status: 401 }
    );
  }
  return NextResponse.json({
    ok: true,
    connected: true,
    userId: result.userId,
  });
}
