import { NextRequest, NextResponse } from "next/server";
import { applyPromotion, cancelPromotion, listItemPromotions } from "@/lib/ml/promotions-sync";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await listItemPromotions(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, promotions: [] }, { status: 400 });
  }
  return NextResponse.json({ promotions: result.promotions });
}

/** PRICE_DISCOUNT é o desconto que o próprio vendedor define — não tem id de campanha, só o tipo. */
function needsPromotionId(promotionType: string): boolean {
  return promotionType !== "PRICE_DISCOUNT";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const promotionId = body.promotionId ? String(body.promotionId) : undefined;
  const promotionType = String(body.promotionType ?? "");
  const dealPrice = body.dealPrice != null ? Number(body.dealPrice) : undefined;

  if (!promotionType) {
    return NextResponse.json({ error: "promotionType obrigatório" }, { status: 400 });
  }
  if (needsPromotionId(promotionType) && !promotionId) {
    return NextResponse.json({ error: "promotionId obrigatório para este tipo" }, { status: 400 });
  }
  if (promotionType === "PRICE_DISCOUNT" && !(dealPrice! > 0)) {
    return NextResponse.json(
      { error: "dealPrice obrigatório para PRICE_DISCOUNT" },
      { status: 400 }
    );
  }

  const result = await applyPromotion(id, { promotionId, promotionType, dealPrice });
  if (!result.ok) {
    return NextResponse.json({ error: `HTTP ${result.status}`, data: result.data }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const promotionId = req.nextUrl.searchParams.get("promotionId") ?? undefined;
  const promotionType = req.nextUrl.searchParams.get("promotionType") ?? "";

  if (!promotionType) {
    return NextResponse.json({ error: "promotionType obrigatório" }, { status: 400 });
  }
  if (needsPromotionId(promotionType) && !promotionId) {
    return NextResponse.json({ error: "promotionId obrigatório para este tipo" }, { status: 400 });
  }

  const result = await cancelPromotion(id, promotionId, promotionType);
  if (!result.ok) {
    return NextResponse.json({ error: `HTTP ${result.status}`, data: result.data }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
