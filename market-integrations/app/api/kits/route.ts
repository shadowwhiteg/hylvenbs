import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createKitFromProducts } from "@/lib/kits/create";

export async function GET() {
  const kits = await prisma.kit.findMany({
    include: { items: { include: { product: true } }, draft: true, shopeeDraft: true },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ kits });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const productIds = (body.productIds || []) as string[];
  try {
    const kit = await createKitFromProducts(productIds);
    return NextResponse.json({ kit });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
