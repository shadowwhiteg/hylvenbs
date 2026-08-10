import { describe, expect, it } from "vitest";

import {
  buildKitSuggestionPrompt,
  fallbackSuggestions,
  parseKitSuggestionResponse,
  type SuggestionCandidate,
} from "@/lib/agent/kit-suggestions";

const candidates: SuggestionCandidate[] = [
  { id: "MLB1", title: "Bola de Vôlei Oficial", price: 20, categoryId: "MLB1334" },
  { id: "MLB2", title: "Bomba de Ar Manual", price: 10, categoryId: "MLB1334" },
  { id: "MLB3", title: "Rede de Vôlei", price: 70, categoryId: "MLB1334" },
  { id: "MLB4", title: "Caneta Fine Line 12 Cores", price: 15, categoryId: "MLB44014" },
];

describe("parseKitSuggestionResponse", () => {
  it("maps 1-based indexes back to listing ids and computes the discounted price", () => {
    const raw = JSON.stringify({
      kits: [{ titulo: "Kit Vôlei Completo", itens: [1, 2], motivo: "complementares", desconto: 10 }],
    });

    const { suggestions } = parseKitSuggestionResponse(raw, candidates);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].items.map((i) => i.id)).toEqual(["MLB1", "MLB2"]);
    expect(suggestions[0].grossPrice).toBe(30);
    expect(suggestions[0].price).toBe(27);
    expect(suggestions[0].source).toBe("ai");
  });

  it("tolerates markdown fences, reasoning blocks and stringified indexes", () => {
    const raw =
      '<think>vou agrupar</think>\n```json\n{"kits":[{"titulo":"Kit Vôlei","itens":["1","2"],"desconto":"15"}]}\n```';

    const { suggestions } = parseKitSuggestionResponse(raw, candidates);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].items.map((i) => i.id)).toEqual(["MLB1", "MLB2"]);
    expect(suggestions[0].discountPercent).toBe(15);
  });

  it("drops kits with fewer than 2 valid items and reports it", () => {
    const raw = JSON.stringify({
      kits: [
        { titulo: "Kit Inválido", itens: [99], desconto: 10 },
        { titulo: "Kit Bom", itens: [1, 3], desconto: 10 },
      ],
    });

    const { suggestions, warnings } = parseKitSuggestionResponse(raw, candidates);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].items.map((i) => i.id)).toEqual(["MLB1", "MLB3"]);
    expect(warnings.join(" ")).toContain("descartada");
  });

  it("never repeats the same listing across two kits", () => {
    const raw = JSON.stringify({
      kits: [
        { titulo: "Kit A", itens: [1, 2], desconto: 10 },
        { titulo: "Kit B", itens: [1, 3], desconto: 10 },
      ],
    });

    const { suggestions } = parseKitSuggestionResponse(raw, candidates);

    // Kit B fica só com MLB3 (MLB1 já usado) e é descartado por ter 1 item.
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].items.map((i) => i.id)).toEqual(["MLB1", "MLB2"]);
  });

  it("caps a kit at 4 items", () => {
    const many: SuggestionCandidate[] = Array.from({ length: 8 }, (_, i) => ({
      id: `MLB${i + 1}`,
      title: `Produto ${i + 1}`,
      price: 10,
      categoryId: "MLB1",
    }));
    const raw = JSON.stringify({
      kits: [{ titulo: "Kit Grande", itens: [1, 2, 3, 4, 5, 6, 7, 8], desconto: 10 }],
    });

    const { suggestions } = parseKitSuggestionResponse(raw, many);

    expect(suggestions[0].items).toHaveLength(4);
  });

  it("clamps an out-of-range discount instead of rejecting the kit", () => {
    const raw = JSON.stringify({ kits: [{ titulo: "Kit", itens: [1, 2], desconto: 900 }] });

    const { suggestions } = parseKitSuggestionResponse(raw, candidates);

    expect(suggestions[0].discountPercent).toBe(50);
  });

  it("returns no suggestions when the payload is not JSON", () => {
    const { suggestions, warnings } = parseKitSuggestionResponse("desculpe, não consegui", candidates);

    expect(suggestions).toHaveLength(0);
    expect(warnings.join(" ")).toContain("JSON");
  });

  it("uses the AI-written description when present", () => {
    const raw = JSON.stringify({
      kits: [
        {
          titulo: "Kit Vôlei Completo",
          descricao: "Tudo pra jogar hoje mesmo: bola oficial, bomba e rede.",
          itens: [1, 2],
          desconto: 10,
        },
      ],
    });

    const { suggestions } = parseKitSuggestionResponse(raw, candidates);

    expect(suggestions[0].description).toBe(
      "Tudo pra jogar hoje mesmo: bola oficial, bomba e rede."
    );
  });

  it("falls back to a templated description when the AI omits it", () => {
    const raw = JSON.stringify({
      kits: [{ titulo: "Kit Vôlei", itens: [1, 2], desconto: 10 }],
    });

    const { suggestions } = parseKitSuggestionResponse(raw, candidates);

    expect(suggestions[0].description).toContain("Bola de Vôlei Oficial");
    expect(suggestions[0].description).toContain("Bomba de Ar Manual");
  });
});

describe("buildKitSuggestionPrompt", () => {
  it("includes the supplier's source description as context for the AI", () => {
    const withDescription: SuggestionCandidate[] = [
      { ...candidates[0], sourceDescription: "Bola oficial de vôlei, costurada à mão." },
      candidates[1],
    ];

    const [system, user] = buildKitSuggestionPrompt(withDescription, 3);

    expect(String(user.content)).toContain("Bola oficial de vôlei, costurada à mão.");
    expect(String(system.content)).toContain("descricao");
  });
});

describe("fallbackSuggestions", () => {
  it("groups by ML category when the AI is unavailable", () => {
    const suggestions = fallbackSuggestions(candidates, 5);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].source).toBe("fallback");
    expect(suggestions[0].items.map((i) => i.id)).toEqual(["MLB1", "MLB2", "MLB3"]);
  });

  it("ignores categories with a single listing", () => {
    const suggestions = fallbackSuggestions([candidates[0], candidates[3]], 5);
    expect(suggestions).toHaveLength(0);
  });
});
