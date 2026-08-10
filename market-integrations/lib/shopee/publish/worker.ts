import { prisma } from "@/lib/db";
import { addItem, updateItem } from "@/lib/shopee/client";
import { getValidAccessToken } from "@/lib/shopee/auth";
import { getCategoryAttributes } from "@/lib/shopee/category";
import { resolveImageIds } from "@/lib/shopee/media";
import {
  buildItemPayload,
  validateDraftForPublish,
  type ShopeeListingDraftLike,
} from "@/lib/shopee/payload";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ShopeePublishDeps = {
  addItemFn?: typeof addItem;
  updateItemFn?: typeof updateItem;
  resolveImageIdsFn?: typeof resolveImageIds;
  delayMs?: number;
};

function parsePictures(pictures: string): string[] {
  try {
    const parsed = JSON.parse(pictures || "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

async function publishDraft(
  draftId: string,
  draft: ShopeeListingDraftLike,
  deps: ShopeePublishDeps
): Promise<{ shopeeItemId: string; shopeeItemUrl?: string }> {
  const resolveImages = deps.resolveImageIdsFn ?? resolveImageIds;
  const pictureUrls = parsePictures(draft.pictures);
  const { imageIds, warnings: imageWarnings } = await resolveImages(draftId, pictureUrls);

  let mandatoryAttributes: Array<{ attributeId: number; name: string }> = [];
  if (draft.categoryId?.trim()) {
    try {
      const attrs = await getCategoryAttributes(Number(draft.categoryId));
      mandatoryAttributes = attrs
        .filter((a) => a.isMandatory)
        .map((a) => ({ attributeId: a.attributeId, name: a.name }));
    } catch {
      // Se a API de atributos falhar, seguimos sem validar obrigatoriedade — o add_item vai recusar se faltar algo.
    }
  }

  const errors = validateDraftForPublish(draft, imageIds.length, mandatoryAttributes);
  if (errors.length) {
    throw new Error([...errors, ...imageWarnings].join("; "));
  }

  const payload = buildItemPayload(draft, imageIds);
  const createFn = deps.addItemFn ?? addItem;

  let lastError = "unknown";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await createFn(payload);
    if (res.ok && res.data.response?.item_id) {
      const itemId = String(res.data.response.item_id);
      const { shopId } = await getValidAccessToken();
      return { shopeeItemId: itemId, shopeeItemUrl: `https://shopee.com.br/product/${shopId}/${itemId}` };
    }
    lastError = res.data.error || res.data.message || res.raw || `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) {
      await sleep(500 * attempt);
      continue;
    }
    break;
  }
  throw new Error(lastError);
}

export async function processShopeePublishJob(jobId: string, deps: ShopeePublishDeps = {}) {
  const job = await prisma.shopeePublishJob.findUnique({
    where: { id: jobId },
    include: { items: true },
  });
  if (!job) throw new Error("ShopeePublishJob not found");

  await prisma.shopeePublishJob.update({ where: { id: jobId }, data: { status: "running" } });

  const delayMs = deps.delayMs ?? 400;

  for (const item of job.items) {
    await prisma.shopeePublishJobItem.update({
      where: { id: item.id },
      data: { status: "running", attempts: { increment: 1 } },
    });

    try {
      if (item.productId) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          include: { shopeeDraft: true },
        });
        if (!product?.shopeeDraft) throw new Error("Product shopeeDraft missing");
        const result = await publishDraft(product.shopeeDraft.id, product.shopeeDraft, deps);
        await prisma.product.update({
          where: { id: product.id },
          data: {
            shopeeItemId: result.shopeeItemId,
            shopeeItemUrl: result.shopeeItemUrl,
            status: "published",
          },
        });
        await prisma.shopeePublishJobItem.update({
          where: { id: item.id },
          data: { status: "success", shopeeItemId: result.shopeeItemId, error: null },
        });
      } else if (item.kitId) {
        const kit = await prisma.kit.findUnique({
          where: { id: item.kitId },
          include: { shopeeDraft: true },
        });
        if (!kit?.shopeeDraft) throw new Error("Kit shopeeDraft missing");
        if (kit.shopeeItemId) throw new Error("Kit já publicado na Shopee");
        const result = await publishDraft(kit.shopeeDraft.id, kit.shopeeDraft, deps);
        await prisma.kit.update({
          where: { id: kit.id },
          data: {
            shopeeItemId: result.shopeeItemId,
            shopeeItemUrl: result.shopeeItemUrl,
            status: "published",
          },
        });
        await prisma.shopeePublishJobItem.update({
          where: { id: item.id },
          data: { status: "success", shopeeItemId: result.shopeeItemId, error: null },
        });
      } else {
        throw new Error("Item sem productId/kitId");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.shopeePublishJobItem.update({
        where: { id: item.id },
        data: { status: "error", error: message },
      });
      if (item.productId) {
        await prisma.product
          .update({ where: { id: item.productId }, data: { status: "error" } })
          .catch(() => undefined);
      }
    }

    await sleep(delayMs);
  }

  const items = await prisma.shopeePublishJobItem.findMany({ where: { jobId } });
  const allOk = items.every((i) => i.status === "success");
  const allFail = items.every((i) => i.status === "error");

  return prisma.shopeePublishJob.update({
    where: { id: jobId },
    data: {
      status: allOk ? "success" : allFail ? "error" : "partial",
      finishedAt: new Date(),
    },
    include: { items: true },
  });
}

export async function enqueueShopeePublish(input: { productIds?: string[]; kitIds?: string[] }) {
  const productIds = input.productIds ?? [];
  const kitIds = input.kitIds ?? [];
  if (!productIds.length && !kitIds.length) {
    throw new Error("Selecione ao menos um produto ou kit");
  }

  const { getAuthStatus } = await import("@/lib/shopee/auth");
  const status = await getAuthStatus();
  if (!status.connected) {
    throw new Error("Conecte a Shopee em Configurações antes de publicar");
  }

  const job = await prisma.shopeePublishJob.create({
    data: {
      status: "pending",
      items: {
        create: [
          ...productIds.map((productId) => ({ productId, status: "pending" })),
          ...kitIds.map((kitId) => ({ kitId, status: "pending" })),
        ],
      },
    },
    include: { items: true },
  });

  if (productIds.length) {
    await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { status: "queued" } });
  }

  void processShopeePublishJob(job.id);

  return job;
}
