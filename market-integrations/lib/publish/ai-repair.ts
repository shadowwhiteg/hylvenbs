import { chatWithAiUsingSettings } from "@/lib/agent/chat";
import { readLlmJson } from "@/lib/agent/json";
import type { GtinPolicy } from "@/lib/ml/category-attributes";
import type { ListingDraftLike } from "@/lib/ml/payload";
import { getAppSettings } from "@/lib/settings";

export type DraftRepairAttribute = {
  id?: string;
  name: string;
  value_name?: string;
  value?: string;
};

export type DraftRepairPatch = {
  title?: string;
  description?: string;
  categoryId?: string;
  attributes?: DraftRepairAttribute[];
  catalogProductId?: string | null;
  price?: number;
};

export type AiRepairInput = {
  draft: ListingDraftLike;
  errorMessage: string;
  productTitle?: string;
  scrapedAttributesJson?: string;
  gtinPolicy?: GtinPolicy;
};

export type AiRepairResult = {
  ok: boolean;
  draft?: ListingDraftLike;
  patch?: DraftRepairPatch;
  note?: string;
};

export type AiRepairDeps = {
  chatFn?: typeof chatWithAiUsingSettings;
};

function parseAttributes(raw: string): DraftRepairAttribute[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is Record<string, unknown> => a && typeof a === "object")
      .map((a) => ({
        id: typeof a.id === "string" ? a.id : undefined,
        name: String(a.name || a.id || ""),
        value_name:
          typeof a.value_name === "string"
            ? a.value_name
            : typeof a.value === "string"
              ? a.value
              : undefined,
        value: typeof a.value === "string" ? a.value : undefined,
      }))
      .filter((a) => a.name.trim());
  } catch {
    return [];
  }
}

function attrKey(a: DraftRepairAttribute): string {
  return (a.id || a.name || "").trim().toUpperCase();
}

function normalizeAttr(a: DraftRepairAttribute): { id?: string; name: string; value_name: string } {
  const value = (a.value_name ?? a.value ?? "").trim();
  return {
    ...(a.id ? { id: a.id } : {}),
    name: a.name.trim(),
    value_name: value,
  };
}

export function isDraftRepairPatch(parsed: unknown): parsed is DraftRepairPatch {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const p = parsed as Record<string, unknown>;
  const keys = Object.keys(p);
  if (!keys.length) return false;
  const allowed = new Set([
    "title",
    "description",
    "categoryId",
    "attributes",
    "catalogProductId",
    "price",
  ]);
  if (!keys.every((k) => allowed.has(k))) return false;
  if (p.title !== undefined && typeof p.title !== "string") return false;
  if (p.description !== undefined && typeof p.description !== "string") return false;
  if (p.categoryId !== undefined && typeof p.categoryId !== "string") return false;
  if (p.catalogProductId !== undefined && p.catalogProductId !== null && typeof p.catalogProductId !== "string") {
    return false;
  }
  if (p.price !== undefined && typeof p.price !== "number") return false;
  if (p.attributes !== undefined) {
    if (!Array.isArray(p.attributes)) return false;
    for (const a of p.attributes) {
      if (!a || typeof a !== "object") return false;
      const attr = a as Record<string, unknown>;
      if (typeof attr.name !== "string" || !attr.name.trim()) return false;
    }
  }
  return true;
}

/** Mescla o patch no draft (apenas campos permitidos). */
export function applyDraftRepairPatch(
  draft: ListingDraftLike,
  patch: DraftRepairPatch
): ListingDraftLike {
  const next: ListingDraftLike = { ...draft };

  if (typeof patch.title === "string" && patch.title.trim()) {
    next.title = patch.title.trim().slice(0, 60);
  }
  if (typeof patch.description === "string") {
    next.description = patch.description;
  }
  if (typeof patch.categoryId === "string" && patch.categoryId.trim()) {
    next.categoryId = patch.categoryId.trim();
  }
  if (patch.catalogProductId !== undefined) {
    next.catalogProductId = patch.catalogProductId;
  }
  if (typeof patch.price === "number" && patch.price > 0) {
    next.price = patch.price;
  }

  if (patch.attributes?.length) {
    const current = parseAttributes(draft.attributes);
    const byKey = new Map<string, ReturnType<typeof normalizeAttr>>();
    for (const a of current) {
      const n = normalizeAttr(a);
      if (!n.value_name) continue;
      byKey.set(attrKey(a), n);
    }
    for (const a of patch.attributes) {
      const n = normalizeAttr(a);
      if (!n.name || !n.value_name) continue;
      byKey.set(attrKey(a), n);
    }
    next.attributes = JSON.stringify([...byKey.values()]);
  }

  return next;
}

function buildRepairPrompt(input: AiRepairInput): string {
  const gtinHint = input.gtinPolicy
    ? `Política GTIN da categoria: gtinConditionallyRequired=${input.gtinPolicy.gtinConditionallyRequired}, allowsEmptyGtinReason=${input.gtinPolicy.allowsEmptyGtinReason}`
    : "Política GTIN: desconhecida";

  return `Você corrige rascunhos de anúncio do Mercado Livre Brasil para republicação.

Erro recebido (validação local ou API ML):
${input.errorMessage}

${gtinHint}

Título original do produto (fornecedor): ${input.productTitle || "(não informado)"}
Atributos scrape (JSON): ${input.scrapedAttributesJson || "[]"}

Draft atual (JSON):
${JSON.stringify(
  {
    title: input.draft.title,
    description: input.draft.description?.slice(0, 800),
    price: input.draft.price,
    categoryId: input.draft.categoryId,
    catalogProductId: input.draft.catalogProductId ?? null,
    attributes: parseAttributes(input.draft.attributes),
  },
  null,
  2
)}

Responda APENAS com um objeto JSON de patch (sem markdown). Campos opcionais:
- title (string, máx 60 chars)
- description (string)
- categoryId (string MLB…)
- catalogProductId (string ou null)
- price (number > 0)
- attributes (array de { id?, name, value_name })

Corrija só o necessário para resolver o erro. Inclua BRAND/MODEL/GTIN/EMPTY_GTIN_REASON/UNITS_PER_PACK quando o erro pedir. Título ≤ 60 caracteres.`;
}

/**
 * Pede à IA um patch JSON e aplica no draft. Retorna ok:false se a resposta for inválida/vazia.
 */
export async function aiRepairDraft(
  input: AiRepairInput,
  deps: AiRepairDeps = {}
): Promise<AiRepairResult> {
  const chatFn = deps.chatFn ?? chatWithAiUsingSettings;
  try {
    const settings = await getAppSettings();
    const { message } = await chatFn(settings, {
      messages: [
        {
          role: "system",
          content:
            "Você é um corretor de drafts do Mercado Livre. Responda só com JSON de patch válido.",
        },
        { role: "user", content: buildRepairPrompt(input) },
      ],
      think: false,
    });

    const parsed = readLlmJson(message.content || "", isDraftRepairPatch);
    if (!parsed || !isDraftRepairPatch(parsed)) {
      return { ok: false, note: "IA não retornou patch JSON válido" };
    }

    const keys = Object.keys(parsed);
    if (!keys.length) {
      return { ok: false, note: "Patch da IA vazio" };
    }

    const draft = applyDraftRepairPatch(input.draft, parsed);
    return { ok: true, draft, patch: parsed, note: `Patch aplicado: ${keys.join(", ")}` };
  } catch (err) {
    return {
      ok: false,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}
