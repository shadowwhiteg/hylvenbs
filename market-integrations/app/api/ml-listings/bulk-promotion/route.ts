import { NextRequest, NextResponse } from "next/server";
import { applyBulkDiscount } from "@/lib/ml/promotions-sync";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const percent = Number(body.percent);

  if (!ids.length) {
    return NextResponse.json({ error: "ids obrigatório" }, { status: 400 });
  }
  if (!(percent > 0 && percent < 100)) {
    return NextResponse.json({ error: "percent inválido (entre 0 e 100)" }, { status: 400 });
  }

  const result = await applyBulkDiscount({ ids, percent });
  return NextResponse.json({ ok: true, ...result });
}
