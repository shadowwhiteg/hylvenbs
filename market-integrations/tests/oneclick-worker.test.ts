import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

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
  // spread do módulo real para não perder helpers (ex.: oneClickItemId)
  const actual = await vi.importActual<typeof import("@/lib/oneclick/client")>(
    "@/lib/oneclick/client"
  );
  return {
    ...actual,
    searchProductBySku: vi.fn(async () => ({ id: 42, text: "Produto (SKU: ABC)" })),
    publishMl: vi.fn(async () => ({
      "42": { ok: true, item_id: "MLB-ONECLICK-1", linked: false },
    })),
    publishShopee: vi.fn(async () => ({})),
  };
});

describe("processOneClickJob mlItemId", () => {
  let jobId = "";
  let productId = "";

  beforeAll(async () => {
    const product = await prisma.product.create({
      data: {
        externalId: `oc-${Date.now()}`,
        sourceUrl: `https://example.com/oc-${Date.now()}`,
        title: "One Click Product",
        costPrice: 10,
        sku: "ABC",
        status: "synced",
      },
    });
    productId = product.id;

    const job = await prisma.oneClickJob.create({
      data: {
        marketplace: "ml",
        mode: "publish",
        status: "pending",
        items: {
          create: [
            {
              productId: product.id,
              sku: "ABC",
              title: "One Click Product",
              price: 19.9,
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

  it("sets Product.mlItemId on successful ML publish", async () => {
    const { processOneClickJob } = await import("@/lib/oneclick/worker");
    const result = await processOneClickJob(jobId, 0);
    expect(result.status).toBe("success");
    expect(result.items[0].status).toBe("success");
    expect(result.items[0].resultItemId).toBe("MLB-ONECLICK-1");

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.mlItemId).toBe("MLB-ONECLICK-1");
    expect(product?.status).toBe("published");
  });
});
