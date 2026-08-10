import { describe, expect, it } from "vitest";
import { simulateCosts } from "@/lib/pricing/simulator";

describe("simulateCosts", () => {
  it("suggests price above cost", () => {
    const result = simulateCosts({
      costPrice: 100,
      listingTypeId: "gold_special",
      marginPercent: 30,
    });
    expect(result.suggestedPrice).toBeGreaterThan(100);
    expect(result.estimatedProfit).toBeGreaterThan(0);
  });

  it("recalculates with manual override", () => {
    const suggested = simulateCosts({
      costPrice: 100,
      listingTypeId: "gold_special",
      marginPercent: 30,
    });
    const overridden = simulateCosts({
      costPrice: 100,
      listingTypeId: "gold_special",
      marginPercent: 30,
      manualPrice: suggested.suggestedPrice + 50,
    });
    expect(overridden.breakdown.finalPrice).toBe(suggested.suggestedPrice + 50);
    expect(overridden.estimatedFee).toBeGreaterThan(suggested.estimatedFee);
  });

  it("rejects impossible margin", () => {
    expect(() =>
      simulateCosts({
        costPrice: 100,
        listingTypeId: "gold_special",
        marginPercent: 95,
      })
    ).toThrow(/margin \+ feeRate/);
  });

  it("rejects invalid cost", () => {
    expect(() =>
      simulateCosts({ costPrice: 0, listingTypeId: "gold_special" })
    ).toThrow(/costPrice/);
  });
});
