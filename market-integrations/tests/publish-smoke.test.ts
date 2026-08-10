import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { processPublishJob } from "@/lib/publish/worker";

describe("processPublishJob smoke", () => {
  let jobId = "";
  let productId = "";

  beforeAll(async () => {
    // Não toca em MlToken — o job usa createItemFn/setDescriptionFn mockados.
    const product = await prisma.product.create({
      data: {
        externalId: `smoke-${Date.now()}`,
        sourceUrl: `https://example.com/smoke-${Date.now()}`,
        title: "Smoke Product",
        costPrice: 40,
        description: "Smoke",
        pictures: JSON.stringify(["https://example.com/p.jpg"]),
        status: "queued",
        draft: {
          create: {
            title: "Smoke Product",
            description: "Smoke desc",
            price: 99.9,
            categoryId: "MLB1234",
            pictures: JSON.stringify(["https://example.com/p.jpg"]),
            listingTypeId: "gold_special",
            condition: "new",
            buyingMode: "buy_it_now",
            attributes: JSON.stringify([
              { name: "Marca", value: "SmokeBrand" },
              { name: "Modelo", value: "SmokeModel" },
            ]),
          },
        },
      },
    });

    const job = await prisma.publishJob.create({
      data: {
        status: "pending",
        items: { create: [{ productId: product.id, status: "pending" }] },
      },
    });
    jobId = job.id;
    productId = product.id;
  });

  afterAll(async () => {
    if (jobId) {
      await prisma.publishJobItem.deleteMany({ where: { jobId } });
      await prisma.publishJob.delete({ where: { id: jobId } }).catch(() => undefined);
    }
    if (productId) {
      await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
    }
  });

  it("publishes item with mocked ML API", async () => {
    const result = await processPublishJob(jobId, {
      delayMs: 0,
      createItemFn: async () => ({
        ok: true,
        status: 200,
        data: { id: "MLB999", permalink: "https://produto.mercadolivre.com.br/MLB999" },
        raw: '{"id":"MLB999"}',
      }),
      setDescriptionFn: async () => ({
        ok: true,
        status: 200,
        data: {},
        raw: "{}",
      }),
    });

    expect(result.status).toBe("success");
    expect(result.items[0].status).toBe("success");
    expect(result.items[0].mlItemId).toBe("MLB999");
  });

  it("repairs draft with AI mock and republishes after ML 4xx", async () => {
    const product = await prisma.product.create({
      data: {
        externalId: `smoke-repair-${Date.now()}`,
        sourceUrl: `https://example.com/smoke-repair-${Date.now()}`,
        title: "Repair Product",
        costPrice: 40,
        description: "Repair",
        pictures: JSON.stringify(["https://example.com/p.jpg"]),
        status: "queued",
        draft: {
          create: {
            title: "Repair Product",
            description: "Repair desc",
            price: 99.9,
            categoryId: "MLB1234",
            pictures: JSON.stringify(["https://example.com/p.jpg"]),
            listingTypeId: "gold_special",
            condition: "new",
            buyingMode: "buy_it_now",
            attributes: JSON.stringify([
              { name: "Marca", value: "SmokeBrand" },
              { name: "Modelo", value: "SmokeModel" },
            ]),
          },
        },
      },
    });

    const job = await prisma.publishJob.create({
      data: {
        status: "pending",
        items: { create: [{ productId: product.id, status: "pending" }] },
      },
    });

    let createCalls = 0;
    const result = await processPublishJob(job.id, {
      delayMs: 0,
      maxAiRepairs: 2,
      createItemFn: async () => {
        createCalls += 1;
        if (createCalls === 1) {
          return {
            ok: false,
            status: 400,
            data: { message: "Invalid title for category" },
            raw: '{"message":"Invalid title for category"}',
          };
        }
        return {
          ok: true,
          status: 200,
          data: { id: "MLB-REPAIR", permalink: "https://produto.mercadolivre.com.br/MLB-REPAIR" },
          raw: '{"id":"MLB-REPAIR"}',
        };
      },
      setDescriptionFn: async () => ({
        ok: true,
        status: 200,
        data: {},
        raw: "{}",
      }),
      repairFn: async (input) => {
        const { applyDraftRepairPatch } = await import("@/lib/publish/ai-repair");
        const draft = applyDraftRepairPatch(input.draft, {
          title: "Repair Product Fixed",
        });
        return {
          ok: true,
          draft,
          patch: { title: "Repair Product Fixed" },
          note: "title fixed",
        };
      },
    });

    expect(result.status).toBe("success");
    expect(result.items[0].status).toBe("success");
    expect(result.items[0].mlItemId).toBe("MLB-REPAIR");
    expect(createCalls).toBe(2);

    const updatedDraft = await prisma.listingDraft.findUnique({ where: { productId: product.id } });
    expect(updatedDraft?.title).toBe("Repair Product Fixed");

    await prisma.publishJobItem.deleteMany({ where: { jobId: job.id } });
    await prisma.publishJob.delete({ where: { id: job.id } }).catch(() => undefined);
    await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
  });
});
