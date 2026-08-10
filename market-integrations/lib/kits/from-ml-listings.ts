import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { ML_TITLE_MAX_LENGTH } from "@/lib/agent/title";
import { buildKitAttributesJson } from "@/lib/kits/attributes";

/** Desconto de combo padrão quando o usuário não escolhe um. */
export const DEFAULT_BUNDLE_DISCOUNT_PERCENT = 10;

function shortenTitle(title: string, words: number): string {
  return title.trim().split(/\s+/).slice(0, words).join(" ");
}

/**
 * Título de kit sempre válido pro ML (<= 60 chars): tenta manter os títulos
 * inteiros e vai encurtando palavra a palavra até caber.
 */
export function buildKitTitle(titles: string[], maxLength = ML_TITLE_MAX_LENGTH): string {
  const clean = titles.map((t) => (t || "").trim()).filter(Boolean);
  if (!clean.length) return "Kit";

  for (let words = 12; words >= 2; words--) {
    const candidate = `Kit ${clean.map((t) => shortenTitle(t, words)).join(" + ")}`;
    if (candidate.length <= maxLength) return candidate;
  }
  return `Kit ${clean.length} Itens ${shortenTitle(clean[0], 6)}`.slice(0, maxLength).trim();
}

/** Miniaturas do ML vêm em baixa resolução; a variante 2X serve pra foto de anúncio. */
export function upgradeMlThumbnail(url: string | null | undefined): string | null {
  const value = (url || "").trim();
  if (!value) return null;
  return value.replace("/D_NQ_NP_", "/D_NQ_NP_2X_");
}

export function buildKitDescription(
  items: Array<{ title: string; quantity: number }>,
  opts?: { discountPercent?: number }
): string {
  const lines = items.map(
    (item) => `• ${item.quantity > 1 ? `${item.quantity}x ` : ""}${item.title}`
  );
  const parts = [
    `Kit com ${items.length} itens:`,
    "",
    ...lines,
    "",
    "Todos os itens são enviados juntos, em uma única compra.",
  ];
  if (opts?.discountPercent && opts.discountPercent > 0) {
    parts.push(
      `Comprando em kit você economiza ${opts.discountPercent}% em relação aos itens avulsos.`
    );
  }
  return parts.join("\n");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Categoria mais frequente entre os anúncios; empate resolve pelo primeiro. */
function pickCategoryId(categoryIds: Array<string | null>): string {
  const counts = new Map<string, number>();
  for (const id of categoryIds) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export type CreateKitFromMlListingsInput = {
  listingIds: string[];
  title?: string;
  description?: string;
  /** Desconto aplicado sobre a soma dos preços individuais do ML. */
  bundleDiscountPercent?: number;
  quantities?: Record<string, number>;
  aiRationale?: string;
};

export async function createKitFromMlListings(input: CreateKitFromMlListingsInput) {
  const listingIds = Array.from(new Set(input.listingIds ?? []));
  if (listingIds.length < 2) {
    throw new Error("Selecione ao menos 2 anúncios para criar um kit");
  }

  const listings = await prisma.mlListing.findMany({ where: { id: { in: listingIds } } });
  if (listings.length !== listingIds.length) {
    const found = new Set(listings.map((l) => l.id));
    const missing = listingIds.filter((id) => !found.has(id));
    throw new Error(`Anúncio(s) não encontrado(s) no banco local: ${missing.join(", ")}`);
  }

  // Custo e galeria de imagens só existem quando o anúncio tem produto do Meu Drop por trás.
  const products = await prisma.product.findMany({
    where: { mlItemId: { in: listingIds } },
    select: { mlItemId: true, costPrice: true, pictures: true },
  });
  const costByListing = new Map(products.map((p) => [p.mlItemId!, p.costPrice]));
  const picturesByListing = new Map(
    products.map((p) => {
      let parsed: string[] = [];
      try {
        const raw = JSON.parse(p.pictures || "[]");
        if (Array.isArray(raw)) parsed = raw.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
      } catch {
        parsed = [];
      }
      return [p.mlItemId!, parsed];
    })
  );

  const discount = Math.min(Math.max(input.bundleDiscountPercent ?? DEFAULT_BUNDLE_DISCOUNT_PERCENT, 0), 90);
  const ordered = listingIds.map((id) => listings.find((l) => l.id === id)!);

  const items = ordered.map((listing) => {
    const quantity = Math.max(1, Math.floor(input.quantities?.[listing.id] ?? 1));
    return {
      listing,
      quantity,
      unitPrice: listing.price,
      unitCost: costByListing.get(listing.id) ?? 0,
    };
  });

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
  const grossPrice = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const price = round2(grossPrice * (1 - discount / 100));
  const costPrice = round2(items.reduce((sum, i) => sum + i.unitCost * i.quantity, 0));

  // Mínimo de 3 imagens por item quando o produto do Meu Drop tem galeria;
  // sem produto vinculado (anúncio avulso), só sobra a miniatura do ML.
  const MIN_PICTURES_PER_ITEM = 3;
  const pictures = Array.from(
    new Set(
      items.flatMap((i) => {
        const gallery = picturesByListing.get(i.listing.id) ?? [];
        if (gallery.length) return gallery.slice(0, MIN_PICTURES_PER_ITEM);
        const thumb = upgradeMlThumbnail(i.listing.thumbnail);
        return thumb ? [thumb] : [];
      })
    )
  ).slice(0, 12);

  const title = (input.title?.trim() || buildKitTitle(items.map((i) => i.listing.title))).slice(
    0,
    ML_TITLE_MAX_LENGTH
  );
  const description =
    input.description?.trim() ||
    buildKitDescription(
      items.map((i) => ({ title: i.listing.title, quantity: i.quantity })),
      { discountPercent: discount }
    );

  const settings = await getAppSettings();
  // Estoque do kit é limitado pelo item mais escasso.
  const availableQuantity = items.reduce(
    (min, i) => Math.min(min, Math.floor(i.listing.availableQuantity / i.quantity)),
    Number.POSITIVE_INFINITY
  );

  return prisma.kit.create({
    data: {
      title,
      costPrice,
      status: "draft_ready",
      source: "ml_listings",
      aiRationale: input.aiRationale ?? null,
      items: {
        create: items.map((i) => ({
          mlListingId: i.listing.id,
          quantity: i.quantity,
          titleSnapshot: i.listing.title,
          unitPrice: i.unitPrice,
          unitCost: i.unitCost,
        })),
      },
      draft: {
        create: {
          title,
          description,
          price,
          pictures: JSON.stringify(pictures),
          categoryId: pickCategoryId(items.map((i) => i.listing.categoryId)),
          attributes: buildKitAttributesJson(totalUnits),
          condition: "new",
          buyingMode: "buy_it_now",
          listingTypeId: settings.defaultListingTypeId,
          shippingMode: settings.defaultShippingMode,
          freeShipping: settings.defaultFreeShipping,
          localPickUp: settings.defaultLocalPickUp,
          warrantyType: settings.defaultWarrantyType,
          warrantyTime: settings.defaultWarrantyTime,
          availableQuantity: Number.isFinite(availableQuantity)
            ? Math.max(0, availableQuantity)
            : 0,
        },
      },
    },
    include: { items: true, draft: true },
  });
}
