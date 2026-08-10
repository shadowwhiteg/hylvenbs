import { NextRequest, NextResponse } from "next/server";
import { syncProductPriceFromSource } from "@/lib/sync/price-refresh";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const result = await syncProductPriceFromSource(id);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
