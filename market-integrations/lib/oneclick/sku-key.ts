/**
 * Same key as catalog-match (`NFD` + strip accents + alphanumerics only).
 * Used to compare Product.sku against SKUs already present on marketplace listings.
 */
export function normalizePublishedSkuKey(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
