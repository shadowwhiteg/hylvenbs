import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { buildKitTitle, buildKitDescription } from "@/lib/kits/from-ml-listings";

export const DEFAULT_BUNDLE_DISCOUNT_PERCENT = 10;
const SHOPEE_TITLE_MAX_LENGTH = 120;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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

export type CreateKitFromShopeeListingsInput = {
  listingIds: string[];
  title?: string;
  description?: string;
  bundleDiscountPercent?: number;
  quantities?: Record<string, number>;
  aiRationale?: string;
};

/** Espelha lib/kits/from-ml-listings.ts: monta kit a partir de anúncios Shopee já publicados. */
export async function createKitFromShopeeListings(input: CreateKitFromShopeeListingsInput) {
  const listingIds = Array.from(new Set(input.listingIds ?? []));
  if (listingIds.length < 2) {
    throw new Error("Selecione ao menos 2 anúncios para criar um kit");
  }

  const listings = await prisma.shopeeListing.findMany({ where: { id: { in: listingIds } } });
  if (listings.length !== listingIds.length) {
    const found = new Set(listings.map((l) => l.id));
    const missing = listingIds.filter((id) => !found.has(id));
    throw new Error(`Anúncio(s) não encontrado(s) no banco local: ${missing.join(", ")}`);
  }

  const products = await prisma.product.findMany({
    where: { shopeeItemId: { in: listingIds } },
    select: { shopeeItemId: true, costPrice: true, pictures: true },
  });
  const costByListing = new Map(products.map((p) => [p.shopeeItemId!, p.costPrice]));
  const picturesByListing = new Map(
    products.map((p) => {
      let parsed: string[] = [];
      try {
        const raw = JSON.parse(p.pictures || "[]");
        if (Array.isArray(raw)) parsed = raw.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
      } catch {
        parsed = [];
      }
      return [p.shopeeItemId!, parsed];
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

  const grossPrice = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const price = round2(grossPrice * (1 - discount / 100));
  const costPrice = round2(items.reduce((sum, i) => sum + i.unitCost * i.quantity, 0));

  const MIN_PICTURES_PER_ITEM = 3;
  const pictures = Array.from(
    new Set(
      items.flatMap((i) => {
        const gallery = picturesByListing.get(i.listing.id) ?? [];
        if (gallery.length) return gallery.slice(0, MIN_PICTURES_PER_ITEM);
        return i.listing.thumbnail ? [i.listing.thumbnail] : [];
      })
    )
  ).slice(0, 9);

  const title = (input.title?.trim() || buildKitTitle(items.map((i) => i.listing.title), SHOPEE_TITLE_MAX_LENGTH)).slice(
    0,
    SHOPEE_TITLE_MAX_LENGTH
  );
  const description =
    input.description?.trim() ||
    buildKitDescription(
      items.map((i) => ({ title: i.listing.title, quantity: i.quantity })),
      { discountPercent: discount }
    );

  const settings = await getAppSettings();
  const availableQuantity = items.reduce(
    (min, i) => Math.min(min, Math.floor(i.listing.stock / i.quantity)),
    Number.POSITIVE_INFINITY
  );

  return prisma.kit.create({
    data: {
      title,
      costPrice,
      status: "draft_ready",
      source: "shopee_listings",
      aiRationale: input.aiRationale ?? null,
      items: {
        create: items.map((i) => ({
          shopeeListingId: i.listing.id,
          quantity: i.quantity,
          titleSnapshot: i.listing.title,
          unitPrice: i.unitPrice,
          unitCost: i.unitCost,
        })),
      },
      shopeeDraft: {
        create: {
          title,
          description,
          price,
          stock: Number.isFinite(availableQuantity) ? Math.max(0, availableQuantity) : 0,
          pictures: JSON.stringify(pictures),
          categoryId: pickCategoryId(items.map((i) => i.listing.categoryId)),
          condition: "NEW",
          weightKg: settings.shopeeDefaultWeightKg,
          daysToShip: settings.shopeeDefaultDaysToShip,
        },
      },
    },
    include: { items: true, shopeeDraft: true },
  });
}
