import { prisma } from "@/lib/db";
import { getValidAccessToken } from "@/lib/ml/auth";
import { checkItemsExistence, getItemsMultiget, searchMyItems } from "@/lib/ml/client";

async function resolveUserId(fetchImpl?: typeof fetch): Promise<string> {
  const row = await prisma.mlToken.findUnique({ where: { id: "default" } });
  if (row?.userId) return row.userId;

  // Garante um token válido antes de perguntar quem é o vendedor.
  const token = await getValidAccessToken();
  const res = await (fetchImpl ?? fetch)("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Não foi possível identificar o vendedor (HTTP ${res.status})`);
  const data = (await res.json()) as { id?: number | string };
  if (data.id == null) throw new Error("Resposta de /users/me sem id de vendedor");
  const userId = String(data.id);
  await prisma.mlToken.update({ where: { id: "default" }, data: { userId } });
  return userId;
}

async function collectAllItemIds(userId: string, fetchImpl?: typeof fetch): Promise<string[]> {
  const ids: string[] = [];
  let scrollId: string | undefined;
  // Corte de segurança contra loop infinito se a API devolver scroll_id repetido.
  for (let page = 0; page < 200; page++) {
    const res = await searchMyItems(userId, { scrollId }, fetchImpl);
    if (!res.ok) throw new Error(`items/search falhou (HTTP ${res.status})`);
    const results = res.data.results ?? [];
    ids.push(...results);
    if (!results.length || !res.data.scroll_id || res.data.scroll_id === scrollId) break;
    scrollId = res.data.scroll_id;
  }
  return Array.from(new Set(ids));
}

export type ImportMlListingsResult = {
  imported: number;
  /** Linhas locais apagadas porque o anúncio não existe mais no ML. */
  pruned: number;
  /** Produtos do catálogo cujo vínculo (mlItemId) apontava para anúncio excluído. */
  unlinkedProducts: number;
  errors: string[];
};

/**
 * O snapshot local só espelha o ML se também apagar o que sumiu de lá. Sem isso,
 * anúncios excluídos no ML continuavam "publicados" localmente e o One Click os
 * pulava para sempre ("SKU já anunciado"), impossibilitando republicar.
 *
 * O vínculo do catálogo (`Product.mlItemId`) só é limpo quando a API confirma
 * que o item sumiu — lote com erro de rede fica intocado, e itens recém-criados
 * pelo One Click (ainda fora do índice de busca) são confirmados via GET /items.
 */
async function pruneMissingListings(
  liveIds: Set<string>,
  fetchImpl?: typeof fetch
): Promise<{ pruned: number; unlinkedProducts: number }> {
  const localIds = (await prisma.mlListing.findMany({ select: { id: true } })).map((l) => l.id);
  const linkedIds = (
    await prisma.product.findMany({
      where: { NOT: { mlItemId: null } },
      select: { mlItemId: true },
    })
  ).map((p) => p.mlItemId as string);

  const suspects = Array.from(new Set([...localIds, ...linkedIds])).filter(
    (id) => !liveIds.has(id)
  );
  if (!suspects.length) return { pruned: 0, unlinkedProducts: 0 };

  const { missing } = await checkItemsExistence(suspects, fetchImpl);
  if (!missing.size) return { pruned: 0, unlinkedProducts: 0 };

  const gone = Array.from(missing);
  const { count: pruned } = await prisma.mlListing.deleteMany({ where: { id: { in: gone } } });
  const { count: unlinkedProducts } = await prisma.product.updateMany({
    where: { mlItemId: { in: gone } },
    data: { mlItemId: null, mlPermalink: null },
  });
  // Sem anúncio em nenhum marketplace, "published" vira rótulo falso no catálogo.
  await prisma.product.updateMany({
    where: { mlItemId: null, shopeeItemId: null, status: "published" },
    data: { status: "synced" },
  });

  return { pruned, unlinkedProducts };
}

export async function importMlListings(
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<ImportMlListingsResult> {
  const userId = await resolveUserId(deps.fetchImpl);
  const ids = await collectAllItemIds(userId, deps.fetchImpl);
  const { items, errors } = await getItemsMultiget(ids, deps.fetchImpl);

  let imported = 0;
  for (const item of items) {
    if (!item.id) continue;
    await prisma.mlListing.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        title: item.title ?? "",
        price: item.price ?? 0,
        currencyId: item.currency_id ?? "BRL",
        availableQuantity: item.available_quantity ?? 0,
        soldQuantity: item.sold_quantity ?? 0,
        status: item.status ?? "unknown",
        listingTypeId: item.listing_type_id ?? null,
        categoryId: item.category_id ?? null,
        permalink: item.permalink ?? null,
        thumbnail: item.thumbnail ?? null,
        catalogListing: Boolean(item.catalog_listing),
        tagsJson: JSON.stringify(item.tags ?? []),
        attributesJson: JSON.stringify(item.attributes ?? []),
      },
      update: {
        title: item.title ?? "",
        price: item.price ?? 0,
        currencyId: item.currency_id ?? "BRL",
        availableQuantity: item.available_quantity ?? 0,
        soldQuantity: item.sold_quantity ?? 0,
        status: item.status ?? "unknown",
        listingTypeId: item.listing_type_id ?? null,
        categoryId: item.category_id ?? null,
        permalink: item.permalink ?? null,
        thumbnail: item.thumbnail ?? null,
        catalogListing: Boolean(item.catalog_listing),
        tagsJson: JSON.stringify(item.tags ?? []),
        attributesJson: JSON.stringify(item.attributes ?? []),
        lastApiSyncAt: new Date(),
      },
    });
    imported += 1;
  }

  const { pruned, unlinkedProducts } = await pruneMissingListings(new Set(ids), deps.fetchImpl);

  return { imported, pruned, unlinkedProducts, errors };
}
