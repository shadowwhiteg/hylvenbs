import { describe, expect, it } from "vitest";
import { signPublic, signShop } from "@/lib/shopee/sign";

describe("shopee sign", () => {
  it("signPublic is deterministic for the same inputs", () => {
    const a = signPublic("1000", "/api/v2/auth/token/get", 1700000000, "secret");
    const b = signPublic("1000", "/api/v2/auth/token/get", 1700000000, "secret");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signPublic changes when any input changes", () => {
    const base = signPublic("1000", "/api/v2/auth/token/get", 1700000000, "secret");
    expect(signPublic("1001", "/api/v2/auth/token/get", 1700000000, "secret")).not.toBe(base);
    expect(signPublic("1000", "/api/v2/auth/token/refresh", 1700000000, "secret")).not.toBe(base);
    expect(signPublic("1000", "/api/v2/auth/token/get", 1700000001, "secret")).not.toBe(base);
    expect(signPublic("1000", "/api/v2/auth/token/get", 1700000000, "other")).not.toBe(base);
  });

  it("signShop includes access_token and shop_id in the signed base", () => {
    const a = signShop("1000", "/api/v2/product/get_item_list", 1700000000, "secret", "tokenA", "shop1");
    const b = signShop("1000", "/api/v2/product/get_item_list", 1700000000, "secret", "tokenB", "shop1");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signPublic and signShop differ for the same partner/path/timestamp/key", () => {
    const pub = signPublic("1000", "/api/v2/product/get_item_list", 1700000000, "secret");
    const shop = signShop("1000", "/api/v2/product/get_item_list", 1700000000, "secret", "token", "shop1");
    expect(pub).not.toBe(shop);
  });
});
