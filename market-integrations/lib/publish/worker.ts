import { prisma } from "@/lib/db";
import { createItem, setItemDescription } from "@/lib/ml/client";
import { getCategoryGtinPolicy } from "@/lib/ml/category-attributes";
import {
  buildItemPayload,
  getDescriptionPlainText,
  validateDraftForPublish,
  type ListingDraftLike,
} from "@/lib/ml/payload";
import {
  aiRepairDraft,
  type AiRepairDeps,
  type AiRepairInput,
  type AiRepairResult,
} from "@/lib/publish/ai-repair";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_MAX_AI_REPAIRS = 2;

export type PublishDeps = {
  createItemFn?: typeof createItem;
  setDescriptionFn?: typeof setItemDescription;
  delayMs?: number;
  /** Override do corretor de IA (útil em testes). */
  repairFn?: (input: AiRepairInput, deps?: AiRepairDeps) => Promise<AiRepairResult>;
  maxAiRepairs?: number;
};

async function publishDraft(
  draft: ListingDraftLike,
  deps: PublishDeps
): Promise<{ mlItemId: string; permalink?: string }> {
  const gtinPolicy = await getCategoryGtinPolicy(draft.categoryId);
  const errors = validateDraftForPublish(draft, { gtinPolicy });
  if (errors.length) {
    throw new Error(errors.join("; "));
  }

  const payload = buildItemPayload(draft, { gtinPolicy });
  const createFn = deps.createItemFn ?? createItem;
  const descFn = deps.setDescriptionFn ?? setItemDescription;

  let lastError = "unknown";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await createFn(payload);
    if (res.ok && res.data.id) {
      const itemId = res.data.id;
      await descFn(itemId, getDescriptionPlainText(draft));
      return { mlItemId: itemId, permalink: res.data.permalink };
    }
    lastError = res.raw || res.data.message || `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) {
      await sleep(500 * attempt);
      continue;
    }
    break;
  }
  throw new Error(lastError);
}

async function persistDraftUpdate(
  draftId: string,
  draft: ListingDraftLike
): Promise<void> {
  await prisma.listingDraft.update({
    where: { id: draftId },
    data: {
      title: draft.title,
      description: draft.description,
      price: draft.price,
      categoryId: draft.categoryId,
      attributes: draft.attributes,
      catalogProductId: draft.catalogProductId ?? null,
    },
  });
}

type DraftRecord = ListingDraftLike & { id: string };

async function publishWithAiRepair(opts: {
  draft: DraftRecord;
  productTitle?: string;
  scrapedAttributesJson?: string;
  deps: PublishDeps;
}): Promise<{ mlItemId: string; permalink?: string; aiRepairs: number }> {
  const maxRepairs = opts.deps.maxAiRepairs ?? DEFAULT_MAX_AI_REPAIRS;
  const repairFn = opts.deps.repairFn ?? aiRepairDraft;
  let draft = opts.draft as ListingDraftLike;
  let draftId = opts.draft.id;
  let aiRepairs = 0;
  let lastError = "";
  let lastRepairNote = "";

  while (true) {
    try {
      const result = await publishDraft(draft, opts.deps);
      return { ...result, aiRepairs };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (aiRepairs >= maxRepairs) break;

      const gtinPolicy = await getCategoryGtinPolicy(draft.categoryId).catch(() => undefined);
      const repair = await repairFn({
        draft,
        errorMessage: lastError,
        productTitle: opts.productTitle,
        scrapedAttributesJson: opts.scrapedAttributesJson,
        gtinPolicy,
      });

      if (!repair.ok || !repair.draft) {
        lastRepairNote = repair.note || "correção por IA indisponível";
        break;
      }

      draft = repair.draft;
      lastRepairNote = repair.note || "patch aplicado";
      await persistDraftUpdate(draftId, draft);
      aiRepairs += 1;
    }
  }

  const suffix =
    aiRepairs > 0
      ? ` (após ${aiRepairs} correção(ões) por IA${lastRepairNote ? `: ${lastRepairNote}` : ""})`
      : lastRepairNote
        ? ` (IA: ${lastRepairNote})`
        : "";
  throw new Error(`${lastError}${suffix}`);
}

export async function processPublishJob(jobId: string, deps: PublishDeps = {}) {
  const job = await prisma.publishJob.findUnique({
    where: { id: jobId },
    include: { items: true },
  });
  if (!job) throw new Error("PublishJob not found");

  await prisma.publishJob.update({
    where: { id: jobId },
    data: { status: "running" },
  });

  const delayMs = deps.delayMs ?? 400;

  for (const item of job.items) {
    await prisma.publishJobItem.update({
      where: { id: item.id },
      data: { status: "running", attempts: { increment: 1 } },
    });

    try {
      if (item.productId) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          include: { draft: true },
        });
        if (!product?.draft) throw new Error("Product draft missing");
        const result = await publishWithAiRepair({
          draft: product.draft,
          productTitle: product.title,
          scrapedAttributesJson: product.attributesJson,
          deps,
        });
        await prisma.product.update({
          where: { id: product.id },
          data: {
            mlItemId: result.mlItemId,
            mlPermalink: result.permalink,
            status: "published",
          },
        });
        await prisma.publishJobItem.update({
          where: { id: item.id },
          data: {
            status: "success",
            mlItemId: result.mlItemId,
            error: null,
          },
        });
      } else if (item.kitId) {
        const kit = await prisma.kit.findUnique({
          where: { id: item.kitId },
          include: { draft: true },
        });
        if (!kit?.draft) throw new Error("Kit draft missing");
        if (kit.mlItemId) throw new Error("Kit já publicado no Mercado Livre");
        const result = await publishWithAiRepair({
          draft: kit.draft,
          productTitle: kit.title,
          deps,
        });
        await prisma.kit.update({
          where: { id: kit.id },
          data: {
            mlItemId: result.mlItemId,
            mlPermalink: result.permalink,
            status: "published",
          },
        });
        await prisma.publishJobItem.update({
          where: { id: item.id },
          data: {
            status: "success",
            mlItemId: result.mlItemId,
            error: null,
          },
        });
      } else {
        throw new Error("Item sem productId/kitId");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.publishJobItem.update({
        where: { id: item.id },
        data: { status: "error", error: message },
      });
      if (item.productId) {
        await prisma.product.update({
          where: { id: item.productId },
          data: { status: "error" },
        }).catch(() => undefined);
      }
    }

    await sleep(delayMs);
  }

  const items = await prisma.publishJobItem.findMany({ where: { jobId } });
  const allOk = items.every((i) => i.status === "success");
  const allFail = items.every((i) => i.status === "error");

  return prisma.publishJob.update({
    where: { id: jobId },
    data: {
      status: allOk ? "success" : allFail ? "error" : "partial",
      finishedAt: new Date(),
    },
    include: { items: true },
  });
}

export async function enqueuePublish(input: {
  productIds?: string[];
  kitIds?: string[];
}) {
  const productIds = input.productIds ?? [];
  const kitIds = input.kitIds ?? [];
  if (!productIds.length && !kitIds.length) {
    throw new Error("Selecione ao menos um produto ou kit");
  }

  const { getAuthStatus } = await import("@/lib/ml/auth");
  const status = await getAuthStatus();
  if (!status.connected) {
    throw new Error("Conecte o Mercado Livre em Configurações antes de publicar");
  }

  const job = await prisma.publishJob.create({
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
    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: { status: "queued" },
    });
  }

  // fire-and-forget processing
  void processPublishJob(job.id);

  return job;
}
