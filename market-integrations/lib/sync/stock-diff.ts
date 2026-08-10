import { prisma } from "@/lib/db";

export type StockDiffResult = {
  checked: number;
  changed: number;
  seeded: number;
};

/**
 * Compara o estoque atual de cada Product contra o último StockSnapshot
 * salvo. Primeira execução por produto só semeia o snapshot (não existe
 * "anterior" real ainda, então não vira uma linha de mudança).
 */
export async function runStockDiffCheck(
  source: "cron" | "manual" = "cron"
): Promise<StockDiffResult> {
  const products = await prisma.product.findMany({
    select: { id: true, title: true, stock: true, sourceStock: true },
  });
  const snapshots = await prisma.stockSnapshot.findMany();
  const snapshotByProduct = new Map(snapshots.map((s) => [s.productId, s]));

  let changed = 0;
  let seeded = 0;

  for (const product of products) {
    const previous = snapshotByProduct.get(product.id);
    if (!previous) {
      await prisma.stockSnapshot.create({
        data: { productId: product.id, stock: product.stock, sourceStock: product.sourceStock },
      });
      seeded += 1;
      continue;
    }

    if (previous.stock !== product.stock) {
      await prisma.stockChangeLog.create({
        data: {
          productId: product.id,
          productTitle: product.title,
          previousStock: previous.stock,
          newStock: product.stock,
          delta:
            previous.stock != null && product.stock != null
              ? product.stock - previous.stock
              : null,
          source,
        },
      });
      changed += 1;
    }

    if (previous.stock !== product.stock || previous.sourceStock !== product.sourceStock) {
      await prisma.stockSnapshot.update({
        where: { productId: product.id },
        data: { stock: product.stock, sourceStock: product.sourceStock },
      });
    }
  }

  return { checked: products.length, changed, seeded };
}
