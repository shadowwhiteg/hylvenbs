import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const changes = await prisma.stockChangeLog.findMany({
    orderBy: { detectedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ changes });
}
