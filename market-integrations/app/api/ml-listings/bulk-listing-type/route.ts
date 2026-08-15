import { NextRequest, NextResponse } from "next/server";
import { applyBulkListingType, parseMlListingType } from "@/lib/ml/listing-type";

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter(Boolean) : [];
  const listingTypeId = parseMlListingType(body.listingTypeId);

  if (!ids.length) {
    return NextResponse.json({ error: "ids obrigatório" }, { status: 400 });
  }
  if (!listingTypeId) {
    return NextResponse.json(
      { error: "listingTypeId deve ser 'gold_special' ou 'gold_pro'" },
      { status: 400 }
    );
  }

  const result = await applyBulkListingType({ ids, listingTypeId });
  return NextResponse.json({ ok: true, ...result });
}
