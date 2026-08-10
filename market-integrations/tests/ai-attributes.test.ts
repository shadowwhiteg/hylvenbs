import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAppSettingsMock } = vi.hoisted(() => ({
  getAppSettingsMock: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: getAppSettingsMock,
}));

import {
  buildAttributePrompt,
  ensureBrandAttribute,
  fillAttributesWithAi,
  mergeAttributes,
  parseAttributeResponse,
} from "@/lib/agent/attributes";

describe("parseAttributeResponse", () => {
  it("lê JSON puro", () => {
    const { attributes, warnings } = parseAttributeResponse(
      '{"attributes":[{"name":"Marca","value_name":"JBL"}]}'
    );
    expect(attributes).toEqual([{ id: "BRAND", name: "Marca", value_name: "JBL" }]);
    expect(warnings).toEqual([]);
  });

  it("lê JSON dentro de fences ```json", () => {
    const content = [
      "Claro! Aqui estão as características:",
      "```json",
      '{"attributes":[{"name":"BRAND","value_name":"Xiaomi"},{"name":"COLOR","value_name":"Preto"}]}',
      "```",
    ].join("\n");
    const { attributes } = parseAttributeResponse(content);
    expect(attributes).toEqual([
      { id: "BRAND", name: "Marca", value_name: "Xiaomi" },
      { id: "COLOR", name: "Cor", value_name: "Preto" },
    ]);
  });

  it("ignora o bloco <think> do qwen", () => {
    const content =
      "<think>O usuário quer atributos. {\"attributes\":[]} seria vazio</think>" +
      '{"attributes":[{"name":"Modelo","value_name":"Redmi Note 13"}]}';
    const { attributes } = parseAttributeResponse(content);
    expect(attributes).toEqual([
      { id: "MODEL", name: "Modelo", value_name: "Redmi Note 13" },
    ]);
  });

  it("tolera texto ao redor e vírgula sobrando", () => {
    const content =
      'Segue o resultado:\n{"attributes":[{"name":"Material","value_name":"Alumínio"},]}\nEspero ter ajudado.';
    const { attributes } = parseAttributeResponse(content);
    expect(attributes).toEqual([
      { id: "MATERIAL", name: "Material", value_name: "Alumínio" },
    ]);
  });

  it("aceita array puro de atributos", () => {
    const { attributes } = parseAttributeResponse(
      '[{"id":"BRAND","name":"brand","value_name":"Mondial"}]'
    );
    expect(attributes).toEqual([{ id: "BRAND", name: "Marca", value_name: "Mondial" }]);
  });

  it("deduplica por nome normalizado e descarta valores vazios", () => {
    const { attributes, warnings } = parseAttributeResponse(
      JSON.stringify({
        attributes: [
          { name: "Marca", value_name: "JBL" },
          { name: "BRAND", value_name: "JBL Brasil" },
          { name: "Cor", value_name: "N/A" },
          { name: "Modelo", value_name: "  " },
          { name: "Voltagem", value_name: "não informado" },
        ],
      })
    );
    expect(attributes).toEqual([{ id: "BRAND", name: "Marca", value_name: "JBL" }]);
    expect(warnings.join(" ")).toContain("descartada");
  });

  it("avisa quando não há JSON interpretável", () => {
    const { attributes, warnings } = parseAttributeResponse("desculpe, não sei responder");
    expect(attributes).toEqual([]);
    expect(warnings.join(" ")).toContain("interpretar");
  });

  it("normaliza 'Unidades por kit' para o número puro, mesmo com texto junto", () => {
    const { attributes } = parseAttributeResponse(
      JSON.stringify({
        attributes: [
          { name: "Formato de venda", value_name: "Kit" },
          { name: "Unidades por kit", value_name: "12 unidades" },
        ],
      })
    );
    expect(attributes).toEqual([
      { id: "SALE_FORMAT", name: "Formato de venda", value_name: "Kit" },
      { id: "UNITS_PER_PACK", name: "Unidades por kit", value_name: "12" },
    ]);
  });
});

describe("mergeAttributes", () => {
  it("mantém os existentes e adiciona os que faltam", () => {
    const merged = mergeAttributes(
      [{ id: "BRAND", name: "Marca", value_name: "JBL" }],
      [
        { id: "BRAND", name: "Marca", value_name: "Outra" },
        { id: "COLOR", name: "Cor", value_name: "Preto" },
      ]
    );
    expect(merged).toEqual([
      { id: "BRAND", name: "Marca", value_name: "JBL" },
      { id: "COLOR", name: "Cor", value_name: "Preto" },
    ]);
  });

  it("completa valor vazio do existente e herda o id do ML", () => {
    const merged = mergeAttributes(
      [{ name: "marca", value_name: "" }],
      [{ id: "BRAND", name: "Marca", value_name: "Mondial" }]
    );
    expect(merged).toEqual([{ id: "BRAND", name: "marca", value_name: "Mondial" }]);
  });

  it("não duplica atributo com grafia diferente", () => {
    const merged = mergeAttributes(
      [{ name: "Cor", value_name: "Preto" }],
      [{ name: "COLOR", value_name: "Branco" }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].value_name).toBe("Preto");
  });
});

describe("ensureBrandAttribute", () => {
  it("adiciona BRAND=Genérica quando nenhuma marca foi identificada", () => {
    const result = ensureBrandAttribute([{ id: "COLOR", name: "Cor", value_name: "Preto" }]);
    expect(result).toEqual([
      { id: "COLOR", name: "Cor", value_name: "Preto" },
      { id: "BRAND", name: "Marca", value_name: "Genérica" },
    ]);
  });

  it("não mexe quando BRAND já tem valor", () => {
    const input = [{ id: "BRAND", name: "Marca", value_name: "JBL" }];
    expect(ensureBrandAttribute(input)).toEqual(input);
  });

  it("substitui BRAND vazio pelo fallback sem duplicar o id", () => {
    const result = ensureBrandAttribute([{ id: "BRAND", name: "Marca", value_name: "" }]);
    expect(result).toEqual([{ id: "BRAND", name: "Marca", value_name: "Genérica" }]);
  });
});

describe("buildAttributePrompt", () => {
  it("inclui título, categoria e características coletadas", () => {
    const [system, user] = buildAttributePrompt({
      title: "Fone JBL Tune 510BT",
      description: "Fone bluetooth da JBL",
      scrapedAttributes: [{ name: "Marca", value: "JBL" }],
      categoryPath: "Áudio > Fones",
    });
    expect(system.role).toBe("system");
    expect(system.content).toContain("attributes");
    expect(user.content).toContain("Fone JBL Tune 510BT");
    expect(user.content).toContain("Áudio > Fones");
    expect(user.content).toContain("- Marca: JBL");
  });
});

describe("fillAttributesWithAi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppSettingsMock.mockResolvedValue({
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3.5:4b",
    });
  });

  it("devolve atributos vindos do Ollama", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          role: "assistant",
          content: '{"attributes":[{"name":"Marca","value_name":"JBL"}]}',
        },
      }),
    });

    const result = await fillAttributesWithAi(
      {
        title: "Fone JBL",
        description: "Fone bluetooth",
        scrapedAttributes: [],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.attributes).toEqual([
      { id: "BRAND", name: "Marca", value_name: "JBL" },
    ]);
    expect(result.model).toBe("qwen3.5:4b");
    expect(result.warnings).toEqual([]);
  });

  it("não lança quando o Ollama está indisponível", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await fillAttributesWithAi(
      { title: "Fone JBL", description: "", scrapedAttributes: [] },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(result.attributes).toEqual([]);
    expect(result.warnings.join(" ")).toContain("Ollama");
  });
});
