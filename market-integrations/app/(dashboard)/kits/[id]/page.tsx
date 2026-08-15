import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ListingEditor, type DraftForm } from "@/components/ListingEditor";
import { ShopeeListingEditor } from "@/components/ShopeeListingEditor";
import { MarketplaceEditorTabs } from "@/components/MarketplaceEditorTabs";
import { BP } from "@/lib/base-path";

export default async function KitEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const kit = await prisma.kit.findUnique({
    where: { id },
    include: { draft: true, shopeeDraft: true, items: { include: { product: true } } },
  });
  if (!kit || (!kit.draft && !kit.shopeeDraft)) notFound();

  const itemsSummary = (
    <p className="muted" style={{ marginBottom: "1rem" }}>
      Itens: {kit.items.map((i) => i.titleSnapshot || i.product?.title || "(item removido)").join(" · ")}
    </p>
  );

  const mlEditor = kit.draft ? (
    <ListingEditor
      heading={`Kit: ${kit.title}`}
      costPrice={kit.costPrice}
      initial={{
        title: kit.draft.title,
        description: kit.draft.description,
        price: kit.draft.price,
        condition: kit.draft.condition,
        buyingMode: kit.draft.buyingMode,
        listingTypeId: kit.draft.listingTypeId,
        categoryId: kit.draft.categoryId,
        shippingMode: kit.draft.shippingMode,
        shippingJson: kit.draft.shippingJson,
        freeShipping: kit.draft.freeShipping,
        localPickUp: kit.draft.localPickUp,
        pictures: kit.draft.pictures,
        attributes: kit.draft.attributes,
        variations: kit.draft.variations,
        regulatory: kit.draft.regulatory,
        warrantyType: kit.draft.warrantyType,
        warrantyTime: kit.draft.warrantyTime,
        availableQuantity: kit.draft.availableQuantity,
        currencyId: kit.draft.currencyId,
        videoUrl: kit.draft.videoUrl || "",
        videoId: kit.draft.videoId || "",
        catalogProductId: kit.draft.catalogProductId || "",
        marginPercentOverride: kit.draft.marginPercentOverride,
      } satisfies DraftForm}
      saveUrl={`${BP}/api/kits/${kit.id}`}
    />
  ) : (
    <p className="muted">Este kit não tem rascunho de Mercado Livre (veio da Shopee).</p>
  );

  const shopeeEditor = (
    <ShopeeListingEditor
      heading={`Kit (Shopee): ${kit.title}`}
      costPrice={kit.costPrice}
      loadUrl={`${BP}/api/kits/${kit.id}/shopee-draft`}
      saveUrl={`${BP}/api/kits/${kit.id}/shopee-draft`}
    />
  );

  return (
    <div>
      {itemsSummary}
      <MarketplaceEditorTabs ml={mlEditor} shopee={shopeeEditor} />
    </div>
  );
}
