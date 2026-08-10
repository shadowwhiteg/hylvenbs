import { NextRequest, NextResponse } from "next/server";
import { applyMarginToProducts } from "@/lib/agent/tools";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const productIds = Array.isArray(body.productIds)
    ? (body.productIds as string[])
    : [];
  const marginPercent = Number(body.marginPercent);
  const pushToMl = Boolean(body.pushToMl);
  const setOverride = body.setOverride !== false;

  const result = await applyMarginToProducts({
    productIds,
    marginPercent,
    pushToMl,
    setOverride,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data);
}
