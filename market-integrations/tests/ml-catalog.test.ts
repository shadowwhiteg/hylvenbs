import { beforeEach, describe, expect, it, vi } from "vitest";

const { getValidAccessTokenMock } = vi.hoisted(() => ({
  getValidAccessTokenMock: vi.fn(),
}));

vi.mock("@/lib/ml/auth", () => ({
  getValidAccessToken: getValidAccessTokenMock,
}));

import { findCatalogMatch, scoreCatalogCandidate } from "@/lib/ml/catalog";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("scoreCatalogCandidate", () => {
  it("dá score alto para título praticamente igual", () => {
    const score = scoreCatalogCandidate(
      "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      "JBL Tune 510BT Fone de Ouvido Bluetooth - Preto"
    );
    expect(score).toBeGreaterThan(0.85);
  });

  it("dá score baixo para produto diferente", () => {
    const score = scoreCatalogCandidate(
      "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      "Cafeteira Elétrica Mondial 30 Xícaras Inox"
    );
    expect(score).toBeLessThan(0.3);
  });

  it("bonifica marca e modelo presentes no candidato", () => {
    const withBrand = scoreCatalogCandidate(
      "Fone Bluetooth Tune 510BT",
      "JBL Tune 510BT Fone Bluetooth",
      { brand: "JBL", model: "510BT" }
    );
    const withoutBrand = scoreCatalogCandidate(
      "Fone Bluetooth Tune 510BT",
      "JBL Tune 510BT Fone Bluetooth"
    );
    expect(withBrand).toBeGreaterThanOrEqual(withoutBrand);
  });

  it("EAN igual vence título mais parecido sem EAN", () => {
    const sameGtin = scoreCatalogCandidate(
      "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      "JBL 510BT Wireless Headphone",
      { gtin: "6925281955495", candidateGtin: "6925281955495" }
    );
    const similarTitle = scoreCatalogCandidate(
      "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      "Fone de Ouvido Bluetooth JBL Tune 510BT Preto"
    );
    expect(sameGtin).toBeGreaterThanOrEqual(0.95);
    expect(sameGtin).toBeGreaterThan(similarTitle);
  });

  it("penaliza GTIN conhecido e diferente", () => {
    const score = scoreCatalogCandidate(
      "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      { gtin: "6925281955495", candidateGtin: "1111111111111" }
    );
    expect(score).toBeLessThan(0.6);
  });
});

describe("findCatalogMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getValidAccessTokenMock.mockResolvedValue("token-fake");
  });

  it("ordena sugestões por score e marca confident", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: "MLB111",
            name: "Cafeteira Elétrica Mondial 30 Xícaras",
            domain_id: "MLB-COFFEE_MAKERS",
            permalink: "https://ml.com/MLB111",
          },
          {
            id: "MLB222",
            name: "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
            domain_id: "MLB-HEADPHONES",
            pictures: [{ secure_url: "https://img/222.jpg" }],
            attributes: [{ id: "BRAND", value_name: "JBL" }],
          },
        ],
      })
    );

    const result = await findCatalogMatch({
      title: "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      brand: "JBL",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.suggestions.map((s) => s.catalogProductId)).toEqual([
      "MLB222",
      "MLB111",
    ]);
    expect(result.bestMatch?.catalogProductId).toBe("MLB222");
    expect(result.bestMatch?.pictureUrl).toBe("https://img/222.jpg");
    expect(result.confident).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("prioriza o resultado com GTIN igual", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: "MLB333",
            name: "JBL 510BT Wireless Headphone",
            attributes: [{ id: "GTIN", value_name: "6925281955495" }],
          },
        ],
      })
    );

    const result = await findCatalogMatch({
      title: "Fone de Ouvido Bluetooth JBL Tune 510BT Preto",
      gtin: "6925281955495",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.bestMatch?.catalogProductId).toBe("MLB333");
    expect(result.confident).toBe(true);
    const firstUrl = String(fetchImpl.mock.calls[0][0]);
    expect(firstUrl).toContain("q=6925281955495");
    expect(firstUrl).toContain("site_id=MLB");
    expect(firstUrl).toContain("status=active");
  });

  it("devolve aviso quando não há resultados", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    const result = await findCatalogMatch({
      title: "Produto inexistente xyz",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.suggestions).toEqual([]);
    expect(result.bestMatch).toBeNull();
    expect(result.confident).toBe(false);
    expect(result.warnings.join(" ")).toContain("Nenhum produto");
  });

  it("não lança quando o Mercado Livre não está conectado", async () => {
    getValidAccessTokenMock.mockRejectedValue(new Error("Mercado Livre não conectado"));
    const result = await findCatalogMatch({
      title: "Fone JBL Tune 510BT",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(result.bestMatch).toBeNull();
    expect(result.confident).toBe(false);
    expect(result.warnings.join(" ")).toContain("Mercado Livre não conectado");
  });

  it("tolera resposta em formato de array puro e erro HTTP", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "forbidden" }, false, 403))
      .mockResolvedValue(
        jsonResponse([{ id: "MLB444", title: "Teclado Mecânico Redragon Kumara" }])
      );

    const result = await findCatalogMatch({
      title: "Teclado Mecânico Redragon Kumara",
      gtin: "0000000000000",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.suggestions[0]?.catalogProductId).toBe("MLB444");
    expect(result.warnings.join(" ")).toContain("forbidden");
  });
});
