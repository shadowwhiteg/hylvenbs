import { describe, expect, it } from "vitest";
import {
  emptyCatalogActionMessage,
  formatCatalogActionResult,
  planCatalogAction,
  type CatalogActionListing,
} from "@/lib/ml-listings/catalog-actions";

const listings: CatalogActionListing[] = [
  {
    id: "MLB1",
    title: "Sem categoria no rascunho",
    product: { id: "p1", hasDraft: true, draftCategoryId: null, draftCatalogProductId: null },
  },
  {
    id: "MLB2",
    title: "Já categorizado",
    product: { id: "p2", hasDraft: true, draftCategoryId: "MLB1234", draftCatalogProductId: null },
  },
  {
    id: "MLB3",
    title: "Já no catálogo ML",
    product: { id: "p3", hasDraft: true, draftCategoryId: null, draftCatalogProductId: "MLB99" },
  },
  { id: "MLB4", title: "Avulso", product: null },
];

describe("planCatalogAction", () => {
  it("roda características com IA em todos os vinculados", () => {
    const plan = planCatalogAction(listings, "ai-attributes");
    expect(plan.targets.map((t) => t.productId)).toEqual(["p1", "p2", "p3"]);
    expect(plan.skippedUnlinked).toBe(1);
    expect(plan.skippedAlreadyDone).toBe(0);
  });

  it("categoriza só quem ainda não tem categoryId no rascunho", () => {
    const plan = planCatalogAction(listings, "categorize");
    expect(plan.targets.map((t) => t.productId)).toEqual(["p1", "p3"]);
    expect(plan.skippedAlreadyDone).toBe(1);
    expect(plan.skippedUnlinked).toBe(1);
  });

  it("busca no catálogo ML só quem ainda não está vinculado", () => {
    const plan = planCatalogAction(listings, "catalog-match");
    expect(plan.targets.map((t) => t.productId)).toEqual(["p1", "p2"]);
    expect(plan.skippedAlreadyDone).toBe(1);
  });

  it("trata anúncio de catálogo do ML como já vinculado", () => {
    const plan = planCatalogAction(
      [
        {
          id: "MLB5",
          title: "Anúncio de catálogo",
          catalogListing: true,
          product: { id: "p5", hasDraft: true, draftCatalogProductId: null },
        },
      ],
      "catalog-match"
    );
    expect(plan.targets).toEqual([]);
    expect(plan.skippedAlreadyDone).toBe(1);
  });

  it("pula produto vinculado que não tem rascunho (as rotas exigem draft)", () => {
    const plan = planCatalogAction(
      [{ id: "MLB6", title: "Sem rascunho", product: { id: "p6", hasDraft: false } }],
      "ai-attributes"
    );
    expect(plan.targets).toEqual([]);
    expect(plan.skippedUnlinked).toBe(1);
  });

  it("categoryId em branco não conta como preenchido", () => {
    const plan = planCatalogAction(
      [{ id: "MLB7", title: "Vazio", product: { id: "p7", hasDraft: true, draftCategoryId: "  " } }],
      "categorize"
    );
    expect(plan.targets.map((t) => t.productId)).toEqual(["p7"]);
  });
});

describe("mensagens", () => {
  it("explica 'nada a fazer' pelo motivo dominante", () => {
    expect(
      emptyCatalogActionMessage("categorize", {
        targets: [],
        skippedUnlinked: 0,
        skippedAlreadyDone: 3,
      })
    ).toContain("já têm categoryId");

    expect(
      emptyCatalogActionMessage("catalog-match", {
        targets: [],
        skippedUnlinked: 2,
        skippedAlreadyDone: 0,
      })
    ).toContain("sem produto do Meu Drop vinculado");
  });

  it("resume o resultado com os pulados", () => {
    const msg = formatCatalogActionResult({
      kind: "categorize",
      ok: 2,
      total: 3,
      plan: { targets: [], skippedUnlinked: 1, skippedAlreadyDone: 4 },
    });
    expect(msg).toContain("2/3 concluído(s)");
    expect(msg).toContain("4 já tinha(m) categoryId");
    expect(msg).toContain("1 sem produto vinculado");
  });
});
