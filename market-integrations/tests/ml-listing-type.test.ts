import { beforeEach, describe, expect, it, vi } from "vitest";

const { listingFindUnique, listingUpdate, draftUpdateMany } = vi.hoisted(() => ({
  listingFindUnique: vi.fn(),
  listingUpdate: vi.fn(),
  draftUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlListing: { findUnique: listingFindUnique, update: listingUpdate },
    listingDraft: { updateMany: draftUpdateMany },
  },
}));

import { applyBulkListingType, parseMlListingType } from "@/lib/ml/listing-type";

const okResponse = (listingTypeId: string) => ({
  ok: true,
  status: 200,
  raw: "",
  data: { id: "MLB1", listing_type_id: listingTypeId },
});

describe("parseMlListingType", () => {
  it("aceita só os dois tipos suportados", () => {
    expect(parseMlListingType("gold_pro")).toBe("gold_pro");
    expect(parseMlListingType("gold_special")).toBe("gold_special");
    expect(parseMlListingType("free")).toBeUndefined();
    expect(parseMlListingType(undefined)).toBeUndefined();
  });
});

describe("applyBulkListingType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingUpdate.mockResolvedValue({});
    draftUpdateMany.mockResolvedValue({ count: 1 });
    listingFindUnique.mockResolvedValue({ listingTypeId: "gold_special" });
  });

  it("converte e sincroniza snapshot + rascunho do produto", async () => {
    const changeFn = vi.fn().mockResolvedValue(okResponse("gold_pro"));

    const res = await applyBulkListingType(
      { ids: ["MLB1"], listingTypeId: "gold_pro" },
      { changeFn, delayMs: 0 }
    );

    expect(changeFn).toHaveBeenCalledWith("MLB1", "gold_pro");
    expect(listingUpdate).toHaveBeenCalledWith({
      where: { id: "MLB1" },
      data: { listingTypeId: "gold_pro" },
    });
    expect(draftUpdateMany).toHaveBeenCalledWith({
      where: { product: { mlItemId: "MLB1" } },
      data: { listingTypeId: "gold_pro" },
    });
    expect(res).toEqual({ updated: 1, skipped: 0, errors: [] });
  });

  it("não chama o ML para quem já está no tipo pedido", async () => {
    listingFindUnique.mockResolvedValue({ listingTypeId: "gold_pro" });
    const changeFn = vi.fn();

    const res = await applyBulkListingType(
      { ids: ["MLB1"], listingTypeId: "gold_pro" },
      { changeFn, delayMs: 0 }
    );

    expect(changeFn).not.toHaveBeenCalled();
    expect(res).toEqual({ updated: 0, skipped: 1, errors: [] });
  });

  it("repete em 429 e desiste depois do limite", async () => {
    const changeFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, raw: "", data: {} })
      .mockResolvedValueOnce(okResponse("gold_pro"));

    const res = await applyBulkListingType(
      { ids: ["MLB1"], listingTypeId: "gold_pro" },
      { changeFn, delayMs: 0, sleepFn: async () => {} }
    );

    expect(changeFn).toHaveBeenCalledTimes(2);
    expect(res.updated).toBe(1);
  });

  it("não acusa erro quando o ML recusa porque o anúncio já é do tipo pedido", async () => {
    // Snapshot local defasado: diz gold_special, mas no ML já está gold_pro.
    const changeFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      raw: "",
      data: { message: "Is not possible to upgrade or downgrade item" },
    });
    const readFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: { id: "MLB1", listing_type_id: "gold_pro" },
    });

    const res = await applyBulkListingType(
      { ids: ["MLB1"], listingTypeId: "gold_pro" },
      { changeFn, readFn, delayMs: 0 }
    );

    expect(res).toEqual({ updated: 0, skipped: 1, errors: [] });
    // e corrige o registro local que estava errado — snapshot E rascunho
    expect(listingUpdate).toHaveBeenCalledWith({
      where: { id: "MLB1" },
      data: { listingTypeId: "gold_pro" },
    });
    expect(draftUpdateMany).toHaveBeenCalledWith({
      where: { product: { mlItemId: "MLB1" } },
      data: { listingTypeId: "gold_pro" },
    });
  });

  it("registra erro com a mensagem do ML e não grava nada", async () => {
    const changeFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      raw: "",
      data: { message: "item cannot change listing type" },
    });
    const readFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: { id: "MLB1", listing_type_id: "gold_special" },
    });

    const res = await applyBulkListingType(
      { ids: ["MLB1"], listingTypeId: "gold_pro" },
      { changeFn, readFn, delayMs: 0 }
    );

    expect(listingUpdate).not.toHaveBeenCalled();
    expect(res.updated).toBe(0);
    expect(res.errors[0]).toContain("item cannot change listing type");
  });

  it("trata 200 que manteve o tipo antigo como falha", async () => {
    const changeFn = vi.fn().mockResolvedValue(okResponse("gold_special"));

    const res = await applyBulkListingType(
      { ids: ["MLB1"], listingTypeId: "gold_pro" },
      { changeFn, delayMs: 0 }
    );

    expect(listingUpdate).not.toHaveBeenCalled();
    expect(res.errors[0]).toContain("ML manteve gold_special");
  });
});
