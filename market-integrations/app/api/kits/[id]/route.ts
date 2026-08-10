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
  "pictures",
  "attributes",
  "variations",
  "regulatory",
  "warrantyType",
  "warrantyTime",
  "availableQuantity",
  "currencyId",
  "videoUrl",
  "marginPercentOverride",
] as const;

type Editable = (typeof EDITABLE)[number];

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const kit = await prisma.kit.findUnique({
    where: { id },
    include: { items: { include: { product: true } }, draft: true },
  });
  if (!kit) {
    return NextResponse.json({ error: "Kit não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ kit });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const kit = await prisma.kit.findUnique({
    where: { id },
    include: { draft: true },
  });
  if (!kit?.draft) {
    return NextResponse.json({ error: "Kit não encontrado" }, { status: 404 });
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

  const userEditedJson = markUserEdited(kit.draft.userEditedJson, editedFields);
  const draft = await prisma.listingDraft.update({
    where: { id: kit.draft.id },
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
    },
  });

  if (typeof data.title === "string") {
    await prisma.kit.update({ where: { id }, data: { title: String(data.title) } });
  }

  return NextResponse.json({ draft });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await prisma.kit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
