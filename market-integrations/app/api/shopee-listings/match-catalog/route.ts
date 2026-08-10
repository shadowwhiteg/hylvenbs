import { NextRequest, NextResponse } from "next/server";
import { matchAvulsoShopeeListingsToCatalog } from "@/lib/shopee-listings/catalog-match";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) && body.ids.length ? (body.ids as string[]) : undefined;

  const result = await matchAvulsoShopeeListingsToCatalog(ids);
  return NextResponse.json({ ok: true, ...result });
}
