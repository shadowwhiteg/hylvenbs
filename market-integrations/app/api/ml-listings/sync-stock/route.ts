import { NextRequest, NextResponse } from "next/server";
import { syncListingStockFromCatalog } from "@/lib/ml/stock-sync";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) && body.ids.length ? (body.ids as string[]) : undefined;

  const result = await syncListingStockFromCatalog(ids);
  return NextResponse.json({ ok: true, ...result });
}
