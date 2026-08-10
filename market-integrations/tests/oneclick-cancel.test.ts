import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/oneclick/session", () => ({
  getOneClickSession: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 50));
    return {
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
    };
  }),
  USER_AGENT: "test",
}));

vi.mock("@/lib/oneclick/client", () => ({
  searchProductBySku: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 30));
    return { id: 42, text: "Produto (SKU: CANCEL-SKU)" };
  }),
  publishMl: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 30));
    return { "42": { ok: true, item_id: "MLB-CANCEL", linked: false } };
  }),
  publishShopee: vi.fn(async () => ({})),
}));

describe("cancelOneClickJob", () => {
  let jobId = "";

  beforeAll(async () => {
    const job = await prisma.oneClickJob.create({
      data: {
        marketplace: "ml",
        mode: "publish",
        status: "running",
        items: {
          create: [
            { sku: "A", title: "A", status: "success", resultItemId: "MLB1" },
            { sku: "B", title: "B", status: "pending" },
            { sku: "C", title: "C", status: "pending" },
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
  });

  it("marks pending items cancelled and finishes the job", async () => {
    const { cancelOneClickJob } = await import("@/lib/oneclick/worker");
    const result = await cancelOneClickJob(jobId);
    expect(result.status).toBe("cancelled");
    expect(result.finishedAt).toBeTruthy();
    const pending = result.items.filter((i) => i.status === "pending");
    const cancelled = result.items.filter((i) => i.status === "cancelled");
    const success = result.items.filter((i) => i.status === "success");
    expect(pending).toHaveLength(0);
    expect(cancelled).toHaveLength(2);
    expect(success).toHaveLength(1);
  });

  it("rejects cancelling an already finished job", async () => {
    const { cancelOneClickJob } = await import("@/lib/oneclick/worker");
    await expect(cancelOneClickJob(jobId)).rejects.toThrow(/já finalizado/);
  });
});
