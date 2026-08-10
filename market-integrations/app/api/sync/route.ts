import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueCatalogSync } from "@/lib/sync/run";

export async function GET() {
  const last = await prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  const minutes = Number(process.env.CRON_SYNC_MINUTES || 60);
  const nextRunAt = last?.finishedAt
    ? new Date(last.finishedAt.getTime() + minutes * 60_000)
    : null;
  return NextResponse.json({ last, nextRunAt });
}

export async function POST() {
  const { run, alreadyRunning } = await enqueueCatalogSync();
  return NextResponse.json({
    runId: run.id,
    status: run.status,
    alreadyRunning,
    run,
  });
}

export async function DELETE() {
  const result = await prisma.syncRun.deleteMany({});
  return NextResponse.json({ ok: true, deleted: result.count });
}
