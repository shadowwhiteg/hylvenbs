/**
 * Real end-to-end check of "Aplicar correção" against a listing linked to a
 * local product with cost. Calls the same applyBulkPrice path the UI uses,
 * with a dry-run option that mocks the ML PUT while still exercising margin math.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/test-price-correction.ts
 *   npx tsx --tsconfig tsconfig.json scripts/test-price-correction.ts --live
 */
import { prisma } from "@/lib/db";
import { simulateCosts } from "@/lib/pricing/simulator";
import { applyBulkPrice } from "@/lib/ml/promotions-sync";
import { updateItem } from "@/lib/ml/client";

async function main() {
  const live = process.argv.includes("--live");
  const marginPercent = 35;

  const products = await prisma.product.findMany({
    where: {
      mlItemId: { not: null },
      costPrice: { gt: 0 },
    },
    select: {
      id: true,
      title: true,
      costPrice: true,
      mlItemId: true,
      draft: { select: { listingTypeId: true } },
    },
    take: 20,
  });

  const candidates = [];
  for (const p of products) {
    const listing = await prisma.mlListing.findUnique({
      where: { id: p.mlItemId as string },
      select: { id: true, title: true, price: true, status: true },
    });
    if (listing) {
      candidates.push({ product: p, listing });
    }
  }

  if (!candidates.length) {
    console.error("Nenhum anúncio ativo com produto/custo local encontrado para teste.");
    process.exit(1);
  }

  const pick = candidates[0];
  const listingTypeId = pick.product.draft?.listingTypeId || "gold_special";
  const expected = simulateCosts({
    costPrice: pick.product.costPrice,
    listingTypeId,
    marginPercent,
  }).suggestedPrice;

  console.log(
    JSON.stringify(
      {
        mode: live ? "LIVE (PUT real no ML)" : "dry-run (PUT mockado)",
        listingId: pick.listing.id,
        title: pick.listing.title,
        costPrice: pick.product.costPrice,
        priceBefore: pick.listing.price,
        marginPercent,
        listingTypeId,
        expectedPrice: expected,
        deltaVsCurrent: Number((expected - pick.listing.price).toFixed(2)),
      },
      null,
      2
    )
  );

  let putPayload: { itemId: string; price: number } | null = null;
  const result = await applyBulkPrice(
    { ids: [pick.listing.id], marginPercent },
    {
      delayMs: 0,
      updateItemFn: live
        ? updateItem
        : async (itemId, payload) => {
            putPayload = { itemId, price: Number((payload as { price?: number }).price) };
            return { ok: true, status: 200, data: { id: itemId, price: putPayload.price }, raw: "{}" };
          },
    }
  );

  const after = await prisma.mlListing.findUnique({
    where: { id: pick.listing.id },
    select: { price: true },
  });

  // putPayload só é atribuído dentro do callback de updateItemFn, que o
  // control-flow analysis do TS não acompanha — daí o cast explícito.
  const sentPrice = live
    ? after?.price
    : (putPayload as { itemId: string; price: number } | null)?.price;
  const ok =
    result.updated === 1 &&
    result.errors.length === 0 &&
    sentPrice != null &&
    Math.abs(sentPrice - expected) < 0.011;

  console.log(
    JSON.stringify(
      {
        result,
        putPayload,
        priceAfterDb: after?.price,
        matchesExpected: ok,
      },
      null,
      2
    )
  );

  if (!ok) {
    console.error("FALHA: preço aplicado não bate com o simulador.");
    process.exit(1);
  }
  console.log("OK: correção de preço calculou e aplicou o valor esperado.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
