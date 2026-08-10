/** Converte estoque bruto do Meu Drop em estoque do catálogo/anúncio. */
export function applyStockPercent(
  sourceStock: number | null | undefined,
  percent: number
): number | null {
  if (sourceStock === null || sourceStock === undefined) return null;
  if (!Number.isFinite(sourceStock) || sourceStock < 0) return null;
  if (!Number.isFinite(percent)) return sourceStock;
  if (percent >= 100) return Math.floor(sourceStock);
  if (percent <= 0) return 0;
  return Math.floor((sourceStock * percent) / 100);
}
