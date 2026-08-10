import { describe, expect, it } from "vitest";
import {
  applyDraftRepairPatch,
  isDraftRepairPatch,
} from "@/lib/publish/ai-repair";
import type { ListingDraftLike } from "@/lib/ml/payload";

const baseDraft = (): ListingDraftLike => ({
  title: "Titulo muito longo que precisa ser cortado pela IA porque passa de sessenta",
  description: "desc",
  price: 50,
  condition: "new",
  buyingMode: "buy_it_now",
  listingTypeId: "gold_pro",
  categoryId: "MLB123",
  shippingMode: "me2",
  shippingJson: "{}",
  pictures: '["https://example.com/a.jpg"]',
  attributes: JSON.stringify([{ name: "Cor", value_name: "Azul" }]),
  variations: "[]",
  regulatory: "{}",
  warrantyType: "Garantia de fábrica",
  warrantyTime: "90 dias",
  availableQuantity: 1,
  currencyId: "BRL",
});

describe("applyDraftRepairPatch", () => {
  it("merges attributes by id/name and truncates title to 60", () => {
    const draft = baseDraft();
    const next = applyDraftRepairPatch(draft, {
      title: "A".repeat(80),
      attributes: [
        { id: "BRAND", name: "Marca", value_name: "Acme" },
        { name: "Cor", value_name: "Vermelho" },
      ],
    });

    expect(next.title).toHaveLength(60);
    const attrs = JSON.parse(next.attributes) as Array<{
      id?: string;
      name: string;
      value_name: string;
    }>;
    expect(attrs.find((a) => a.id === "BRAND" || a.name === "Marca")?.value_name).toBe("Acme");
    expect(attrs.find((a) => a.name === "Cor")?.value_name).toBe("Vermelho");
  });

  it("updates categoryId and catalogProductId", () => {
    const next = applyDraftRepairPatch(baseDraft(), {
      categoryId: "MLB999",
      catalogProductId: "CAT-1",
    });
    expect(next.categoryId).toBe("MLB999");
    expect(next.catalogProductId).toBe("CAT-1");
  });
});

describe("isDraftRepairPatch", () => {
  it("accepts valid patch shapes", () => {
    expect(isDraftRepairPatch({ title: "ok" })).toBe(true);
    expect(
      isDraftRepairPatch({
        attributes: [{ name: "Marca", value_name: "X" }],
      })
    ).toBe(true);
  });

  it("rejects empty or unknown keys", () => {
    expect(isDraftRepairPatch({})).toBe(false);
    expect(isDraftRepairPatch({ foo: 1 })).toBe(false);
    expect(isDraftRepairPatch({ attributes: [{ name: "" }] })).toBe(false);
  });
});
