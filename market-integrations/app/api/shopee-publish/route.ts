import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueShopeePublish } from "@/lib/shopee/publish/worker";

export async function GET() {
  const jobs = await prisma.shopeePublishJob.findMany({
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const job = await enqueueShopeePublish({
      productIds: body.productIds,
      kitIds: body.kitIds,
    });
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Conecte") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE() {
  const [, jobs] = await prisma.$transaction([
    prisma.shopeePublishJobItem.deleteMany({}),
    prisma.shopeePublishJob.deleteMany({}),
  ]);
  return NextResponse.json({ ok: true, deleted: jobs.count });
}
