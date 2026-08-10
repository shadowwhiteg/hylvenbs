/**
 * Recuperação pontual: o bug do `item_id` numérico da Shopee (corrigido em
 * lib/oneclick/client.ts + worker.ts) marcava o item como "error" e descartava o
 * id do anúncio que a Shopee ACABOU de criar. A mensagem de erro do Prisma, no
 * entanto, ecoava o id — então dá para recuperá-lo do próprio histórico.
 *
 * Sem isso, os produtos ficam sem `shopeeItemId` e o botão "Selecionar todos não
 * anunciados" tentaria publicá-los outra vez, duplicando anúncios.
 *
 * Uso: npx tsx --tsconfig tsconfig.json --env-file=.env scripts/recover-lost-oneclick-ids.ts [--apply]
 */
import { prisma } from "@/lib/db";

const ID_FROM_ERROR = /resultItemId:\s*(\d+)/;

async function main() {
  const apply = process.argv.includes("--apply");

  const broken = await prisma.oneClickJobItem.findMany({
    where: { status: "error", error: { contains: "resultItemId" } },
    include: { job: { select: { marketplace: true } } },
  });

  console.log(`Itens com id recuperável: ${broken.length}${apply ? "" : " (dry-run)"}\n`);

  let updatedItems = 0;
  let updatedProducts = 0;
  const skipped: string[] = [];

  for (const item of broken) {
    const match = item.error?.match(ID_FROM_ERROR);
    const itemId = match?.[1];
    if (!itemId) {
      skipped.push(`${item.sku}: id não encontrado na mensagem`);
      continue;
    }

    const field = item.job.marketplace === "shopee" ? "shopeeItemId" : "mlItemId";
    console.log(`${item.sku} → ${itemId} (${item.job.marketplace}.${field})`);

    if (!apply) continue;

    await prisma.oneClickJobItem.update({
      where: { id: item.id },
      data: {
        status: "success",
        resultItemId: itemId,
        error: `Recuperado do histórico: anúncio criado, registro local havia falhado (bug do item_id numérico)`,
      },
    });
    updatedItems += 1;

    if (item.productId) {
      const existing = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { id: true, shopeeItemId: true, mlItemId: true },
      });
      if (!existing) {
        skipped.push(`${item.sku}: produto não existe mais`);
        continue;
      }
      const current = field === "shopeeItemId" ? existing.shopeeItemId : existing.mlItemId;
      if (current && current !== itemId) {
        skipped.push(`${item.sku}: já tem ${field}=${current}, mantido`);
        continue;
      }
      await prisma.product.update({
        where: { id: item.productId },
        data: { [field]: itemId, status: "published" },
      });
      updatedProducts += 1;
    }
  }

  console.log(
    `\n${apply ? "Aplicado" : "Simulado"}: ${updatedItems} item(ns) de job, ${updatedProducts} produto(s) vinculados.`
  );
  if (skipped.length) {
    console.log("Ignorados:");
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (!apply) console.log("\nRode com --apply para gravar.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
