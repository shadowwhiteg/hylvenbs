import { NextResponse } from "next/server";
import { loadPublishedListingIds, loadPublishedSkus } from "@/lib/oneclick/load-published-skus";

export async function GET() {
  const [skus, itemIds] = await Promise.all([
    loadPublishedSkus("ml"),
    loadPublishedListingIds("ml"),
  ]);
  return NextResponse.json({ skus, itemIds });
}
