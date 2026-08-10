import { describe, expect, it } from "vitest";
import {
  decideListingSync,
  isAutoSyncMode,
  shouldRecalculatePrice,
} from "@/lib/sync/auto-sync-policy";

const base = {
  autoPauseWhenUnavailable: true,
  hasMlItemId: true,
  productStatus: "published",
  priceUserEdited: false,
  stock: 5,
};

describe("isAutoSyncMode", () => {
  it("accepts known modes", () => {
    expect(isAutoSyncMode("always")).toBe(true);
    expect(isAutoSyncMode("stock_only")).toBe(true);
    expect(isAutoSyncMode("respect_user_edits")).toBe(true);
    expect(isAutoSyncMode("manual")).toBe(true);
  });

  it("rejects unknown", () => {
    expect(isAutoSyncMode("foo")).toBe(false);
  });
});

describe("decideListingSync", () => {
  it("manual never pushes", () => {
    const d = decideListingSync({ ...base, mode: "manual" });
    expect(d.shouldPush).toBe(false);
    expect(d.updatePrice).toBe(false);
    expect(d.updateQuantity).toBe(false);
  });

  it("skips without mlItemId", () => {
    const d = decideListingSync({ ...base, mode: "always", hasMlItemId: false });
    expect(d.shouldPush).toBe(false);
  });

  it("always updates price and qty", () => {
    const d = decideListingSync({ ...base, mode: "always" });
    expect(d).toMatchObject({
      shouldPush: true,
      updatePrice: true,
      updateQuantity: true,
      treatAsUnavailable: false,
      pauseListing: false,
    });
  });

  it("stock_only updates only qty", () => {
    const d = decideListingSync({ ...base, mode: "stock_only" });
    expect(d.updatePrice).toBe(false);
    expect(d.updateQuantity).toBe(true);
    expect(d.shouldPush).toBe(true);
  });

  it("respect_user_edits skips price when edited", () => {
    const d = decideListingSync({
      ...base,
      mode: "respect_user_edits",
      priceUserEdited: true,
    });
    expect(d.updatePrice).toBe(false);
    expect(d.updateQuantity).toBe(true);
  });

  it("respect_user_edits updates price when not edited", () => {
    const d = decideListingSync({
      ...base,
      mode: "respect_user_edits",
      priceUserEdited: false,
    });
    expect(d.updatePrice).toBe(true);
  });

  it("unavailable forces qty path and pause when flag on", () => {
    const d = decideListingSync({
      ...base,
      mode: "always",
      productStatus: "unavailable",
      autoPauseWhenUnavailable: true,
    });
    expect(d.treatAsUnavailable).toBe(true);
    expect(d.updateQuantity).toBe(true);
    expect(d.updatePrice).toBe(false);
    expect(d.pauseListing).toBe(true);
  });

  it("stock 0 treated as unavailable", () => {
    const d = decideListingSync({ ...base, mode: "always", stock: 0 });
    expect(d.treatAsUnavailable).toBe(true);
  });

  it("unavailable without pause flag does not pause", () => {
    const d = decideListingSync({
      ...base,
      mode: "always",
      productStatus: "unavailable",
      autoPauseWhenUnavailable: false,
    });
    expect(d.pauseListing).toBe(false);
    expect(d.treatAsUnavailable).toBe(true);
  });
});

describe("shouldRecalculatePrice", () => {
  it("always recalculates when available", () => {
    expect(
      shouldRecalculatePrice({
        mode: "always",
        priceUserEdited: true,
        treatAsUnavailable: false,
      }).recalculate
    ).toBe(true);
  });

  it("stock_only never recalculates", () => {
    expect(
      shouldRecalculatePrice({
        mode: "stock_only",
        priceUserEdited: false,
        treatAsUnavailable: false,
      }).recalculate
    ).toBe(false);
  });

  it("respect_user_edits recalculates only if not edited", () => {
    expect(
      shouldRecalculatePrice({
        mode: "respect_user_edits",
        priceUserEdited: false,
        treatAsUnavailable: false,
      }).recalculate
    ).toBe(true);
    expect(
      shouldRecalculatePrice({
        mode: "respect_user_edits",
        priceUserEdited: true,
        treatAsUnavailable: false,
      }).recalculate
    ).toBe(false);
  });
});
