import { NextRequest, NextResponse } from "next/server";
import { applyBulkPrice } from "@/lib/ml/promotions-sync";

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const price = body.price != null ? Number(body.price) : undefined;
  const marginPercent = body.marginPercent != null ? Number(body.marginPercent) : undefined;

  if (!ids.length) {
    return NextResponse.json({ error: "ids obrigatório" }, { status: 400 });
  }
  if (price == null && marginPercent == null) {
    return NextResponse.json({ error: "Informe price ou marginPercent" }, { status: 400 });
  }

  const result = await applyBulkPrice({ ids, price, marginPercent });
  return NextResponse.json({ ok: true, ...result });
}
