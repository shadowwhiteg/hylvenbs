import { prisma } from "@/lib/db";
import { applyListingReview } from "@/lib/ml/listing-review";

/**
 * Processa em lotes de 10 anúncios em sequência; o resto fica "pending" na
 * fila até chegar sua vez. Entre lotes tem uma pausa maior, pra dar folga
 * pro Ollama/CPU e não derrubar o túnel com requisições concorrentes (foi
 * isso que causou o HTTP 524 quando a revisão em massa rodava inteira numa
 * única chamada bloqueante).
 */
export const REVIEW_BATCH_SIZE = 10;
export const REVIEW_ITEM_DELAY_MS = 300;
export const REVIEW_BATCH_COOLDOWN_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type ReviewJobDeps = {
  applyListingReviewFn?: typeof applyListingReview;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  itemDelayMs?: number;
  batchCooldownMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
};

export async function enqueueReviewJob(mlListingIds: string[]) {
  const ids = Array.from(new Set(mlListingIds ?? []));
  if (!ids.length) {
    throw new Error("Selecione ao menos um anúncio vinculado a produto do Meu Drop para revisar");
  }

  const job = await prisma.reviewJob.create({
    data: {
      status: "pending",
      items: { create: ids.map((mlListingId) => ({ mlListingId, status: "pending" })) },
    },
    include: { items: true },
  });

  // fire-and-forget: a resposta HTTP volta na hora, o processamento roda em segundo plano.
  void processReviewJob(job.id);

  return job;
}

export async function processReviewJob(jobId: string, deps: ReviewJobDeps = {}) {
  const job = await prisma.reviewJob.findUnique({ where: { id: jobId }, include: { items: true } });
  if (!job) throw new Error("ReviewJob not found");

  await prisma.reviewJob.update({ where: { id: jobId }, data: { status: "running" } });

  const applyFn = deps.applyListingReviewFn ?? applyListingReview;
  const batchSize = deps.batchSize ?? REVIEW_BATCH_SIZE;
  const itemDelayMs = deps.itemDelayMs ?? REVIEW_ITEM_DELAY_MS;
  const batchCooldownMs = deps.batchCooldownMs ?? REVIEW_BATCH_COOLDOWN_MS;
  const sleepFn = deps.sleepFn ?? sleep;

  for (let i = 0; i < job.items.length; i++) {
    const item = job.items[i];
    await prisma.reviewJobItem.update({
      where: { id: item.id },
      data: { status: "running", attempts: { increment: 1 } },
    });

    try {
      const result = await applyFn(item.mlListingId, { fetchImpl: deps.fetchImpl });
      await prisma.reviewJobItem.update({
        where: { id: item.id },
        data: {
          status: !result.matched ? "skipped" : result.applied ? "success" : "skipped",
          titleChanged: result.titleApplied,
          attributesChanged: result.attributesApplied,
          error: result.warnings.length ? result.warnings.join("; ") : null,
        },
      });
    } catch (err) {
      await prisma.reviewJobItem.update({
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

  const items = await prisma.reviewJobItem.findMany({ where: { jobId } });
  const allError = items.every((i) => i.status === "error");
  const allDone = items.every((i) => i.status === "success" || i.status === "skipped");

  return prisma.reviewJob.update({
    where: { id: jobId },
    data: {
      status: allError ? "error" : allDone ? "success" : "partial",
      finishedAt: new Date(),
    },
    include: { items: true },
  });
}
