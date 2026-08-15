import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ListingEditor, type DraftForm } from "@/components/ListingEditor";
import { ShopeeListingEditor } from "@/components/ShopeeListingEditor";
import { MarketplaceEditorTabs } from "@/components/MarketplaceEditorTabs";

export default async function ProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { draft: true },
  });
  if (!product?.draft) notFound();

  const initial: DraftForm = {
    title: product.draft.title,
    description: product.draft.description,
    price: product.draft.price,
    condition: product.draft.condition,
    buyingMode: product.draft.buyingMode,
    listingTypeId: product.draft.listingTypeId,
    categoryId: product.draft.categoryId,
    shippingMode: product.draft.shippingMode,
    shippingJson: product.draft.shippingJson,
    freeShipping: product.draft.freeShipping,
    localPickUp: product.draft.localPickUp,
    pictures: product.draft.pictures,
    attributes: product.draft.attributes,
    variations: product.draft.variations,
    regulatory: product.draft.regulatory,
    warrantyType: product.draft.warrantyType,
    warrantyTime: product.draft.warrantyTime,
    availableQuantity: product.draft.availableQuantity,
    currencyId: product.draft.currencyId,
    videoUrl: product.draft.videoUrl || product.videoUrl || "",
    videoId: product.draft.videoId || "",
    catalogProductId: product.draft.catalogProductId || "",
    marginPercentOverride: product.draft.marginPercentOverride,
  };

  return (
    <MarketplaceEditorTabs
      ml={
        <ListingEditor
          heading={`Editar: ${product.title}`}
          costPrice={product.costPrice}
          initial={initial}
          saveUrl={`/api/products/${product.id}`}
          productId={product.id}
          originalTitle={product.title}
          supplierCategoryPath={product.categoryPath}
          productVideoUrl={product.videoUrl || undefined}
        />
      }
      shopee={
        <ShopeeListingEditor
          heading={`Editar (Shopee): ${product.title}`}
          costPrice={product.costPrice}
          loadUrl={`/api/products/${product.id}/shopee-draft`}
          saveUrl={`/api/products/${product.id}/shopee-draft`}
        />
      }
    />
  );
}
