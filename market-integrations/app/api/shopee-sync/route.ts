import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runShopeeListingSync } from "@/lib/shopee/listing-sync";

export async function GET() {
  const last = await prisma.shopeeSyncRun.findFirst({ orderBy: { startedAt: "desc" } });
  const recent = await prisma.shopeeSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  return NextResponse.json({ last, recent });
}

export async function POST(_req: NextRequest) {
  try {
    const run = await runShopeeListingSync();
    return NextResponse.json({ status: run.status, run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const result = await prisma.shopeeSyncRun.deleteMany({});
  return NextResponse.json({ ok: true, deleted: result.count });
}
