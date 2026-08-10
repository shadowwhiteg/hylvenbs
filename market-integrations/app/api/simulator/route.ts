import { NextRequest, NextResponse } from "next/server";
import { simulateCosts } from "@/lib/pricing/simulator";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const result = simulateCosts({
      costPrice: Number(body.costPrice),
      listingTypeId: String(body.listingTypeId || "gold_special"),
      shippingCost: body.shippingCost != null ? Number(body.shippingCost) : 0,
      marginPercent:
        body.marginPercent != null
          ? Number(body.marginPercent)
          : settings?.marginPercent ?? Number(process.env.DEFAULT_MARGIN_PERCENT || 30),
      manualPrice: body.manualPrice != null ? Number(body.manualPrice) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
