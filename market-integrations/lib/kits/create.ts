import { prisma } from "@/lib/db";
import { simulateCosts } from "@/lib/pricing/simulator";
import { buildKitAttributesJson } from "@/lib/kits/attributes";

export async function createKitFromProducts(productIds: string[]) {
  if (productIds.length < 2) {
    throw new Error("Selecione ao menos 2 produtos para criar um kit");
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { draft: true },
  });
  if (products.length !== productIds.length) {
    throw new Error("Um ou mais productIds são inválidos");
  }

  const title = `Kit: ${products.map((p) => p.title).join(" + ")}`.slice(0, 60);
  const costPrice = products.reduce((sum, p) => sum + p.costPrice, 0);
  const pictures = Array.from(
    new Set(
      products.flatMap((p) => {
        try {
          return JSON.parse(p.pictures || "[]") as string[];
        } catch {
          return [];
        }
      })
    )
  ).slice(0, 10);
  const description = products.map((p) => `## ${p.title}\n${p.description}`).join("\n\n");

  const settings = await prisma.appSettings.upsert({
    where: { id: "default" },
    create: { id: "default", marginPercent: Number(process.env.DEFAULT_MARGIN_PERCENT || 30) },
    update: {},
  });

  let price = costPrice;
  try {
    price = simulateCosts({
      costPrice: costPrice || 1,
      listingTypeId: "gold_special",
      marginPercent: settings.marginPercent,
    }).suggestedPrice;
  } catch {
    /* keep cost */
  }

  return prisma.kit.create({
    data: {
      title,
      costPrice,
      status: "draft_ready",
      items: {
        create: productIds.map((productId) => ({ productId })),
      },
      draft: {
        create: {
          title,
          description,
          price,
          pictures: JSON.stringify(pictures),
          condition: "new",
          buyingMode: "buy_it_now",
          listingTypeId: "gold_special",
          attributes: buildKitAttributesJson(productIds.length),
        },
      },
    },
    include: { items: { include: { product: true } }, draft: true },
  });
}
