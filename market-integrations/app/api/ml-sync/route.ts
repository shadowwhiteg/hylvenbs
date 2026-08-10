import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runMlListingSync } from "@/lib/ml/listing-sync";

export async function GET() {
  const last = await prisma.mlSyncRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  const recent = await prisma.mlSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  return NextResponse.json({ last, recent });
}

export async function POST(_req: NextRequest) {
  try {
    const run = await runMlListingSync();
    return NextResponse.json({ status: run.status, run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const result = await prisma.mlSyncRun.deleteMany({});
  return NextResponse.json({ ok: true, deleted: result.count });
}
