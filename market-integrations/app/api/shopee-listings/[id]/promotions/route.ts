import { NextRequest, NextResponse } from "next/server";
import { createSingleItemDiscount, endDiscount } from "@/lib/shopee/promotions";

/**
 * A Shopee não expõe uma lista de "promoções candidatas" por item como o ML
 * (get_item_promotions) — desconto é sempre um Discount que o vendedor cria.
 * Por isso este GET só devolve o desconto atual do preço local (se houver)
 * como referência pra tela; aplicar sempre cria um Discount novo de item único.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json({
    promotions: [
      {
        type: "DISCOUNT",
        status: "candidate",
        name: "Desconto de item único (Shopee)",
        id,
      },
    ],
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const dealPrice = body.dealPrice != null ? Number(body.dealPrice) : undefined;

  if (!(dealPrice! > 0)) {
    return NextResponse.json({ error: "dealPrice obrigatório" }, { status: 400 });
  }

  const result = await createSingleItemDiscount(id, dealPrice!);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, discountId: result.discountId });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const discountId = req.nextUrl.searchParams.get("promotionId");
  if (!discountId) {
    return NextResponse.json({ error: "promotionId (discount_id) obrigatório" }, { status: 400 });
  }
  const result = await endDiscount(Number(discountId));
  if (!result.ok) {
    return NextResponse.json({ error: `HTTP ${result.status}` }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
