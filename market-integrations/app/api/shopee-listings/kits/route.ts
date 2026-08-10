import { NextRequest, NextResponse } from "next/server";
import { createKitFromShopeeListings } from "@/lib/shopee-kits/from-shopee-listings";
import { enrichShopeeKitWithAi } from "@/lib/shopee-kits/enrich";

type KitRequest = {
  listingIds?: string[];
  title?: string;
  description?: string;
  bundleDiscountPercent?: number;
  aiRationale?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const requests: KitRequest[] = Array.isArray(body.kits)
    ? (body.kits as KitRequest[])
    : [body as KitRequest];
  const enrichWithAi = Boolean(body.enrichWithAi);

  if (!requests.length) {
    return NextResponse.json({ error: "Nenhum kit informado" }, { status: 400 });
  }

  const created: Array<{ id: string; title: string; price: number }> = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const request of requests) {
    const listingIds = Array.isArray(request.listingIds) ? request.listingIds : [];
    try {
      const kit = await createKitFromShopeeListings({
        listingIds,
        title: request.title,
        description: request.description,
        bundleDiscountPercent:
          request.bundleDiscountPercent != null ? Number(request.bundleDiscountPercent) : undefined,
        aiRationale: request.aiRationale,
      });

      if (enrichWithAi) {
        const enriched = await enrichShopeeKitWithAi(kit.id).catch((err) => {
          warnings.push(
            `${kit.title}: não foi possível preencher características (${err instanceof Error ? err.message : String(err)})`
          );
          return null;
        });
        if (enriched?.warnings.length) {
          warnings.push(`${kit.title}: ${enriched.warnings.join("; ")}`);
        }
      }

      created.push({ id: kit.id, title: kit.title, price: kit.shopeeDraft?.price ?? 0 });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (!created.length) {
    return NextResponse.json({ error: errors.join("; ") || "Falha ao criar kit" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, created, errors, warnings });
}
