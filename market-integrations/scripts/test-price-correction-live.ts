import { prisma } from "@/lib/db";
import { getItemsMultiget, updateItem } from "@/lib/ml/client";
import { simulateCosts } from "@/lib/pricing/simulator";
import { applyBulkPrice } from "@/lib/ml/promotions-sync";

async function main() {
  const products = await prisma.product.findMany({
    where: { mlItemId: { not: null }, costPrice: { gt: 0 } },
    select: {
      mlItemId: true,
      costPrice: true,
      title: true,
      draft: { select: { listingTypeId: true } },
    },
    take: 60,
  });

  const ids = products.map((p) => p.mlItemId!).filter(Boolean);
  const { items } = await getItemsMultiget(ids);
  const byId = new Map(items.map((i) => [i.id, i]));

  let picked:
    | {
        mlItemId: string;
        costPrice: number;
        listingTypeId: string;
        livePrice: number;
        title: string;
        status: string;
      }
    | null = null;

  for (const p of products) {
    const live = byId.get(p.mlItemId as string);
    if (!live) continue;
    if (live.catalog_listing) continue;
    if (live.status !== "active" && live.status !== "paused") continue;
    picked = {
      mlItemId: p.mlItemId as string,
      costPrice: p.costPrice,
      listingTypeId: p.draft?.listingTypeId || live.listing_type_id || "gold_special",
      livePrice: Number(live.price),
      title: live.title || p.title,
      status: live.status,
    };
    if (live.status === "active") break;
  }

  if (!picked) {
    console.error("Nenhum anúncio modificável (active/paused, não catálogo) encontrado.");
    process.exit(1);
  }

  const marginPercent = 28;
  const expected = simulateCosts({
    costPrice: picked.costPrice,
    listingTypeId: picked.listingTypeId,
    marginPercent,
  }).suggestedPrice;

  console.log(
    JSON.stringify(
      {
        listingId: picked.mlItemId,
        title: picked.title,
        status: picked.status,
        costPrice: picked.costPrice,
        priceBeforeLive: picked.livePrice,
        marginPercent,
        listingTypeId: picked.listingTypeId,
        expectedPrice: expected,
      },
      null,
      2
    )
  );

  const result = await applyBulkPrice(
    { ids: [picked.mlItemId], marginPercent },
    { delayMs: 0 }
  );

  const afterDb = await prisma.mlListing.findUnique({
    where: { id: picked.mlItemId },
    select: { price: true },
  });
  const afterLive = await getItemsMultiget([picked.mlItemId]);
  const livePrice = afterLive.items[0] ? Number(afterLive.items[0].price) : null;

  console.log(
    JSON.stringify(
      {
        result,
        priceAfterDb: afterDb?.price,
        priceAfterLive: livePrice,
        expectedPrice: expected,
      },
      null,
      2
    )
  );

  const ok =
    result.updated === 1 &&
    livePrice != null &&
    Math.abs(livePrice - expected) < 0.05;

  if (!ok) {
    console.error("FALHA: preço no ML não refletiu a margem informada.");
    // Show PUT error detail if any
    if (result.errors.length) {
      const probe = await updateItem(picked.mlItemId, { price: expected });
      console.error("probe", probe.status, String(probe.raw).slice(0, 600));
    }
    process.exit(1);
  }

  console.log("OK LIVE: correção de preço aumentou/ajustou o preço no ML conforme a margem %.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
