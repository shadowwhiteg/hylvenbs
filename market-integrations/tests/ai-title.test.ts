import { describe, expect, it } from "vitest";
import {
  fallbackMlTitle,
  isValidMlTitle,
  mlTitleNeedsAi,
  parseMlTitleResponse,
} from "@/lib/agent/title";

describe("ml title helpers", () => {
  it("detecta títulos que precisam de IA", () => {
    expect(mlTitleNeedsAi("Curto")).toBe(false);
    expect(mlTitleNeedsAi("a".repeat(60))).toBe(false);
    expect(mlTitleNeedsAi("a".repeat(61))).toBe(true);
  });

  it("valida título ML", () => {
    expect(isValidMlTitle("")).toBe(false);
    expect(isValidMlTitle("a".repeat(61))).toBe(false);
    expect(isValidMlTitle("Liquidificador Britânia 2,7L")).toBe(true);
  });

  it("faz fallback cortando em palavra", () => {
    const long =
      "Liquidificador BLQ1280P Com 4 Lâminas Inox 2,7L 1150W Cor Preto Britânia Premium";
    const result = fallbackMlTitle(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toMatch(/\s$/);
  });

  it("limpa resposta da IA", () => {
    expect(parseMlTitleResponse('```\nLiquidificador Britânia 2,7L\n```')).toBe(
      "Liquidificador Britânia 2,7L"
    );
    expect(parseMlTitleResponse('"Escova Mondial ES-01 Bivolt"')).toBe(
      "Escova Mondial ES-01 Bivolt"
    );
  });
});
