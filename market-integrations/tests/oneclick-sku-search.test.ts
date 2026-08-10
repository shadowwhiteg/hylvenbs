import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTitleSearchQuery, searchProductBySku } from "@/lib/oneclick/client";
import type { WmdPublishConfig } from "@/lib/oneclick/session";
import type { ScrapeSession } from "@/lib/scrape/session";

const wmd = { ajaxurl: "https://drop.test/admin-ajax.php" } as WmdPublishConfig;
const session = { jar: { header: () => "cookie=1" } } as unknown as ScrapeSession;

/** Mock do picker: mapa de query -> resultados devolvidos pelo Meu Drop. */
function mockPicker(byQuery: Record<string, { id: number; text: string }[]>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("q") || "");
    calls.push(q);
    return { ok: true, json: async () => byQuery[q] ?? [] } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("buildTitleSearchQuery", () => {
  it("keeps the first words and drops punctuation", () => {
    expect(
      buildTitleSearchQuery("CINTO DE USO PESSOAL, CONFECCIONADO EM MATERIAL T+EXTIL ELASTICO")
    ).toBe("CINTO DE USO PESSOAL CONFECCIONADO EM");
  });

  it("preserves accents and shorter titles", () => {
    expect(buildTitleSearchQuery("Cinto Casual Premium Praticidade e Estilo")).toBe(
      "Cinto Casual Premium Praticidade e Estilo"
    );
    expect(buildTitleSearchQuery("Suspensório Masculino")).toBe("Suspensório Masculino");
  });

  it("is empty for titles without usable words", () => {
    expect(buildTitleSearchQuery("")).toBe("");
    expect(buildTitleSearchQuery("--- ///")).toBe("");
  });
});

describe("searchProductBySku title fallback", () => {
  it("uses the SKU hit and never queries the title", async () => {
    const calls = mockPicker({ "1002": [{ id: 152684, text: "#152684 — Cinto (SKU: 1002)" }] });

    const found = await searchProductBySku(session, wmd, "1002", "Cinto Casual Fibra Sintetica");

    expect(found?.id).toBe(152684);
    expect(calls).toEqual(["1002"]);
  });

  it("falls back to the title when the code search returns an unrelated product", async () => {
    // Reproduz o caso real: q=1001 devolve a Escova Mondial, que contém "1001" na descrição.
    const calls = mockPicker({
      "1001": [{ id: 37662, text: "#37662 — Escova Mondial Es-01 (SKU: es01mondial)" }],
      "Cinto Casual Premium Praticidade e Estilo": [
        { id: 165268, text: "#165268 — Cinto Casual Premium Praticidade e Estilo (SKU: 1001)" },
      ],
    });

    const found = await searchProductBySku(
      session,
      wmd,
      "1001",
      "Cinto Casual Premium Praticidade e Estilo"
    );

    expect(found?.id).toBe(165268);
    expect(calls).toHaveLength(2);
  });

  it("still requires the exact SKU on the fallback results", async () => {
    const calls = mockPicker({
      "1001": [],
      "Cinto Casual Premium Praticidade e Estilo": [
        { id: 999, text: "#999 — Outro cinto parecido (SKU: 1042)" },
      ],
    });

    const found = await searchProductBySku(
      session,
      wmd,
      "1001",
      "Cinto Casual Premium Praticidade e Estilo"
    );

    expect(found).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("skips the fallback without a title", async () => {
    const calls = mockPicker({ "1001": [] });

    expect(await searchProductBySku(session, wmd, "1001")).toBeNull();
    expect(await searchProductBySku(session, wmd, "1001", "")).toBeNull();
    expect(calls).toEqual(["1001", "1001"]);
  });

  it("skips the fallback when the title only repeats the SKU", async () => {
    const calls = mockPicker({ "1001": [] });

    expect(await searchProductBySku(session, wmd, "1001", "1001")).toBeNull();
    expect(calls).toEqual(["1001"]);
  });

  it("propagates picker HTTP failures instead of reporting 'not found'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 }) as Response));

    await expect(searchProductBySku(session, wmd, "1001", "Cinto Casual")).rejects.toThrow(/503/);
  });
});
