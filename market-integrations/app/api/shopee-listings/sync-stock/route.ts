import { NextRequest, NextResponse } from "next/server";
import { syncShopeeListingStockFromCatalog } from "@/lib/shopee/stock-sync";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) && body.ids.length ? (body.ids as string[]) : undefined;

  const result = await syncShopeeListingStockFromCatalog(ids);
  return NextResponse.json({ ok: true, ...result });
}
