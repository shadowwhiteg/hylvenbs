/**
 * Regras de elegibilidade das ações de catálogo aplicadas a partir da tela
 * "Anúncios ML". As três ações são as mesmas do Antigo Catálogo e rodam sobre o
 * **rascunho do produto Meu Drop** vinculado ao anúncio
 * (`/api/products/{id}/ai-attributes|categorize|catalog-match`), então um anúncio
 * avulso — sem produto vinculado — nunca é elegível.
 */

export type CatalogActionKind = "ai-attributes" | "categorize" | "catalog-match";

export type CatalogActionListing = {
  id: string;
  title: string;
  /** `true` quando o anúncio já é um anúncio de catálogo oficial do ML. */
  catalogListing?: boolean;
  product?: {
    id: string;
    hasDraft?: boolean;
    draftCategoryId?: string | null;
    draftCatalogProductId?: string | null;
  } | null;
};

export type CatalogActionTarget = {
  listingId: string;
  listingTitle: string;
  productId: string;
};

export type CatalogActionPlan = {
  targets: CatalogActionTarget[];
  /** Anúncios sem produto Meu Drop vinculado (ou sem rascunho). */
  skippedUnlinked: number;
  /** Anúncios pulados porque a ação já foi aplicada antes. */
  skippedAlreadyDone: number;
};

/**
 * Decide o que rodar para cada ação:
 *
 * - `ai-attributes`: sempre — completar características é útil mesmo com o
 *   anúncio no ar.
 * - `categorize`: só onde o rascunho ainda não tem `categoryId`. (O `categoryId`
 *   do anúncio no ML não serve de critério: todo anúncio publicado tem um, o que
 *   deixaria a ação sem nada para fazer.)
 * - `catalog-match`: só onde ainda não há vínculo com o catálogo do ML — nem
 *   `draft.catalogProductId`, nem o próprio anúncio sendo de catálogo.
 */
export function planCatalogAction(
  listings: CatalogActionListing[],
  kind: CatalogActionKind
): CatalogActionPlan {
  const targets: CatalogActionTarget[] = [];
  let skippedUnlinked = 0;
  let skippedAlreadyDone = 0;

  for (const listing of listings) {
    const product = listing.product;
    if (!product?.id || product.hasDraft === false) {
      skippedUnlinked += 1;
      continue;
    }

    if (kind === "categorize" && (product.draftCategoryId || "").trim()) {
      skippedAlreadyDone += 1;
      continue;
    }

    if (
      kind === "catalog-match" &&
      ((product.draftCatalogProductId || "").trim() || listing.catalogListing)
    ) {
      skippedAlreadyDone += 1;
      continue;
    }

    targets.push({
      listingId: listing.id,
      listingTitle: listing.title,
      productId: product.id,
    });
  }

  return { targets, skippedUnlinked, skippedAlreadyDone };
}

export const CATALOG_ACTION_LABELS: Record<CatalogActionKind, string> = {
  "ai-attributes": "Preencher características com IA",
  categorize: "Gerar categoryId",
  "catalog-match": "Buscar no catálogo ML",
};

/** Texto do "nada a fazer" — o motivo muda conforme o filtro de cada ação. */
export function emptyCatalogActionMessage(kind: CatalogActionKind, plan: CatalogActionPlan): string {
  if (plan.skippedAlreadyDone > 0 && plan.skippedUnlinked === 0) {
    return kind === "categorize"
      ? `Nada a fazer: os ${plan.skippedAlreadyDone} anúncio(s) selecionado(s) já têm categoryId no rascunho.`
      : `Nada a fazer: os ${plan.skippedAlreadyDone} anúncio(s) selecionado(s) já estão vinculados ao catálogo do ML.`;
  }
  if (plan.skippedUnlinked > 0 && plan.skippedAlreadyDone === 0) {
    return `Nada a fazer: ${plan.skippedUnlinked} anúncio(s) sem produto do Meu Drop vinculado (use "Vincular ao catálogo" antes).`;
  }
  return `Nada a fazer: ${plan.skippedAlreadyDone} já processado(s) e ${plan.skippedUnlinked} sem produto vinculado.`;
}

/** Resumo pós-execução, com os pulados explicados. */
export function formatCatalogActionResult(opts: {
  kind: CatalogActionKind;
  ok: number;
  total: number;
  plan: CatalogActionPlan;
}): string {
  const parts = [`${CATALOG_ACTION_LABELS[opts.kind]}: ${opts.ok}/${opts.total} concluído(s)`];
  if (opts.plan.skippedAlreadyDone > 0) {
    parts.push(
      opts.kind === "categorize"
        ? `${opts.plan.skippedAlreadyDone} já tinha(m) categoryId`
        : `${opts.plan.skippedAlreadyDone} já no catálogo do ML`
    );
  }
  if (opts.plan.skippedUnlinked > 0) {
    parts.push(`${opts.plan.skippedUnlinked} sem produto vinculado`);
  }
  return parts.join(" · ");
}
