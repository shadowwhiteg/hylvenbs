import { describe, expect, it } from "vitest";
import { parseGtinPolicy } from "@/lib/ml/category-attributes";

describe("parseGtinPolicy", () => {
  it("detecta GTIN condicional e motivo vazio", () => {
    expect(
      parseGtinPolicy([
        { id: "GTIN", tags: { conditional_required: true } },
        { id: "EMPTY_GTIN_REASON", tags: { conditional_required: true } },
      ])
    ).toEqual({
      gtinConditionallyRequired: true,
      allowsEmptyGtinReason: true,
    });
  });

  it("detecta GTIN obrigatório sem motivo alternativo (MLB271155)", () => {
    expect(
      parseGtinPolicy([{ id: "GTIN", tags: { conditional_required: true } }])
    ).toEqual({
      gtinConditionallyRequired: true,
      allowsEmptyGtinReason: false,
    });
  });
});
