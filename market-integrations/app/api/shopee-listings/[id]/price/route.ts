import { NextRequest, NextResponse } from "next/server";
import { applyShopeeBulkPrice } from "@/lib/shopee/promotions-sync";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const price = body.price != null ? Number(body.price) : undefined;
  const marginPercent = body.marginPercent != null ? Number(body.marginPercent) : undefined;

  if (price == null && marginPercent == null) {
    return NextResponse.json({ error: "Informe price ou marginPercent" }, { status: 400 });
  }

  const result = await applyShopeeBulkPrice({ ids: [id], price, marginPercent });
  if (result.errors.length) {
    return NextResponse.json({ error: result.errors[0] }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...result });
}
