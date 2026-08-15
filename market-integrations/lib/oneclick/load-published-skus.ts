import { prisma } from "@/lib/db";
import type { OneClickMarketplace } from "@/lib/oneclick/bulk";
import {
  collectPublishedSkuKeysFromMlListings,
  collectPublishedSkuKeysFromShopeeListings,
} from "@/lib/oneclick/published-skus";

/** Loads marketplace listing SKUs already synced locally (normalized). */
export async function loadPublishedSkus(marketplace: OneClickMarketplace): Promise<string[]> {
  if (marketplace === "ml") {
    const listings = await prisma.mlListing.findMany({ select: { attributesJson: true } });
    return collectPublishedSkuKeysFromMlListings(listings);
  }
  const listings = await prisma.shopeeListing.findMany({ select: { itemSku: true } });
  return collectPublishedSkuKeysFromShopeeListings(listings);
}

/**
 * Ids of listings that still exist on the marketplace (as of the last sync).
 * `Product.mlItemId`/`shopeeItemId` may point to a deleted listing — those links
 * must not count as "already announced".
 */
export async function loadPublishedListingIds(
  marketplace: OneClickMarketplace
): Promise<string[]> {
  const listings =
    marketplace === "ml"
      ? await prisma.mlListing.findMany({ select: { id: true } })
      : await prisma.shopeeListing.findMany({ select: { id: true } });

  // Anúncio recém-criado pelo One Click só entra no snapshot depois de um
  // "Atualizar agora". Sem os ids dos jobs concluídos, uma seleção em massa
  // logo após publicar re-selecionaria os mesmos produtos.
  //
  // O filtro NÃO é por status "success": um item pode terminar em "error" com o
  // anúncio já criado (falha ao gravar localmente, ver worker). Ter
  // `resultItemId` é a prova de que o anúncio existe no marketplace — republicar
  // esse SKU criaria duplicata.
  const justPublished = await prisma.oneClickJobItem.findMany({
    where: { NOT: { resultItemId: null }, job: { marketplace } },
    select: { resultItemId: true },
  });

  return Array.from(
    new Set([...listings.map((l) => l.id), ...justPublished.map((i) => i.resultItemId as string)])
  );
}
