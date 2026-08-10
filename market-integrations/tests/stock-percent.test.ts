import { describe, expect, it } from "vitest";
import { applyStockPercent } from "@/lib/sync/stock-percent";

describe("applyStockPercent", () => {
  it("retorna null quando sourceStock é null ou indefinido", () => {
    expect(applyStockPercent(null, 25)).toBeNull();
    expect(applyStockPercent(undefined, 25)).toBeNull();
  });

  it("aplica percentual com arredondamento para baixo", () => {
    expect(applyStockPercent(30, 25)).toBe(7);
    expect(applyStockPercent(100, 33)).toBe(33);
    expect(applyStockPercent(1, 50)).toBe(0);
  });

  it("retorna estoque integral em 100% ou mais", () => {
    expect(applyStockPercent(30, 100)).toBe(30);
    expect(applyStockPercent(30, 150)).toBe(30);
  });

  it("zera estoque em 0% ou menos", () => {
    expect(applyStockPercent(30, 0)).toBe(0);
    expect(applyStockPercent(30, -5)).toBe(0);
  });
});
