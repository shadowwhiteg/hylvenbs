import { beforeEach, describe, expect, it, vi } from "vitest";

const { mlListingFindUnique, mlListingUpdate, productFindFirst, updateItemMock, ollamaChatMock, getAppSettingsMock } =
  vi.hoisted(() => ({
    mlListingFindUnique: vi.fn(),
    mlListingUpdate: vi.fn(),
    productFindFirst: vi.fn(),
    updateItemMock: vi.fn(),
    ollamaChatMock: vi.fn(),
    getAppSettingsMock: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    mlListing: { findUnique: mlListingFindUnique, update: mlListingUpdate },
    product: { findFirst: productFindFirst },
  },
}));

vi.mock("@/lib/ml/client", () => ({
  updateItem: updateItemMock,
}));

vi.mock("@/lib/agent/ollama", () => ({
  ollamaChat: ollamaChatMock,
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: getAppSettingsMock,
}));

import { applyBulkReview, applyListingReview, reviewListingAgainstCatalog } from "@/lib/ml/listing-review";

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: "MLB1",
    title: "Bola de Vôlei Azul",
    categoryId: "MLB1334",
    attributesJson: JSON.stringify([
      { id: "COLOR", name: "Cor", value_name: "Azul" },
      { id: "CUSTOM_TAG", name: "Tag", value_name: "Promoção" },
    ]),
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    title: "Bola de Vôlei Azul",
    description: "Bola oficial de vôlei",
    sku: null,
    categoryPath: "Esportes > Vôlei",
    attributesJson: JSON.stringify([{ name: "Cor", value: "Preto" }]),
    ...overrides,
  };
}

describe("reviewListingAgainstCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppSettingsMock.mockResolvedValue({
      ollamaBaseUrl: "http://localhost:11434",
      ollamaModel: "test-model",
    });
    // Sem achados extras de IA por padrão, pra manter os testes focados no merge determinístico.
    ollamaChatMock.mockResolvedValue({ message: { content: '{"attributes":[]}' } });
  });

  it("reports matched:false for a listing without a linked Meu Drop product", async () => {
    mlListingFindUnique.mockResolvedValue(listing());
    productFindFirst.mockResolvedValue(null);

    const result = await reviewListingAgainstCatalog("MLB1");

    expect(result).toEqual({
      mlListingId: "MLB1",
      matched: false,
      warnings: ["Anúncio avulso: sem produto do Meu Drop vinculado para comparar"],
    });
  });

  it("lets the catalog win on conflicting attribute ids while preserving ML-only ones", async () => {
    mlListingFindUnique.mockResolvedValue(listing());
    productFindFirst.mockResolvedValue(product());

    const result = await reviewListingAgainstCatalog("MLB1");

    const byId = Object.fromEntries(result.attributes!.suggested.map((a) => [a.id, a.value_name]));
    expect(byId.COLOR).toBe("Preto"); // catálogo vence
    expect(byId.CUSTOM_TAG).toBe("Promoção"); // preservado, o catálogo não tem opinião sobre isso
    expect(result.attributes!.changed).toBe(true);
  });

  it("overlays SELLER_SKU from the Meu Drop product, overriding whatever is on ML", async () => {
    mlListingFindUnique.mockResolvedValue(
      listing({
        attributesJson: JSON.stringify([{ id: "SELLER_SKU", value_name: "OLD-SKU" }]),
      })
    );
    productFindFirst.mockResolvedValue(product({ sku: "NOVO-SKU-123" }));

    const result = await reviewListingAgainstCatalog("MLB1");

    const sku = result.attributes!.suggested.find((a) => a.id === "SELLER_SKU");
    expect(sku?.value_name).toBe("NOVO-SKU-123");
  });

  it("extracts GTIN from the description when the catalog has no structured GTIN attribute", async () => {
    mlListingFindUnique.mockResolvedValue(listing());
    productFindFirst.mockResolvedValue(
      product({ description: "Produto original. EAN: 7891234567890" })
    );

    const result = await reviewListingAgainstCatalog("MLB1");

    const gtin = result.attributes!.suggested.find((a) => a.id === "GTIN");
    expect(gtin?.value_name).toBe("7891234567890");
  });

  it("keeps the title untouched when it already matches the catalog title", async () => {
    mlListingFindUnique.mockResolvedValue(listing({ title: "Bola de Vôlei Azul" }));
    productFindFirst.mockResolvedValue(product({ title: "Bola de Vôlei Azul" }));

    const result = await reviewListingAgainstCatalog("MLB1");

    expect(result.title).toEqual({
      current: "Bola de Vôlei Azul",
      suggested: "Bola de Vôlei Azul",
      changed: false,
    });
    expect(ollamaChatMock).toHaveBeenCalledTimes(1); // só o gap-fill de atributos, título não precisou de IA
  });

  it("regenerates an over-60-char catalog title via AI and flags it as changed", async () => {
    const longTitle =
      "Bola de Vôlei Oficial Profissional Tamanho Padrão Costurada à Mão Alta Durabilidade Premium";
    mlListingFindUnique.mockResolvedValue(listing({ title: "Titulo Antigo Generico" }));
    productFindFirst.mockResolvedValue(product({ title: longTitle }));
    ollamaChatMock
      .mockResolvedValueOnce({ message: { content: "Bola de Vôlei Oficial Profissional Costurada" } })
      .mockResolvedValueOnce({ message: { content: '{"attributes":[]}' } });

    const result = await reviewListingAgainstCatalog("MLB1");

    expect(result.title?.changed).toBe(true);
    expect(result.title?.suggested.length).toBeLessThanOrEqual(60);
  });

  it("computes a category comparison only when includeCategory is requested", async () => {
    mlListingFindUnique.mockResolvedValue(listing());
    productFindFirst.mockResolvedValue(product());

    const withoutCategory = await reviewListingAgainstCatalog("MLB1");
    expect(withoutCategory.category).toBeUndefined();
  });
});

describe("applyListingReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppSettingsMock.mockResolvedValue({ ollamaBaseUrl: "http://localhost:11434", ollamaModel: "test" });
    ollamaChatMock.mockResolvedValue({ message: { content: '{"attributes":[]}' } });
    mlListingUpdate.mockResolvedValue({});
  });

  it("PUTs only the changed fields and updates the local MlListing snapshot", async () => {
    mlListingFindUnique.mockResolvedValue(listing());
    productFindFirst.mockResolvedValue(product());
    updateItemMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "{}" });

    const result = await applyListingReview("MLB1");

    expect(result.applied).toBe(true);
    expect(updateItemMock).toHaveBeenCalledWith(
      "MLB1",
      expect.objectContaining({
        title: undefined, // título já batia, não deveria ir no payload
        attributes: expect.any(Array),
      }),
      undefined
    );
    expect(mlListingUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not call the ML API when nothing changed", async () => {
    mlListingFindUnique.mockResolvedValue(
      listing({ attributesJson: JSON.stringify([{ id: "COLOR", name: "Cor", value_name: "Preto" }]) })
    );
    productFindFirst.mockResolvedValue(product({ attributesJson: JSON.stringify([{ name: "Cor", value: "Preto" }]) }));

    const result = await applyListingReview("MLB1");

    expect(result.applied).toBe(false);
    expect(updateItemMock).not.toHaveBeenCalled();
  });

  it("reports failure without throwing when the ML PUT is rejected", async () => {
    mlListingFindUnique.mockResolvedValue(listing());
    productFindFirst.mockResolvedValue(product());
    updateItemMock.mockResolvedValue({ ok: false, status: 400, data: {}, raw: "bad request" });

    const result = await applyListingReview("MLB1");

    expect(result.applied).toBe(false);
    expect(result.warnings.some((w) => w.includes("HTTP 400"))).toBe(true);
    expect(mlListingUpdate).not.toHaveBeenCalled();
  });

  it("does not report the title as changed when ML silently keeps the old one (HTTP 200, catalog-controlled item)", async () => {
    // Reproduz um caso real: item vinculado ao catálogo oficial do ML, onde o
    // título é controlado por lá — a API aceita o PUT (200) mas devolve o
    // título antigo no corpo, sem erro nenhum.
    mlListingFindUnique.mockResolvedValue(listing({ title: "titulo antigo generico" }));
    productFindFirst.mockResolvedValue(product({ title: "Bola de Vôlei Azul Nova" }));
    updateItemMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "{}",
      data: { title: "titulo antigo generico", attributes: [] }, // ML ignorou o título pedido
    });

    const result = await applyListingReview("MLB1");

    expect(result.titleApplied).toBe(false);
    expect(result.attributesApplied).toBe(true); // atributos continuam sendo aplicados normalmente
    expect(result.applied).toBe(true); // ainda é um sucesso parcial, não uma falha total
    expect(result.warnings.some((w) => w.includes("Título não foi alterado"))).toBe(true);

    const [{ data }] = mlListingUpdate.mock.calls[0];
    expect(data.title).toBe("titulo antigo generico"); // mantém o snapshot local fiel ao que está realmente no ML
  });

  it("marks the title as applied when the ML response confirms it", async () => {
    mlListingFindUnique.mockResolvedValue(listing({ title: "titulo antigo generico" }));
    productFindFirst.mockResolvedValue(product({ title: "Bola de Vôlei Azul Nova" }));
    updateItemMock.mockResolvedValue({
      ok: true,
      status: 200,
      raw: "{}",
      data: { title: "Bola de Vôlei Azul Nova", attributes: [] },
    });

    const result = await applyListingReview("MLB1");

    expect(result.titleApplied).toBe(true);
    const [{ data }] = mlListingUpdate.mock.calls[0];
    expect(data.title).toBe("Bola de Vôlei Azul Nova");
  });
});

describe("applyBulkReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppSettingsMock.mockResolvedValue({ ollamaBaseUrl: "http://localhost:11434", ollamaModel: "test" });
    ollamaChatMock.mockResolvedValue({ message: { content: '{"attributes":[]}' } });
    mlListingUpdate.mockResolvedValue({});
    updateItemMock.mockResolvedValue({ ok: true, status: 200, data: {}, raw: "{}" });
  });

  it("counts avulso listings as skipped, applies matched ones, and isolates per-item failures", async () => {
    mlListingFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "MLB_AVULSO") return listing({ id: "MLB_AVULSO" });
      if (where.id === "MLB_BOOM") return listing({ id: "MLB_BOOM" });
      return listing({ id: where.id });
    });
    productFindFirst.mockImplementation(async ({ where }: { where: { mlItemId: string } }) => {
      if (where.mlItemId === "MLB_AVULSO") return null;
      if (where.mlItemId === "MLB_BOOM") throw new Error("boom");
      return product();
    });

    const result = await applyBulkReview(["MLB_AVULSO", "MLB_OK", "MLB_BOOM"], { delayMs: 0 });

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("MLB_BOOM");
    expect(result.details).toEqual([
      { id: "MLB_OK", titleChanged: false, attributesChanged: true },
    ]);
  });
});
