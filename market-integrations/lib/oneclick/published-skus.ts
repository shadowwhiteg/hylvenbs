import { readSkuAndEan } from "@/lib/ml/listing-review";
import { normalizePublishedSkuKey } from "@/lib/oneclick/sku-key";

export { normalizePublishedSkuKey };

/** Collect unique normalized SKUs from ML listing attribute snapshots (SELLER_SKU). */
export function collectPublishedSkuKeysFromMlListings(
  listings: { attributesJson: string }[]
): string[] {
  const skus = new Set<string>();
  for (const listing of listings) {
    const { sku } = readSkuAndEan(listing.attributesJson);
    const key = normalizePublishedSkuKey(sku);
    if (key) skus.add(key);
  }
  return [...skus];
}

/** Collect unique normalized SKUs from Shopee listing `itemSku` fields. */
export function collectPublishedSkuKeysFromShopeeListings(
  listings: { itemSku: string | null }[]
): string[] {
  const skus = new Set<string>();
  for (const listing of listings) {
    const key = normalizePublishedSkuKey(listing.itemSku);
    if (key) skus.add(key);
  }
  return [...skus];
}
