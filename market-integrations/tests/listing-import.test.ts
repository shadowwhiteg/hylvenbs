import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mlTokenFindUnique,
  mlTokenUpdate,
  mlListingUpsert,
  mlListingFindMany,
  mlListingDeleteMany,
  productFindMany,
  productUpdateMany,
  searchMyItemsMock,
  getItemsMultigetMock,
  checkItemsExistenceMock,
} = vi.hoisted(() => ({
  mlTokenFindUnique: vi.fn(),
  mlTokenUpdate: vi.fn(),
  mlListingUpsert: vi.fn(),
  mlListingFindMany: vi.fn(),
  mlListingDeleteMany: vi.fn(),
  productFindMany: vi.fn(),
  productUpdateMany: vi.fn(),
  searchMyItemsMock: vi.fn(),
  getItemsMultigetMock: vi.fn(),
  checkItemsExistenceMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlToken: { findUnique: mlTokenFindUnique, update: mlTokenUpdate },
    mlListing: {
      upsert: mlListingUpsert,
      findMany: mlListingFindMany,
      deleteMany: mlListingDeleteMany,
    },
    product: { findMany: productFindMany, updateMany: productUpdateMany },
  },
}));

vi.mock("@/lib/ml/auth", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("token123"),
}));

vi.mock("@/lib/ml/client", () => ({
  searchMyItems: searchMyItemsMock,
  getItemsMultiget: getItemsMultigetMock,
  checkItemsExistence: checkItemsExistenceMock,
}));

import { importMlListings } from "@/lib/ml/listing-import";

const existence = (over: Partial<{ alive: string[]; missing: string[]; unknown: string[] }> = {}) => ({
  alive: new Set(over.alive ?? []),
  missing: new Set(over.missing ?? []),
  unknown: new Set(over.unknown ?? []),
});

describe("importMlListings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlListingUpsert.mockResolvedValue({});
    mlListingFindMany.mockResolvedValue([]);
    mlListingDeleteMany.mockResolvedValue({ count: 0 });
    productFindMany.mockResolvedValue([]);
    productUpdateMany.mockResolvedValue({ count: 0 });
    checkItemsExistenceMock.mockResolvedValue(existence());
  });

  it("resolves userId from MlToken and paginates via scroll_id until exhausted", async () => {
    mlTokenFindUnique.mockResolvedValue({ userId: "999" });
    searchMyItemsMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        raw: "",
        data: { results: ["MLB1", "MLB2"], scroll_id: "s1" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        raw: "",
        data: { results: [], scroll_id: "s1" },
      });
    getItemsMultigetMock.mockResolvedValue({
      items: [
        {
          id: "MLB1",
          title: "Item 1",
          price: 10,
          currency_id: "BRL",
          available_quantity: 1,
          sold_quantity: 0,
          status: "active",
        },
        {
          id: "MLB2",
          title: "Item 2",
          price: 20,
          currency_id: "BRL",
          available_quantity: 2,
          sold_quantity: 1,
          status: "paused",
        },
      ],
      errors: [],
    });

    const result = await importMlListings();

    expect(searchMyItemsMock).toHaveBeenCalledTimes(2);
    expect(getItemsMultigetMock).toHaveBeenCalledWith(["MLB1", "MLB2"], undefined);
    expect(mlListingUpsert).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ imported: 2, pruned: 0, unlinkedProducts: 0, errors: [] });
  });

  it("removes local listings and catalog links when the ML item no longer exists", async () => {
    mlTokenFindUnique.mockResolvedValue({ userId: "1" });
    searchMyItemsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: { results: [], scroll_id: undefined },
    });
    getItemsMultigetMock.mockResolvedValue({ items: [], errors: [] });
    mlListingFindMany.mockResolvedValue([{ id: "MLB-GONE" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB-GONE" }]);
    checkItemsExistenceMock.mockResolvedValue(existence({ missing: ["MLB-GONE"] }));
    mlListingDeleteMany.mockResolvedValue({ count: 1 });
    productUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });

    const result = await importMlListings();

    expect(checkItemsExistenceMock).toHaveBeenCalledWith(["MLB-GONE"], undefined);
    expect(mlListingDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["MLB-GONE"] } } });
    expect(productUpdateMany).toHaveBeenCalledWith({
      where: { mlItemId: { in: ["MLB-GONE"] } },
      data: { mlItemId: null, mlPermalink: null },
    });
    expect(result).toMatchObject({ pruned: 1, unlinkedProducts: 1 });
  });

  it("keeps local data when the existence check is inconclusive (network error)", async () => {
    mlTokenFindUnique.mockResolvedValue({ userId: "1" });
    searchMyItemsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: { results: [], scroll_id: undefined },
    });
    getItemsMultigetMock.mockResolvedValue({ items: [], errors: [] });
    mlListingFindMany.mockResolvedValue([{ id: "MLB-MAYBE" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB-MAYBE" }]);
    checkItemsExistenceMock.mockResolvedValue(existence({ unknown: ["MLB-MAYBE"] }));

    const result = await importMlListings();

    expect(mlListingDeleteMany).not.toHaveBeenCalled();
    expect(productUpdateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ pruned: 0, unlinkedProducts: 0 });
  });

  it("does not touch listings that are still alive on ML", async () => {
    mlTokenFindUnique.mockResolvedValue({ userId: "1" });
    searchMyItemsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: { results: ["MLB-LIVE"], scroll_id: undefined },
    });
    getItemsMultigetMock.mockResolvedValue({
      items: [{ id: "MLB-LIVE", title: "x", price: 1, status: "active" }],
      errors: [],
    });
    mlListingFindMany.mockResolvedValue([{ id: "MLB-LIVE" }]);
    productFindMany.mockResolvedValue([{ mlItemId: "MLB-LIVE" }]);

    await importMlListings();

    expect(checkItemsExistenceMock).not.toHaveBeenCalled();
    expect(mlListingDeleteMany).not.toHaveBeenCalled();
  });

  it("fetches userId from /users/me when MlToken has none, and persists it", async () => {
    mlTokenFindUnique.mockResolvedValue({ userId: null });
    searchMyItemsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: { results: [], scroll_id: undefined },
    });
    getItemsMultigetMock.mockResolvedValue({ items: [], errors: [] });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 555 }),
    });

    await importMlListings({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.mercadolibre.com/users/me",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(mlTokenUpdate).toHaveBeenCalledWith({
      where: { id: "default" },
      data: { userId: "555" },
    });
    expect(searchMyItemsMock).toHaveBeenCalledWith("555", { scrollId: undefined }, fetchImpl);
  });

  it("stops pagination once results are empty even with a scroll_id", async () => {
    mlTokenFindUnique.mockResolvedValue({ userId: "1" });
    searchMyItemsMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "",
      data: { results: [], scroll_id: "abc" },
    });
    getItemsMultigetMock.mockResolvedValue({ items: [], errors: [] });

    await importMlListings();

    expect(searchMyItemsMock).toHaveBeenCalledTimes(1);
  });
});
