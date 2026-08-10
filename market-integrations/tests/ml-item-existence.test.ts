import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ml/auth", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("token123"),
}));

import { checkItemsExistence, isDeletedItemBody } from "@/lib/ml/client";

function jsonFetch(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  });
}

describe("isDeletedItemBody", () => {
  it("flags sub_status deleted", () => {
    expect(isDeletedItemBody({ id: "M1", status: "closed", sub_status: ["deleted"] })).toBe(true);
    expect(
      isDeletedItemBody({ id: "M1", status: "inactive", sub_status: ["forbidden", "deleted"] })
    ).toBe(true);
  });

  it("keeps merely closed/paused listings alive", () => {
    expect(isDeletedItemBody({ id: "M1", status: "closed", sub_status: [] })).toBe(false);
    expect(isDeletedItemBody({ id: "M1", status: "paused", sub_status: ["out_of_stock"] })).toBe(
      false
    );
  });
});

describe("checkItemsExistence", () => {
  it("classifies deleted items as missing even on HTTP 200", async () => {
    const fetchImpl = jsonFetch([
      { code: 200, body: { id: "MLB111", status: "active", sub_status: [] } },
      { code: 200, body: { id: "MLB222", status: "closed", sub_status: ["deleted"] } },
      { code: 404, body: { id: "MLB333" } },
    ]);

    const res = await checkItemsExistence(
      ["MLB111", "MLB222", "MLB333"],
      fetchImpl as unknown as typeof fetch
    );

    expect([...res.alive]).toEqual(["MLB111"]);
    expect([...res.missing].sort()).toEqual(["MLB222", "MLB333"]);
    expect(res.unknown.size).toBe(0);
  });

  it("rejects malformed ids locally instead of poisoning the whole batch", async () => {
    const fetchImpl = jsonFetch([
      { code: 200, body: { id: "MLB123", status: "active", sub_status: [] } },
    ]);

    const res = await checkItemsExistence(
      ["MLB123", "MLB-REPAIR"],
      fetchImpl as unknown as typeof fetch
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("MLB-REPAIR");
    expect([...res.alive]).toEqual(["MLB123"]);
    expect([...res.missing]).toEqual(["MLB-REPAIR"]);
  });

  it("marks the whole batch as unknown when the request fails", async () => {
    const fetchImpl = jsonFetch({ message: "boom" }, false, 500);

    const res = await checkItemsExistence(
      ["MLB1", "MLB2"],
      fetchImpl as unknown as typeof fetch
    );

    expect(res.missing.size).toBe(0);
    expect([...res.unknown].sort()).toEqual(["MLB1", "MLB2"]);
  });
});
