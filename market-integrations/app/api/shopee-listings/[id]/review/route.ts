import { NextRequest, NextResponse } from "next/server";
import { reviewShopeeListingAgainstCatalog } from "@/lib/shopee/listing-review";

/** Preview somente-leitura: mostra o que mudaria sem aplicar nada. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await reviewShopeeListingAgainstCatalog(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
