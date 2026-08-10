import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { markUserEdited } from "@/lib/sync/merge";

const EDITABLE = [
  "title",
  "description",
  "price",
  "stock",
  "condition",
  "categoryId",
  "attributes",
  "pictures",
  "itemSku",
  "brandId",
  "brandName",
  "weightKg",
  "dimensionJson",
  "logisticsJson",
  "daysToShip",
  "videoUrl",
] as const;
type Editable = (typeof EDITABLE)[number];

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const product = await prisma.product.findUnique({ where: { id }, include: { shopeeDraft: true } });
  if (!product) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });

  let draft = product.shopeeDraft;
  if (!draft) {
    const settings = await getAppSettings();
    draft = await prisma.shopeeListingDraft.create({
      data: {
        productId: id,
        title: product.title.slice(0, 120),
        description: product.description,
        pictures: product.pictures,
        weightKg: settings.shopeeDefaultWeightKg,
        daysToShip: settings.shopeeDefaultDaysToShip,
      },
    });
  }

  return NextResponse.json({ draft });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const product = await prisma.product.findUnique({ where: { id }, include: { shopeeDraft: true } });
  if (!product?.shopeeDraft) {
    return NextResponse.json({ error: "Rascunho Shopee não encontrado" }, { status: 404 });
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

  if (typeof data.title === "string" && data.title.length > 120) {
    return NextResponse.json({ error: "title must be <= 120 characters" }, { status: 400 });
  }
  if (data.price !== undefined && !(Number(data.price) > 0)) {
    return NextResponse.json({ error: "price must be > 0" }, { status: 400 });
  }

  const userEditedJson = markUserEdited(product.shopeeDraft.userEditedJson, editedFields);

  const draft = await prisma.shopeeListingDraft.update({
    where: { id: product.shopeeDraft.id },
    data: {
      ...data,
      userEditedJson,
      price: data.price !== undefined ? Number(data.price) : undefined,
      stock: data.stock !== undefined ? Number(data.stock) : undefined,
      weightKg: data.weightKg !== undefined ? Number(data.weightKg) : undefined,
      daysToShip: data.daysToShip !== undefined ? Number(data.daysToShip) : undefined,
    },
  });

  return NextResponse.json({ draft });
}
