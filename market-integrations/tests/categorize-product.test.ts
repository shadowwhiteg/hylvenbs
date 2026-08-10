import { beforeEach, describe, expect, it, vi } from "vitest";

const { predictCategoryByTitleMock, categorizeWithAiMock } = vi.hoisted(() => ({
  predictCategoryByTitleMock: vi.fn(),
  categorizeWithAiMock: vi.fn(),
}));

vi.mock("@/lib/ml/categories", () => ({
  predictCategoryByTitle: predictCategoryByTitleMock,
}));

vi.mock("@/lib/agent/category", () => ({
  categorizeWithAi: categorizeWithAiMock,
}));

import { categorizeProduct } from "@/lib/ml/categorize-product";

describe("categorizeProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("usa o preditor ML quando disponível", async () => {
    predictCategoryByTitleMock.mockResolvedValue({
      suggestions: [
        {
          domain_id: "MLB-CELLPHONES",
          domain_name: "Celulares",
          category_id: "MLB1055",
          category_name: "Celulares e Smartphones",
        },
      ],
      best: {
        domain_id: "MLB-CELLPHONES",
        domain_name: "Celulares",
        category_id: "MLB1055",
        category_name: "Celulares e Smartphones",
      },
      warnings: [],
    });

    const result = await categorizeProduct({ title: "Smartphone Samsung Galaxy" });

    expect(result.source).toBe("ml_predictor");
    expect(result.categoryId).toBe("MLB1055");
    expect(categorizeWithAiMock).not.toHaveBeenCalled();
  });

  it("faz fallback para IA quando o preditor ML falha", async () => {
    predictCategoryByTitleMock.mockResolvedValue({
      suggestions: [],
      best: null,
      warnings: ["Preditor ML não retornou categorias"],
    });
    categorizeWithAiMock.mockResolvedValue({
      categoryId: "MLB5726",
      categoryName: "Fones de Ouvido",
      categoryPath: "Eletrônicos > Áudio > Fones de Ouvido",
      model: "qwen3.5:4b",
      warnings: [],
    });

    const result = await categorizeProduct({ title: "Fone Bluetooth JBL" });

    expect(result.source).toBe("ai");
    expect(result.categoryId).toBe("MLB5726");
    expect(categorizeWithAiMock).toHaveBeenCalled();
  });

  it("não usa IA quando allowAiFallback=false", async () => {
    predictCategoryByTitleMock.mockResolvedValue({
      suggestions: [],
      best: null,
      warnings: ["Preditor ML indisponível"],
    });

    const result = await categorizeProduct({
      title: "Produto qualquer",
      allowAiFallback: false,
    });

    expect(result.source).toBe("none");
    expect(result.categoryId).toBe("");
    expect(categorizeWithAiMock).not.toHaveBeenCalled();
  });
});
