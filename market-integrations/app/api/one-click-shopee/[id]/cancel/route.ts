import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cancelOneClickJob } from "@/lib/oneclick/worker";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const job = await prisma.oneClickJob.findUnique({ where: { id } });
    if (!job || job.marketplace !== "shopee") {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }
    const cancelled = await cancelOneClickJob(id);
    return NextResponse.json({ job: cancelled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
