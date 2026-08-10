import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { markUserEdited } from "@/lib/sync/merge";

const EDITABLE = [
  "title",
  "description",
  "price",
  "condition",
  "buyingMode",
  "listingTypeId",
  "categoryId",
  "shippingMode",
  "shippingJson",
  "freeShipping",
  "localPickUp",
  "pictures",
  "attributes",
  "variations",
  "regulatory",
  "warrantyType",
  "warrantyTime",
  "availableQuantity",
  "currencyId",
  "videoUrl",
  "videoId",
  "catalogProductId",
  "marginPercentOverride",
] as const;

function toNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

type Editable = (typeof EDITABLE)[number];

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { draft: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ product });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { draft: true },
  });
  if (!product?.draft) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }

  const body = (await req.json()) as Partial<Record<Editable, unknown>>;
  const data: Record<string, unknown> = {};
  const editedFields: string[] = [];

  for (const key of EDITABLE) {
    if (body[key] !== undefined) {
      data[key] = body[key];
      editedFields.push(key);
    }
  }

  if (typeof data.title === "string" && data.title.length > 60) {
    return NextResponse.json({ error: "title must be <= 60 characters" }, { status: 400 });
  }
  if (data.price !== undefined && !(Number(data.price) > 0)) {
    return NextResponse.json({ error: "price must be > 0" }, { status: 400 });
  }

  const userEditedJson = markUserEdited(product.draft.userEditedJson, editedFields);

  const draft = await prisma.listingDraft.update({
    where: { id: product.draft.id },
    data: {
      ...data,
      userEditedJson,
      price: data.price !== undefined ? Number(data.price) : undefined,
      availableQuantity:
        data.availableQuantity !== undefined
          ? Number(data.availableQuantity)
          : undefined,
      marginPercentOverride:
        data.marginPercentOverride === null
          ? null
          : data.marginPercentOverride !== undefined
            ? Number(data.marginPercentOverride)
            : undefined,
      videoUrl:
        data.videoUrl === null || data.videoUrl === ""
          ? null
          : data.videoUrl !== undefined
            ? String(data.videoUrl)
            : undefined,
      videoId: toNullableString(data.videoId),
      catalogProductId: toNullableString(data.catalogProductId),
      freeShipping:
        data.freeShipping !== undefined ? Boolean(data.freeShipping) : undefined,
      localPickUp:
        data.localPickUp !== undefined ? Boolean(data.localPickUp) : undefined,
    },
  });

  await prisma.product.update({
    where: { id },
    data: { status: product.status === "published" ? "published" : "draft_ready" },
  });

  return NextResponse.json({ draft });
}
