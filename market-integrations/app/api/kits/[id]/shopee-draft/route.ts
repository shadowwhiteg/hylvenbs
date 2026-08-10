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
  const kit = await prisma.kit.findUnique({ where: { id }, include: { shopeeDraft: true } });
  if (!kit) return NextResponse.json({ error: "Kit não encontrado" }, { status: 404 });

  let draft = kit.shopeeDraft;
  if (!draft) {
    const settings = await getAppSettings();
    draft = await prisma.shopeeListingDraft.create({
      data: {
        kitId: id,
        title: kit.title.slice(0, 120),
        weightKg: settings.shopeeDefaultWeightKg,
        daysToShip: settings.shopeeDefaultDaysToShip,
      },
    });
  }

  return NextResponse.json({ draft });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const kit = await prisma.kit.findUnique({ where: { id }, include: { shopeeDraft: true } });
  if (!kit?.shopeeDraft) {
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

  const userEditedJson = markUserEdited(kit.shopeeDraft.userEditedJson, editedFields);
  const draft = await prisma.shopeeListingDraft.update({
    where: { id: kit.shopeeDraft.id },
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
