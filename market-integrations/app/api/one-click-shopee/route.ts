import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueOneClick } from "@/lib/oneclick/worker";

export async function GET() {
  const jobs = await prisma.oneClickJob.findMany({
    where: { marketplace: "shopee" },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const job = await enqueueOneClick({ marketplace: "shopee", mode: body.mode, items: body.items || [] });
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const [, jobs] = await prisma.$transaction([
    prisma.oneClickJobItem.deleteMany({ where: { job: { marketplace: "shopee" } } }),
    prisma.oneClickJob.deleteMany({ where: { marketplace: "shopee" } }),
  ]);
  return NextResponse.json({ ok: true, deleted: jobs.count });
}
