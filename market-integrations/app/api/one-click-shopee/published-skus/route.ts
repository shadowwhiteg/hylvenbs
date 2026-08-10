import { NextResponse } from "next/server";
import { loadPublishedListingIds, loadPublishedSkus } from "@/lib/oneclick/load-published-skus";

export async function GET() {
  const [skus, itemIds] = await Promise.all([
    loadPublishedSkus("shopee"),
    loadPublishedListingIds("shopee"),
  ]);
  return NextResponse.json({ skus, itemIds });
}
