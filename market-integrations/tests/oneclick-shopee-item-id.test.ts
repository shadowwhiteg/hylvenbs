import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { oneClickItemId } from "@/lib/oneclick/client";

/**
 * Regressão: a Shopee devolve `item_id` NUMÉRICO. O número vazava direto para o
 * Prisma (campo String), o update explodia, o item virava "error" e o id do
 * anúncio recém-criado se perdia — o anúncio existia na Shopee e o sistema não
 * sabia, então tentaria publicar de novo.
 */

vi.mock("@/lib/oneclick/session", () => ({
  getOneClickSession: vi.fn(async () => ({
    session: { jar: { header: () => "" } },
    wmd: {
      restPublish: "https://example.com/publish",
      restShopeePublish: "https://example.com/sp",
      restPublished: "",
      restDefaults: "",
      restSkuItems: "",
      restNonce: "nonce",
      ajaxurl: "https://example.com/admin-ajax.php",
      mlConnected: "1",
      spConnected: "1",
    },
  })),
  USER_AGENT: "test",
}));

vi.mock("@/lib/oneclick/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/oneclick/client")>(
    "@/lib/oneclick/client"
  );
  return {
    ...actual,
    searchProductBySku: vi.fn(async () => ({ id: 42, text: "Produto (SKU: SPNUM)" })),
    publishMl: vi.fn(async () => ({})),
    // exatamente o formato real observado: número, não string
    publishShopee: vi.fn(async () => ({ "42": { ok: true, item_id: 22795160346 } })),
  };
});

describe("oneClickItemId", () => {
  it("normaliza número, string e vazio", () => {
    expect(oneClickItemId(22795160346)).toBe("22795160346");
    expect(oneClickItemId("MLB123")).toBe("MLB123");
    expect(oneClickItemId("  ")).toBeNull();
    expect(oneClickItemId(null)).toBeNull();
    expect(oneClickItemId(undefined)).toBeNull();
  });
});

describe("processOneClickJob com item_id numérico da Shopee", () => {
  let jobId = "";
  let productId = "";

  beforeAll(async () => {
    const stamp = Date.now();
    const product = await prisma.product.create({
      data: {
        externalId: `sp-num-${stamp}`,
        sourceUrl: `https://example.com/sp-num-${stamp}`,
        title: "Shopee Numeric Id",
        costPrice: 10,
        sku: "SPNUM",
        status: "synced",
      },
    });
    productId = product.id;

    const job = await prisma.oneClickJob.create({
      data: {
        marketplace: "shopee",
        mode: "publish",
        status: "pending",
        items: {
          create: [
            {
              productId: product.id,
              sku: "SPNUM",
              title: "Shopee Numeric Id",
              price: 18.67,
              status: "pending",
            },
          ],
        },
      },
    });
    jobId = job.id;
  });

  afterAll(async () => {
    if (jobId) {
      await prisma.oneClickJobItem.deleteMany({ where: { jobId } });
      await prisma.oneClickJob.delete({ where: { id: jobId } }).catch(() => undefined);
    }
    if (productId) {
      await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
    }
  });

  it("grava o id numérico como string em vez de estourar o update", async () => {
    const { processOneClickJob } = await import("@/lib/oneclick/worker");
    const result = await processOneClickJob(jobId, 0);

    expect(result.status).toBe("success");
    expect(result.items[0].status).toBe("success");
    expect(result.items[0].resultItemId).toBe("22795160346");
    expect(result.items[0].error).toBeNull();

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.shopeeItemId).toBe("22795160346");
    expect(product?.status).toBe("published");
  });
});
