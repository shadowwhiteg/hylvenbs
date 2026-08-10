import { prisma } from "@/lib/db";
import { applyShopeeListingReview } from "@/lib/shopee/listing-review";

export const REVIEW_BATCH_SIZE = 10;
export const REVIEW_ITEM_DELAY_MS = 300;
export const REVIEW_BATCH_COOLDOWN_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type ShopeeReviewJobDeps = {
  applyListingReviewFn?: typeof applyShopeeListingReview;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  itemDelayMs?: number;
  batchCooldownMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
};

export async function enqueueShopeeReviewJob(shopeeListingIds: string[]) {
  const ids = Array.from(new Set(shopeeListingIds ?? []));
  if (!ids.length) {
    throw new Error("Selecione ao menos um anúncio vinculado a produto do Meu Drop para revisar");
  }

  const job = await prisma.shopeeReviewJob.create({
    data: {
      status: "pending",
      items: { create: ids.map((shopeeListingId) => ({ shopeeListingId, status: "pending" })) },
    },
    include: { items: true },
  });

  void processShopeeReviewJob(job.id);

  return job;
}

export async function processShopeeReviewJob(jobId: string, deps: ShopeeReviewJobDeps = {}) {
  const job = await prisma.shopeeReviewJob.findUnique({ where: { id: jobId }, include: { items: true } });
  if (!job) throw new Error("ShopeeReviewJob not found");

  await prisma.shopeeReviewJob.update({ where: { id: jobId }, data: { status: "running" } });

  const applyFn = deps.applyListingReviewFn ?? applyShopeeListingReview;
  const batchSize = deps.batchSize ?? REVIEW_BATCH_SIZE;
  const itemDelayMs = deps.itemDelayMs ?? REVIEW_ITEM_DELAY_MS;
  const batchCooldownMs = deps.batchCooldownMs ?? REVIEW_BATCH_COOLDOWN_MS;
  const sleepFn = deps.sleepFn ?? sleep;

  for (let i = 0; i < job.items.length; i++) {
    const item = job.items[i];
    await prisma.shopeeReviewJobItem.update({
      where: { id: item.id },
      data: { status: "running", attempts: { increment: 1 } },
    });

    try {
      const result = await applyFn(item.shopeeListingId, { fetchImpl: deps.fetchImpl });
      await prisma.shopeeReviewJobItem.update({
        where: { id: item.id },
        data: {
          status: !result.matched ? "skipped" : result.applied ? "success" : "skipped",
          titleChanged: result.titleApplied,
          attributesChanged: result.attributesApplied,
          error: result.warnings.length ? result.warnings.join("; ") : null,
        },
      });
    } catch (err) {
      await prisma.shopeeReviewJobItem.update({
        where: { id: item.id },
        data: { status: "error", error: err instanceof Error ? err.message : String(err) },
      });
    }

    const isLast = i === job.items.length - 1;
    if (!isLast) {
      const atBatchBoundary = (i + 1) % batchSize === 0;
      await sleepFn(atBatchBoundary ? batchCooldownMs : itemDelayMs);
    }
  }

  const items = await prisma.shopeeReviewJobItem.findMany({ where: { jobId } });
  const allError = items.every((i) => i.status === "error");
  const allDone = items.every((i) => i.status === "success" || i.status === "skipped");

  return prisma.shopeeReviewJob.update({
    where: { id: jobId },
    data: {
      status: allError ? "error" : allDone ? "success" : "partial",
      finishedAt: new Date(),
    },
    include: { items: true },
  });
}
