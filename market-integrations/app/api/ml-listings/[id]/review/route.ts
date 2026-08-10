import { NextRequest, NextResponse } from "next/server";
import { reviewListingAgainstCatalog } from "@/lib/ml/listing-review";

/** Preview somente-leitura: mostra o que mudaria (inclui comparação de categoria) sem aplicar nada. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await reviewListingAgainstCatalog(id, { includeCategory: true });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
