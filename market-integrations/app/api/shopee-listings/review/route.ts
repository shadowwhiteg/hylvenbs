import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueShopeeReviewJob } from "@/lib/shopee/review-job";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : [];

  try {
    const job = await enqueueShopeeReviewJob(ids);
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = await prisma.shopeeReviewJob.findUnique({ where: { id: jobId }, include: { items: true } });
    if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    return NextResponse.json({ job });
  }

  const jobs = await prisma.shopeeReviewJob.findMany({
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ jobs });
}
