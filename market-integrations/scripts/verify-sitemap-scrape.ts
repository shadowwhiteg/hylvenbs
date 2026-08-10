import { scrapeMeuDrop } from "@/lib/scrape/meudrop";
import { runCatalogSync } from "@/lib/sync/run";
import { prisma } from "@/lib/db";

async function main() {
  const mode = process.argv[2] || "listing";
  if (mode === "listing") {
    const r = await scrapeMeuDrop({ skipEnrichment: true });
    console.log(JSON.stringify({ stats: r.stats, warnings: r.warnings }, null, 2));
    return;
  }

  if (mode === "sync") {
    console.log("starting full catalog sync…");
    const finished = await runCatalogSync({ skipMlSync: true });
    console.log(
      JSON.stringify(
        {
          status: finished.status,
          createdCount: finished.createdCount,
          updatedCount: finished.updatedCount,
          unavailableCount: finished.unavailableCount,
          error: finished.error,
        },
        null,
        2
      )
    );
    const total = await prisma.product.count();
    const withSku = await prisma.product.count({
      where: { AND: [{ sku: { not: null } }, { NOT: { sku: "" } }] },
    });
    const unpublished = await prisma.product.count({
      where: {
        mlItemId: null,
        AND: [{ sku: { not: null } }, { NOT: { sku: "" } }],
      },
    });
    console.log(JSON.stringify({ total, withSku, unpublished }, null, 2));
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
