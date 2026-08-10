import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scrapeMeuDropAnnouncements } from "@/lib/scrape/announcements";

export async function GET() {
  const announcements = await prisma.meuDropAnnouncement.findMany({
    orderBy: { capturedAt: "desc" },
    take: 30,
  });
  return NextResponse.json({ announcements });
}

export async function POST() {
  try {
    const result = await scrapeMeuDropAnnouncements();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
