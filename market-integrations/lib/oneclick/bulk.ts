import { normalizePublishedSkuKey } from "@/lib/oneclick/sku-key";

/** Product fields needed to decide One Click bulk selection. */
export type OneClickBulkProduct = {
  id: string;
  title: string;
  sku?: string | null;
  stock?: number | null;
  costPrice?: number | null;
  mlItemId?: string | null;
  shopeeItemId?: string | null;
};

export type OneClickBulkKind = "unpublished" | "sync";
export type OneClickMarketplace = "ml" | "shopee";

export const ONE_CLICK_BULK_PAGE_SIZE = 500;

/**
 * Meu Drop's One Click picker (`wmd_search_products`) only returns products that
 * are currently available (typically in stock). Out-of-stock catalog SKUs are
 * real, but the search returns [] → "SKU não encontrado".
 */
export function isOneClickSearchableStock(stock: number | null | undefined): boolean {
  return typeof stock === "number" && stock > 0;
}

/** Query params for server-filtered bulk product pages. */
export function buildOneClickBulkProductParams(
  kind: OneClickBulkKind,
  marketplace: OneClickMarketplace,
  page: number,
  pageSize: number = ONE_CLICK_BULK_PAGE_SIZE
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("marketplace", marketplace);
  params.set("published", kind === "unpublished" ? "no" : "yes");
  if (kind === "unpublished") params.set("stock", "in");
  return params;
}

/**
 * Stop when the batch is empty, shorter than pageSize, or we've loaded `total`
 * (only when `total` is a positive finite number — avoids stopping on total=0/undefined).
 */
export function shouldStopBulkPagination(opts: {
  batchLength: number;
  pageSize: number;
  loadedCount: number;
  total: unknown;
}): boolean {
  const { batchLength, pageSize, loadedCount, total } = opts;
  if (batchLength === 0) return true;
  if (batchLength < pageSize) return true;
  if (typeof total === "number" && Number.isFinite(total) && total > 0 && loadedCount >= total) {
    return true;
  }
  return false;
}

/**
 * `Product.mlItemId` / `shopeeItemId` go stale when a listing is deleted on the
 * marketplace: the id stays on the catalog row but no listing exists anymore, so
 * the product was silently treated as "already announced" and skipped by the
 * bulk publish button. When `liveListingIds` is given, only ids still present in
 * the synced listings count as a real link.
 *
 * Passar `undefined` significa "não sei quais anúncios existem" (falha ao
 * carregar) e mantém a confiança no id gravado. Um Set **vazio** é informação:
 * a conta não tem nenhum anúncio, logo nenhum vínculo local é real — confundir
 * os dois fazia o bulk pular todo o catálogo justamente quando não havia nada
 * publicado.
 */
export function selectOneClickBulkCandidates<T extends OneClickBulkProduct>(
  products: T[],
  kind: OneClickBulkKind,
  marketplace: OneClickMarketplace,
  publishedSkus?: Set<string>,
  liveListingIds?: Set<string>
): {
  selected: T[];
  skippedOutOfStock: number;
  skippedWithoutSku: number;
  skippedAlreadyPublished: number;
  staleLinks: number;
} {
  const listingId = (p: T) => (marketplace === "ml" ? p.mlItemId : p.shopeeItemId);
  const isLinked = (p: T) => {
    const id = listingId(p);
    if (!id) return false;
    if (liveListingIds) return liveListingIds.has(id);
    return true;
  };

  let skippedOutOfStock = 0;
  let skippedWithoutSku = 0;
  let skippedAlreadyPublished = 0;
  let staleLinks = 0;
  const selected: T[] = [];

  for (const p of products) {
    if (!!listingId(p) && !isLinked(p)) staleLinks += 1;
    if (kind === "unpublished" ? isLinked(p) : !isLinked(p)) continue;

    if (!p.sku?.trim()) {
      skippedWithoutSku += 1;
      continue;
    }

    // Catalog Product may lack mlItemId/shopeeItemId while the SKU already exists on a synced listing.
    if (kind === "unpublished" && publishedSkus?.size) {
      const key = normalizePublishedSkuKey(p.sku);
      if (key && publishedSkus.has(key)) {
        skippedAlreadyPublished += 1;
        continue;
      }
    }

    // Sync already-linked listings even if stock is 0 (price/link refresh).
    // Publish requires searchable stock in the One Click picker.
    if (kind === "unpublished" && !isOneClickSearchableStock(p.stock)) {
      skippedOutOfStock += 1;
      continue;
    }
    selected.push(p);
  }

  return { selected, skippedOutOfStock, skippedWithoutSku, skippedAlreadyPublished, staleLinks };
}

export function formatOneClickBulkSelectionMessage(opts: {
  kind: OneClickBulkKind;
  marketplace: OneClickMarketplace;
  selectedCount: number;
  catalogTotal: number;
  skippedOutOfStock: number;
  skippedWithoutSku: number;
  skippedAlreadyPublished?: number;
  staleLinks?: number;
}): string {
  const label = opts.marketplace === "ml" ? "ML" : "Shopee";
  if (opts.kind === "unpublished") {
    const parts = [
      `Selecionados ${opts.selectedCount} com estoque e sem anúncio ${label}.`,
      `Total elegível no catálogo: ${opts.catalogTotal}.`,
    ];
    if (opts.skippedOutOfStock > 0) {
      parts.push(`Ignorados sem estoque: ${opts.skippedOutOfStock}.`);
    }
    if (opts.skippedWithoutSku > 0) {
      parts.push(`Sem SKU: ${opts.skippedWithoutSku}.`);
    }
    if ((opts.skippedAlreadyPublished ?? 0) > 0) {
      parts.push(
        opts.marketplace === "ml"
          ? `Ignorados já no ML (SKU): ${opts.skippedAlreadyPublished}.`
          : `Ignorados já na Shopee (SKU): ${opts.skippedAlreadyPublished}.`
      );
    }
    if ((opts.staleLinks ?? 0) > 0) {
      parts.push(
        `Incluídos ${opts.staleLinks} com vínculo antigo cujo anúncio não existe mais no ${label}.`
      );
    }
    return parts.join(" ");
  }
  const parts = [
    `Selecionados ${opts.selectedCount} já anunciados (${label}) para sincronizar.`,
    `Total elegível no catálogo: ${opts.catalogTotal}.`,
  ];
  if (opts.skippedWithoutSku > 0) {
    parts.push(`Sem SKU: ${opts.skippedWithoutSku}.`);
  }
  return parts.join(" ");
}

/** Groups job item errors into short labels for the progress panel. */
export function summarizeOneClickErrors(
  items: { status: string; error?: string | null }[]
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.status !== "error" && item.status !== "conflict") continue;
    const label = classifyOneClickError(item.error);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function classifyOneClickError(error: string | null | undefined): string {
  const msg = (error || "").toLowerCase();
  if (!msg) return "Erro sem detalhe";
  if (msg.includes("não encontrado") || msg.includes("nao encontrado")) {
    return "SKU indisponível no One Click (sem estoque ou fora do picker)";
  }
  if (msg.includes("já possui anúncio")) return "SKU já anunciado";
  if (msg.includes("minimum of price") || msg.includes("preço mínimo")) return "Preço abaixo do mínimo";
  // O EAN aqui vem do produto no Meu Drop (mandamos gtin nulo quando o do
  // catálogo é inválido) — só dá para corrigir lá, não por este app.
  if (msg.includes("[gtin]") || msg.includes("product identifier")) {
    return "EAN inválido no cadastro do Meu Drop";
  }
  if (msg.includes("é obrigatório e não foi adicionado")) {
    return "Atributo obrigatório da categoria faltando no Meu Drop";
  }
  if (msg.includes("conectar") || msg.includes("login")) return "Falha de sessão Meu Drop";
  return error!.length > 80 ? `${error!.slice(0, 77)}…` : error!;
}

export function skuNotFoundMessage(stock: number | null | undefined): string {
  if (typeof stock === "number" && stock <= 0) {
    return "SKU não encontrado no Meu Drop (sem estoque — o One Click não lista produtos zerados)";
  }
  return "SKU não encontrado no Meu Drop (indisponível no picker One Click)";
}
