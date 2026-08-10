import { describe, expect, it } from "vitest";
import { parseAiCategoryResponse } from "@/lib/agent/category";

describe("parseAiCategoryResponse", () => {
  it("parseia JSON da IA com category_id", () => {
    const candidates = [
      { id: "MLB5726", name: "Fones de Ouvido", path: "Eletrônicos > Áudio > Fones de Ouvido" },
    ];
    const parsed = parseAiCategoryResponse(
      '{"category_id":"MLB5726","category_name":"Fones de Ouvido"}',
      candidates
    );
    expect(parsed?.categoryId).toBe("MLB5726");
    expect(parsed?.categoryPath).toContain("Fones");
  });
});
