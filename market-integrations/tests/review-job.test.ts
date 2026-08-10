import { beforeEach, describe, expect, it, vi } from "vitest";

const { reviewJobCreate, reviewJobUpdate, reviewJobFindUnique, reviewJobItemUpdate, reviewJobItemFindMany } =
  vi.hoisted(() => ({
    reviewJobCreate: vi.fn(),
    reviewJobUpdate: vi.fn(),
    reviewJobFindUnique: vi.fn(),
    reviewJobItemUpdate: vi.fn(),
    reviewJobItemFindMany: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    reviewJob: { create: reviewJobCreate, update: reviewJobUpdate, findUnique: reviewJobFindUnique },
    reviewJobItem: { update: reviewJobItemUpdate, findMany: reviewJobItemFindMany },
  },
}));

import { enqueueReviewJob, processReviewJob } from "@/lib/ml/review-job";

function item(id: string, mlListingId: string, status = "pending") {
  return { id, mlListingId, status };
}

describe("enqueueReviewJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty id list", async () => {
    await expect(enqueueReviewJob([])).rejects.toThrow("Selecione ao menos um anúncio");
    expect(reviewJobCreate).not.toHaveBeenCalled();
  });

  it("dedupes ids and creates one pending item per id", async () => {
    reviewJobCreate.mockResolvedValue({ id: "job1", status: "pending", items: [] });
    // The zero-item job lets the fire-and-forget processReviewJob() finish cleanly in the background.
    reviewJobFindUnique.mockResolvedValue({ id: "job1", items: [] });
    reviewJobUpdate.mockResolvedValue({});
    reviewJobItemFindMany.mockResolvedValue([]);

    await enqueueReviewJob(["MLB1", "MLB2", "MLB1"]);

    expect(reviewJobCreate).toHaveBeenCalledWith({
      data: {
        status: "pending",
        items: { create: [{ mlListingId: "MLB1", status: "pending" }, { mlListingId: "MLB2", status: "pending" }] },
      },
      include: { items: true },
    });
  });
});

describe("processReviewJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviewJobUpdate.mockResolvedValue({});
    reviewJobItemUpdate.mockResolvedValue({});
  });

  it("marks a matched+applied item as success and a not-matched item as skipped", async () => {
    reviewJobFindUnique.mockResolvedValue({
      id: "job1",
      items: [item("i1", "MLB1"), item("i2", "MLB2")],
    });
    reviewJobItemFindMany.mockResolvedValue([
      { status: "success" },
      { status: "skipped" },
    ]);
    const applyListingReviewFn = vi
      .fn()
      .mockResolvedValueOnce({ matched: true, applied: true, titleApplied: true, attributesApplied: false, warnings: [] })
      .mockResolvedValueOnce({ matched: false, applied: false, titleApplied: false, attributesApplied: false, warnings: [] });

    const result = await processReviewJob("job1", {
      applyListingReviewFn,
      sleepFn: async () => undefined,
    });

    expect(reviewJobItemUpdate).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "success", titleChanged: true, attributesChanged: false, error: null },
    });
    expect(reviewJobItemUpdate).toHaveBeenCalledWith({
      where: { id: "i2" },
      data: { status: "skipped", titleChanged: false, attributesChanged: false, error: null },
    });
    expect(result).toEqual({});
    expect(reviewJobUpdate).toHaveBeenLastCalledWith({
      where: { id: "job1" },
      data: { status: "success", finishedAt: expect.any(Date) },
      include: { items: true },
    });
  });

  it("marks a thrown error as an error item without stopping the batch", async () => {
    reviewJobFindUnique.mockResolvedValue({
      id: "job1",
      items: [item("i1", "MLB1"), item("i2", "MLB2")],
    });
    reviewJobItemFindMany.mockResolvedValue([{ status: "error" }, { status: "success" }]);
    const applyListingReviewFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ matched: true, applied: true, titleApplied: true, attributesApplied: true, warnings: [] });

    await processReviewJob("job1", { applyListingReviewFn, sleepFn: async () => undefined });

    expect(reviewJobItemUpdate).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "error", error: "boom" },
    });
    expect(applyListingReviewFn).toHaveBeenCalledTimes(2);
    expect(reviewJobUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "partial" }) })
    );
  });

  it("marks the job as error only when every item failed", async () => {
    reviewJobFindUnique.mockResolvedValue({ id: "job1", items: [item("i1", "MLB1")] });
    reviewJobItemFindMany.mockResolvedValue([{ status: "error" }]);
    const applyListingReviewFn = vi.fn().mockRejectedValue(new Error("boom"));

    await processReviewJob("job1", { applyListingReviewFn, sleepFn: async () => undefined });

    expect(reviewJobUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "error" }) })
    );
  });

  it("pauses with the batch cooldown at every batch boundary and the item delay otherwise", async () => {
    const items = [item("i1", "MLB1"), item("i2", "MLB2"), item("i3", "MLB3")];
    reviewJobFindUnique.mockResolvedValue({ id: "job1", items });
    reviewJobItemFindMany.mockResolvedValue([
      { status: "success" },
      { status: "success" },
      { status: "success" },
    ]);
    const applyListingReviewFn = vi
      .fn()
      .mockResolvedValue({ matched: true, applied: true, titleApplied: true, attributesApplied: true, warnings: [] });
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await processReviewJob("job1", {
      applyListingReviewFn,
      sleepFn,
      batchSize: 2,
      itemDelayMs: 300,
      batchCooldownMs: 5000,
    });

    // item1 -> not a batch boundary -> itemDelayMs; item2 -> batch boundary -> batchCooldownMs;
    // item3 -> last item -> no sleep call.
    expect(sleepFn).toHaveBeenNthCalledWith(1, 300);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 5000);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it("throws when the job does not exist", async () => {
    reviewJobFindUnique.mockResolvedValue(null);
    await expect(processReviewJob("missing")).rejects.toThrow("ReviewJob not found");
  });
});
