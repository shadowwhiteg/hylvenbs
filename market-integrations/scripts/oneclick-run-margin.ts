/**
 * Dispara um job One Click com preço calculado por MARGEM DE LÍQUIDA, usando a
 * mesma API que o botão da aba usa (`POST /api/one-click-{ml,shopee}`).
 *
 * Existe porque a aba precisa de um clique no navegador; aqui o mesmo job é
 * enfileirado a partir do terminal, com os preços resolvidos pelo
 * lib/pricing/marketplace-fees (comissão + taxa fixa antes da margem).
 *
 * Uso:
 *   npx tsx --tsconfig tsconfig.json --env-file=.env scripts/oneclick-run-margin.ts \
 *     --marketplace=shopee --mode=sync   --margin=5 [--apply]
 *   npx tsx ... --marketplace=shopee --mode=publish --margin=5 [--apply]
 *
 * Sem --apply só imprime o que faria (dry-run).
 */
import { prisma } from "@/lib/db";
import { solvePriceForMargin } from "@/lib/pricing/marketplace-fees";

function arg(name: string, fallback = ""): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

async function main() {
  const marketplace = (arg("marketplace", "shopee") === "ml" ? "ml" : "shopee") as "ml" | "shopee";
  const mode = arg("mode", "sync") === "publish" ? "publish" : "sync";
  const margin = Number(arg("margin", "5"));
  const listingType = arg("listingType", "gold_special");
  const apply = process.argv.includes("--apply");
  const base = process.env.APP_URL || "http://localhost:3000";

  if (!Number.isFinite(margin) || margin < 0) throw new Error("--margin inválido");

  const idField = marketplace === "ml" ? "mlItemId" : "shopeeItemId";
  const products = await prisma.product.findMany({
    where: {
      stock: { gt: 0 },
      sku: { not: null },
      ...(mode === "sync" ? { [idField]: { not: null } } : { [idField]: null }),
    },
    select: { id: true, sku: true, title: true, costPrice: true, stock: true },
    orderBy: { title: "asc" },
  });

  const items: { productId: string; sku: string; title: string; price: number }[] = [];
  const skipped: string[] = [];
  let revenue = 0;
  let cost = 0;
  let fees = 0;

  for (const p of products) {
    if (!p.sku?.trim()) continue;
    if (!(p.costPrice > 0)) {
      skipped.push(`${p.sku}: sem custo`);
      continue;
    }
    try {
      const solved = solvePriceForMargin({
        cost: p.costPrice,
        marginPercent: margin,
        marketplace,
        listingTypeId: listingType,
      });
      items.push({ productId: p.id, sku: p.sku, title: p.title, price: solved.price });
      revenue += solved.price;
      cost += p.costPrice;
      fees += solved.commission + solved.fixedFee;
    } catch (e) {
      skipped.push(`${p.sku}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const profit = revenue - cost - fees;
  console.log(
    `${marketplace.toUpperCase()} · modo=${mode} · margem=${margin}% · ${items.length} item(ns)${apply ? "" : " (dry-run)"}`
  );
  console.log(
    `receita R$ ${revenue.toFixed(2)} · taxas R$ ${fees.toFixed(2)} · custo R$ ${cost.toFixed(2)} · lucro R$ ${profit.toFixed(2)} (${revenue ? ((profit / revenue) * 100).toFixed(2) : "0"}%)`
  );
  for (const s of items.slice(0, 8)) console.log(`  ${s.sku.padEnd(30)} R$ ${s.price.toFixed(2)}`);
  if (items.length > 8) console.log(`  … +${items.length - 8}`);
  if (skipped.length) console.log(`ignorados: ${skipped.length} → ${skipped.slice(0, 5).join("; ")}`);

  if (!apply) {
    console.log("\nRode com --apply para enfileirar o job.");
    await prisma.$disconnect();
    return;
  }
  if (!items.length) {
    console.log("Nada a fazer.");
    await prisma.$disconnect();
    return;
  }

  const endpoint = `${base}/api/one-click-${marketplace}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      listingType,
      items: items.map((i) => ({
        productId: i.productId,
        sku: i.sku,
        title: i.title,
        price: i.price,
      })),
    }),
  });
  const json = (await res.json()) as { job?: { id: string }; error?: string };
  if (!res.ok || !json.job) throw new Error(json.error || `HTTP ${res.status}`);
  console.log(`\nJob enfileirado: ${json.job.id}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
