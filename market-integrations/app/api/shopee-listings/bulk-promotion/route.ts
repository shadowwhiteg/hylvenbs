import { NextRequest, NextResponse } from "next/server";
import { applyShopeeBulkDiscount } from "@/lib/shopee/promotions";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];
  const percent = Number(body.percent);

  if (!ids.length) {
    return NextResponse.json({ error: "ids obrigatório" }, { status: 400 });
  }

  const result = await applyShopeeBulkDiscount({ ids, percent });
  return NextResponse.json({ ok: true, ...result });
}
