import { describe, expect, it } from "vitest";
import { markUserEdited, mergeScrapedIntoDraft } from "@/lib/sync/merge";

describe("mergeScrapedIntoDraft", () => {
  const scraped = {
    externalId: "1",
    sourceUrl: "https://example.com/p/1",
    title: "Novo Titulo Scraped",
    costPrice: 50,
    description: "Desc nova",
    pictures: ["https://img/a.jpg"],
    stock: 8,
    videoUrl: "https://youtube.com/watch?v=abc",
    attributes: [{ name: "Cor", value: "Azul" }],
  };

  it("aplica percentual de estoque do catálogo", () => {
    const result = mergeScrapedIntoDraft(
      scraped,
      {
        title: "Old",
        costPrice: 10,
        description: "Old desc",
        pictures: "[]",
      },
      {
        title: "Old draft",
        description: "Old draft desc",
        price: 20,
        pictures: "[]",
        userEditedJson: "{}",
      },
      { catalogStockPercent: 25 }
    );
    expect(result.product.sourceStock).toBe(8);
    expect(result.product.stock).toBe(2);
    expect(result.draft.availableQuantity).toBe(2);
  });

  it("overwrites draft title when not user-edited", () => {
    const result = mergeScrapedIntoDraft(
      scraped,
      {
        title: "Old",
        costPrice: 10,
        description: "Old desc",
        pictures: "[]",
      },
      {
        title: "Old draft",
        description: "Old draft desc",
        price: 20,
        pictures: "[]",
        userEditedJson: "{}",
      }
    );
    expect(result.draft.title).toBe("Novo Titulo Scraped");
    expect(result.product.costPrice).toBe(50);
    expect(result.product.stock).toBe(8);
    expect(result.draft.availableQuantity).toBe(8);
    expect(result.draft.videoUrl).toContain("youtube");
  });

  it("preserves user-edited title", () => {
    const edited = markUserEdited("{}", ["title"]);
    const result = mergeScrapedIntoDraft(
      scraped,
      {
        title: "Old",
        costPrice: 10,
        description: "Old desc",
        pictures: "[]",
      },
      {
        title: "Meu Titulo",
        description: "Old draft desc",
        price: 99,
        pictures: "[]",
        userEditedJson: edited,
      }
    );
    expect(result.draft.title).toBe("Meu Titulo");
    expect(result.draft.price).toBe(99);
  });

  it("keeps the known cost and pictures when the scrape could not read them", () => {
    const result = mergeScrapedIntoDraft(
      { ...scraped, costPrice: 0, pictures: [] },
      {
        title: "Old",
        costPrice: 79.9,
        description: "Old desc",
        pictures: JSON.stringify(["https://img/old.jpg"]),
      },
      {
        title: "Old draft",
        description: "Old draft desc",
        price: 0,
        pictures: JSON.stringify(["https://img/old.jpg"]),
        userEditedJson: "{}",
      }
    );
    expect(result.product.costPrice).toBe(79.9);
    expect(result.product.pictures).toBe(JSON.stringify(["https://img/old.jpg"]));
    expect(result.draft.price).toBe(79.9);
  });

  it("clears a stale video when the product page no longer has one", () => {
    const result = mergeScrapedIntoDraft(
      { ...scraped, videoUrl: null },
      {
        title: "Old",
        costPrice: 10,
        description: "Old",
        pictures: "[]",
        videoUrl: "https://youtu.be/link-errado-do-rodape",
      },
      {
        title: "Old",
        description: "Old",
        price: 20,
        pictures: "[]",
        videoUrl: "https://youtu.be/link-errado-do-rodape",
        userEditedJson: "{}",
      }
    );
    expect(result.product.videoUrl).toBeNull();
    expect(result.draft.videoUrl).toBeNull();
  });

  it("preserva título ML curto quando o original longo não mudou", () => {
    const longTitle =
      "Liquidificador BLQ1280P Com 4 Lâminas Inox 2,7L 1150W Cor Preto Britânia Premium Extra";
    const result = mergeScrapedIntoDraft(
      { ...scraped, title: longTitle },
      { title: longTitle, costPrice: 10, description: "Old", pictures: "[]" },
      { title: "Título ML curto", description: "Old", price: 20, pictures: "[]", userEditedJson: "{}" }
    );
    expect(result.product.title).toBe(longTitle);
    expect(result.draft.title).toBe("Título ML curto");
  });

  it("esvazia título ML quando o original longo mudou (para regerar com IA)", () => {
    const longTitle =
      "Liquidificador BLQ1280P Com 4 Lâminas Inox 2,7L 1150W Cor Preto Britânia Premium Extra";
    const result = mergeScrapedIntoDraft(
      { ...scraped, title: longTitle },
      { title: "Outro título antigo", costPrice: 10, description: "Old", pictures: "[]" },
      { title: "Título ML curto", description: "Old", price: 20, pictures: "[]", userEditedJson: "{}" }
    );
    expect(result.draft.title).toBe("");
  });

  it("carries sku, category and scrape warnings to the product", () => {
    const result = mergeScrapedIntoDraft(
      {
        ...scraped,
        sku: "ABC-1",
        categoryPath: "Casa > Cozinha",
        warranty: "12 meses",
        warnings: ["estoque não encontrado"],
      },
      { title: "Old", costPrice: 10, description: "Old", pictures: "[]" },
      { title: "Old", description: "Old", price: 20, pictures: "[]", userEditedJson: "{}" }
    );
    expect(result.product.sku).toBe("ABC-1");
    expect(result.product.categoryPath).toBe("Casa > Cozinha");
    expect(result.product.warranty).toBe("12 meses");
    expect(result.product.warningsJson).toBe(JSON.stringify(["estoque não encontrado"]));
  });

  it("preserves user-edited quantity and video", () => {
    const edited = markUserEdited("{}", ["availableQuantity", "videoUrl"]);
    const result = mergeScrapedIntoDraft(
      scraped,
      {
        title: "Old",
        costPrice: 10,
        description: "Old desc",
        pictures: "[]",
      },
      {
        title: "Old",
        description: "Old",
        price: 20,
        pictures: "[]",
        availableQuantity: 3,
        videoUrl: "https://mine.video",
        userEditedJson: edited,
      }
    );
    expect(result.draft.availableQuantity).toBe(3);
    expect(result.draft.videoUrl).toBe("https://mine.video");
    expect(result.product.stock).toBe(8);
  });
});
