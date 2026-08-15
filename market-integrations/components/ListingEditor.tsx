"use client";

import { useEffect, useMemo, useState } from "react";
import { BP } from "@/lib/base-path";
import { FieldLabel, HelpTip } from "@/components/HelpTip";
import { LISTING_HELP, CATALOG_FILTER_HELP } from "@/lib/ui/help-texts";
import { getCategoryGtinPolicy } from "@/lib/ml/category-attributes";
import {
  getGtinFormatError,
  normalizeGtinValue,
  readGtinFromAttributesJson,
  upsertGtinInAttributesJson,
} from "@/lib/ml/gtin-draft";

export type DraftForm = {
  title: string;
  description: string;
  price: number;
  condition: string;
  buyingMode: string;
  listingTypeId: string;
  categoryId: string;
  shippingMode: string;
  shippingJson: string;
  freeShipping: boolean;
  localPickUp: boolean;
  pictures: string;
  attributes: string;
  variations: string;
  regulatory: string;
  warrantyType: string;
  warrantyTime: string;
  availableQuantity: number;
  currencyId: string;
  videoUrl: string;
  videoId: string;
  catalogProductId: string;
  marginPercentOverride: number | null;
};

type SimResult = {
  suggestedPrice: number;
  estimatedFee: number;
  estimatedProfit: number;
  breakdown: {
    cost: number;
    fee: number;
    shipping: number;
    margin: number;
    finalPrice: number;
  };
};

type CatalogSuggestion = {
  id: string;
  name: string;
  score?: number;
  permalink?: string;
};

type Props = {
  costPrice: number;
  initial: DraftForm;
  saveUrl: string;
  heading: string;
  /** Habilita as ações de IA / catálogo ML (indisponíveis para kits). */
  productId?: string;
  /** Base alternativa para as ações; default `/api/products/{productId}`. */
  actionsBaseUrl?: string;
  /** Categoria do fornecedor (breadcrumb do Meu Drop), apenas referência. */
  supplierCategoryPath?: string | null;
  /** Título completo do fornecedor (pode exceder 60 caracteres). */
  originalTitle?: string;
  /** URL do vídeo vinda do scrape do fornecedor (somente leitura). */
  productVideoUrl?: string;
};

const DEFAULT_WARRANTY_TYPE = "Garantia de fábrica";
const DEFAULT_WARRANTY_TIME = "90 dias";

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}

function normalizeAttributes(payload: unknown): string | null {
  const root = readRecord(payload);
  if (!root) return null;
  const candidate = root.attributes ?? readRecord(root.draft)?.attributes;
  if (typeof candidate === "string") return prettyJson(candidate);
  if (candidate !== undefined && candidate !== null) return JSON.stringify(candidate, null, 2);
  return JSON.stringify(root, null, 2);
}

function normalizeSuggestions(payload: unknown): CatalogSuggestion[] {
  const root = readRecord(payload);
  if (!root) return [];
  const raw = Array.isArray(root.suggestions)
    ? root.suggestions
    : Array.isArray(root.results)
      ? root.results
      : [];
  const suggestions: CatalogSuggestion[] = [];
  for (const entry of raw) {
    const record = readRecord(entry);
    if (!record) continue;
    const id = firstString(record.catalogProductId, record.id, record.catalog_product_id);
    if (!id) continue;
    suggestions.push({
      id,
      name: firstString(record.name, record.title) ?? id,
      score: firstNumber(record.score, record.similarity),
      permalink: firstString(record.permalink),
    });
  }
  return suggestions;
}

function normalizeWarnings(payload: unknown): string[] {
  const raw = readRecord(payload)?.warnings;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/** O backend pode aplicar o melhor match sozinho quando tem alta confiança. */
function autoAppliedCatalogId(payload: unknown): string | undefined {
  const root = readRecord(payload);
  if (!root || root.applied !== true) return undefined;
  const best = readRecord(root.bestMatch);
  return firstString(best?.catalogProductId, best?.id);
}

function isMp4(url: string): boolean {
  return url.split("?")[0].toLowerCase().endsWith(".mp4");
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function errorMessage(res: Response, payload: unknown): string {
  const record = readRecord(payload);
  const value = record?.error;
  if (typeof value === "string" && value) return value;
  if (res.status === 404) {
    return "Recurso indisponível neste servidor (HTTP 404) — a rota ainda não existe.";
  }
  return `Falha HTTP ${res.status}`;
}

export function ListingEditor({
  costPrice,
  initial,
  saveUrl,
  heading,
  productId,
  actionsBaseUrl,
  productVideoUrl,
  supplierCategoryPath,
  originalTitle,
}: Props) {
  const [form, setForm] = useState<DraftForm>(() => ({
    ...initial,
    warrantyType: initial.warrantyType || DEFAULT_WARRANTY_TYPE,
    warrantyTime: initial.warrantyTime || DEFAULT_WARRANTY_TIME,
  }));
  const [shippingCost, setShippingCost] = useState(0);
  const [marginPercent, setMarginPercent] = useState(initial.marginPercentOverride ?? 30);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiAttributes, setAiAttributes] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CatalogSuggestion[] | null>(null);
  const [gtinRequired, setGtinRequired] = useState(false);

  const gtinValue = useMemo(
    () => readGtinFromAttributesJson(form.attributes),
    [form.attributes]
  );
  const gtinNormalized = useMemo(() => normalizeGtinValue(gtinValue), [gtinValue]);
  const gtinFormatError = useMemo(() => getGtinFormatError(gtinValue), [gtinValue]);

  const actionsBase = useMemo(() => {
    if (actionsBaseUrl) return actionsBaseUrl;
    return productId ? `${BP}/api/products/${productId}` : null;
  }, [actionsBaseUrl, productId]);

  function setField<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function refreshSim(manualPrice?: number) {
    const res = await fetch(BP + "/api/simulator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        costPrice,
        listingTypeId: form.listingTypeId,
        shippingCost,
        marginPercent,
        manualPrice: manualPrice ?? form.price,
      }),
    });
    const data = (await readJson(res)) as SimResult | null;
    if (res.ok && data) setSim(data);
  }

  useEffect(() => {
    void refreshSim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.listingTypeId, form.price, shippingCost, marginPercent, costPrice]);

  useEffect(() => {
    const categoryId = form.categoryId.trim();
    if (!categoryId) {
      setGtinRequired(false);
      return;
    }
    void getCategoryGtinPolicy(categoryId).then((policy) => {
      setGtinRequired(
        policy.gtinConditionallyRequired && !policy.allowsEmptyGtinReason
      );
    });
  }, [form.categoryId]);

  async function applySuggested() {
    if (!sim) return;
    setField("price", sim.suggestedPrice);
    setField("marginPercentOverride", marginPercent);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        ...form,
        marginPercentOverride: form.marginPercentOverride,
        videoUrl: form.videoUrl || null,
        videoId: form.videoId || null,
        catalogProductId: form.catalogProductId || null,
      };
      const res = await fetch(saveUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      setMessage("Rascunho salvo");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchAiTitle(apply: boolean) {
    if (!actionsBase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${actionsBase}/ai-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      const record = readRecord(data);
      const title = firstString(record?.title);
      if (!title) throw new Error("Resposta da IA em formato inesperado");
      if (apply) setField("title", title);
      const warnings = normalizeWarnings(data);
      setMessage(
        (apply ? "Título ML atualizado" : "Sugestão de título gerada") +
          `: "${title}" (${title.length}/60)` +
          (warnings.length ? ` · Avisos: ${warnings.join("; ")}` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchAiAttributes() {
    if (!actionsBase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${actionsBase}/ai-attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      const normalized = normalizeAttributes(data);
      if (!normalized) throw new Error("Resposta da IA em formato inesperado");
      setAiAttributes(normalized);
      const warnings = normalizeWarnings(data);
      setMessage(
        "Sugestão de características gerada — revise antes de aplicar" +
          (warnings.length ? ` · Avisos: ${warnings.join("; ")}` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchCatalogMatches() {
    if (!actionsBase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${actionsBase}/catalog-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      const list = normalizeSuggestions(data);
      setSuggestions(list);
      const autoApplied = autoAppliedCatalogId(data);
      if (autoApplied) setField("catalogProductId", autoApplied);
      const warnings = normalizeWarnings(data);
      setMessage(
        (list.length
          ? `${list.length} sugestão(ões) de catálogo encontradas`
          : "Nenhum produto de catálogo encontrado") +
          (autoApplied ? ` · vínculo automático em ${autoApplied}` : "") +
          (warnings.length ? ` · Avisos: ${warnings.join("; ")}` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fetchCategorize(apply: boolean) {
    if (!actionsBase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`${actionsBase}/categorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      const record = readRecord(data);
      const categoryId = firstString(record?.categoryId);
      if (!categoryId) throw new Error("Resposta de categorização em formato inesperado");
      if (apply) setField("categoryId", categoryId);
      const categoryName = firstString(record?.categoryName);
      const source = firstString(record?.source);
      const warnings = normalizeWarnings(data);
      setMessage(
        (apply ? "categoryId aplicado" : "Sugestão de categoryId gerada") +
          `: ${categoryId}` +
          (categoryName ? ` (${categoryName})` : "") +
          (source ? ` · fonte: ${source}` : "") +
          (warnings.length ? ` · Avisos: ${warnings.join("; ")}` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const readOnlyVideo = productVideoUrl?.trim() || "";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{heading}</h1>
          <p className="muted">Custo base: R$ {costPrice.toFixed(2)}</p>
        </div>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            Salvar
          </button>
        </div>
      </div>

      {message && <div className="alert">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {actionsBase && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="filters-head">
            <h2>Ações inteligentes</h2>
            <div className="toolbar">
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <button
                className="btn"
                type="button"
                onClick={() => void fetchAiAttributes()}
                disabled={busy}
              >
                Preencher características com IA
              </button>
              <HelpTip text={CATALOG_FILTER_HELP.aiAttributes} />
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <button
                className="btn"
                type="button"
                onClick={() => void fetchCategorize(true)}
                disabled={busy}
              >
                Gerar categoryId
              </button>
              <HelpTip text={CATALOG_FILTER_HELP.aiCategory} />
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <button
                className="btn"
                type="button"
                onClick={() => void fetchCatalogMatches()}
                disabled={busy}
              >
                Buscar no catálogo ML
              </button>
              <HelpTip text={CATALOG_FILTER_HELP.catalogMatch} />
            </span>
            </div>
          </div>

          {aiAttributes !== null && (
            <div style={{ marginTop: "0.5rem" }}>
              <label className="full">
                Sugestão da IA (JSON)
                <textarea
                  value={aiAttributes}
                  onChange={(e) => setAiAttributes(e.target.value)}
                  aria-label="Sugestão de características gerada pela IA"
                />
              </label>
              <div className="toolbar" style={{ marginTop: "0.5rem" }}>
                <button
                  className="btn btn-accent"
                  type="button"
                  onClick={() => {
                    setField("attributes", aiAttributes);
                    setMessage("Sugestão aplicada no campo de características (salve para gravar)");
                  }}
                >
                  Aplicar nas características
                </button>
                <button className="btn" type="button" onClick={() => setAiAttributes(null)}>
                  Descartar sugestão
                </button>
              </div>
            </div>
          )}

          {suggestions !== null && (
            <div className="suggestion-list">
              {suggestions.length === 0 && (
                <p className="muted">Nenhuma sugestão retornada para este produto.</p>
              )}
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className={`suggestion${form.catalogProductId === s.id ? " selected" : ""}`}
                >
                  <div>
                    <strong>{s.name}</strong>
                    <div className="cell-sub">
                      {s.id}
                      {s.score !== undefined ? ` · score ${s.score.toFixed(2)}` : ""}
                      {s.permalink && (
                        <>
                          {" · "}
                          <a href={s.permalink} target="_blank" rel="noreferrer">
                            ver no ML
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="spacer" />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setField("catalogProductId", s.id);
                      setMessage(`Produto de catálogo ${s.id} selecionado (salve para gravar)`);
                    }}
                  >
                    {form.catalogProductId === s.id ? "Selecionado" : "Usar este"}
                  </button>
                </div>
              ))}
              <div className="toolbar">
                <button
                  className="btn"
                  type="button"
                  onClick={() => setField("catalogProductId", "")}
                  disabled={!form.catalogProductId}
                >
                  Limpar vínculo de catálogo
                </button>
                <button className="btn" type="button" onClick={() => setSuggestions(null)}>
                  Fechar sugestões
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {readOnlyVideo && (
        <div className="video-preview" style={{ marginBottom: "1rem" }}>
          <strong>Vídeo do produto</strong>
          <a href={readOnlyVideo} target="_blank" rel="noreferrer">
            {readOnlyVideo}
          </a>
          {isMp4(readOnlyVideo) && <video controls src={readOnlyVideo} width={320} />}
        </div>
      )}

      <div className="form-grid">
        {originalTitle && (
          <label className="full">
            <FieldLabel help={LISTING_HELP.originalTitle}>Título original (fornecedor)</FieldLabel>
            <input value={originalTitle} readOnly />
            <p className="cell-sub" style={{ margin: "0.35rem 0 0" }}>
              {originalTitle.length} caracteres — preservado integralmente no catálogo.
            </p>
          </label>
        )}

        <label className="full">
          <FieldLabel help={LISTING_HELP.mlTitle}>Título no Mercado Livre (máx. 60)</FieldLabel>
          <input value={form.title} maxLength={60} onChange={(e) => setField("title", e.target.value)} />
          <p className="cell-sub" style={{ margin: "0.35rem 0 0" }}>
            {form.title.length}/60 caracteres
            {originalTitle && originalTitle.length > 60 ? " · use IA se precisar resumir sem perder palavras-chave" : ""}
          </p>
        </label>

        {actionsBase && originalTitle && originalTitle.length > 60 && (
          <div className="full toolbar" style={{ marginTop: "-0.5rem" }}>
            <button
              className="btn"
              type="button"
              onClick={() => void fetchAiTitle(false)}
              disabled={busy}
            >
              Sugerir título com IA
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void fetchAiTitle(true)}
              disabled={busy}
            >
              Aplicar título IA
            </button>
          </div>
        )}

        <label>
          <FieldLabel help={LISTING_HELP.listingType}>Tipo de anúncio</FieldLabel>
          <select value={form.listingTypeId} onChange={(e) => setField("listingTypeId", e.target.value)}>
            <option value="gold_pro">Premium (gold_pro)</option>
            <option value="gold_special">Clássico (gold_special)</option>
            <option value="gold">gold</option>
          </select>
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.buyingMode}>Formato de venda</FieldLabel>
          <select value={form.buyingMode} onChange={(e) => setField("buyingMode", e.target.value)}>
            <option value="buy_it_now">Compra imediata</option>
            <option value="auction">Leilão</option>
          </select>
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.condition}>Condição</FieldLabel>
          <select value={form.condition} onChange={(e) => setField("condition", e.target.value)}>
            <option value="new">Novo</option>
            <option value="used">Usado</option>
          </select>
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.shippingMode}>Forma de entrega</FieldLabel>
          <select value={form.shippingMode} onChange={(e) => setField("shippingMode", e.target.value)}>
            <option value="me2">Mercado Envios (me2)</option>
            <option value="custom">Custom</option>
            <option value="not_specified">Não especificado</option>
          </select>
        </label>

        <div style={{ alignSelf: "end" }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.freeShipping}
              onChange={(e) => setField("freeShipping", e.target.checked)}
            />
            Frete grátis
            <HelpTip text={LISTING_HELP.freeShipping} />
          </label>
        </div>

        <div style={{ alignSelf: "end" }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.localPickUp}
              onChange={(e) => setField("localPickUp", e.target.checked)}
            />
            Retirar pessoalmente
            <HelpTip text={LISTING_HELP.localPickUp} />
          </label>
          <p className="cell-sub" style={{ margin: "0.35rem 0 0" }}>
            Desmarcado = &quot;Não ofereço&quot; retirada no anúncio.
          </p>
        </div>

        <label>
          <FieldLabel help={LISTING_HELP.categoryId}>categoryId (MLB)</FieldLabel>
          <div className="toolbar" style={{ gap: "0.5rem" }}>
            <input
              value={form.categoryId}
              placeholder="ex: MLB1055"
              onChange={(e) => setField("categoryId", e.target.value)}
              style={{ flex: 1 }}
            />
            {actionsBase && (
              <>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void fetchCategorize(false)}
                  disabled={busy}
                >
                  Sugerir categoryId
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void fetchCategorize(true)}
                  disabled={busy}
                >
                  Aplicar categoryId
                </button>
              </>
            )}
          </div>
          {supplierCategoryPath && (
            <p className="cell-sub" style={{ margin: "0.35rem 0 0" }}>
              Categoria do fornecedor (referência): {supplierCategoryPath}
            </p>
          )}
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.catalogProductId}>Produto de catálogo ML</FieldLabel>
          <input
            value={form.catalogProductId}
            placeholder="ex: MLB12345678"
            onChange={(e) => setField("catalogProductId", e.target.value)}
          />
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.gtin}>GTIN / Código de barras (EAN)</FieldLabel>
          <input
            value={gtinValue}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Código da embalagem (8–14 dígitos)"
            onChange={(e) =>
              setField("attributes", upsertGtinInAttributesJson(form.attributes, e.target.value))
            }
          />
          {gtinFormatError && (
            <p className="cell-sub" style={{ margin: "0.35rem 0 0", color: "var(--danger, #b42318)" }}>
              {gtinFormatError}
            </p>
          )}
          {gtinRequired && !gtinNormalized && !gtinFormatError && (
            <p className="cell-sub" style={{ margin: "0.35rem 0 0", color: "var(--danger, #b42318)" }}>
              Obrigatório para a categoria {form.categoryId}. Informe o EAN/GTIN do produto.
            </p>
          )}
          {gtinNormalized && (
            <p className="cell-sub" style={{ margin: "0.35rem 0 0" }}>
              Será enviado ao ML como GTIN: {gtinNormalized}
            </p>
          )}
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.warrantyType}>Garantia (tipo)</FieldLabel>
          <input
            value={form.warrantyType}
            placeholder={DEFAULT_WARRANTY_TYPE}
            onChange={(e) => setField("warrantyType", e.target.value)}
          />
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.warrantyTime}>Garantia (tempo)</FieldLabel>
          <input
            value={form.warrantyTime}
            placeholder={DEFAULT_WARRANTY_TIME}
            onChange={(e) => setField("warrantyTime", e.target.value)}
          />
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.quantity}>Quantidade</FieldLabel>
          <input
            type="number"
            value={form.availableQuantity}
            onChange={(e) => setField("availableQuantity", Number(e.target.value))}
          />
        </label>

        <label>
          <FieldLabel help={LISTING_HELP.videoId}>ID do vídeo no ML</FieldLabel>
          <input
            value={form.videoId}
            placeholder="ex: abc123"
            onChange={(e) => setField("videoId", e.target.value)}
          />
        </label>

        <label className="full">
          <FieldLabel help={LISTING_HELP.videoUrl}>URL do vídeo</FieldLabel>
          <input
            value={form.videoUrl}
            placeholder="https://youtube.com/..."
            onChange={(e) => setField("videoUrl", e.target.value)}
          />
        </label>

        <div className="full simulator">
          <strong>Simulador de custos</strong>
          <div className="form-grid" style={{ marginTop: "0.75rem" }}>
            <label>
              <FieldLabel help={LISTING_HELP.marginOverride}>Margem % (override)</FieldLabel>
              <input
                type="number"
                value={marginPercent}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMarginPercent(v);
                  setField("marginPercentOverride", v);
                }}
              />
            </label>
            <label>
              <FieldLabel help={LISTING_HELP.shippingCost}>Frete (custo)</FieldLabel>
              <input
                type="number"
                value={shippingCost}
                onChange={(e) => setShippingCost(Number(e.target.value))}
              />
            </label>
            <label>
              <FieldLabel help={LISTING_HELP.salePrice}>Preço de venda (override)</FieldLabel>
              <input
                type="number"
                step="0.01"
                value={form.price}
                onChange={(e) => setField("price", Number(e.target.value))}
              />
            </label>
            <div className="toolbar" style={{ alignItems: "end" }}>
              <button className="btn" type="button" onClick={() => void applySuggested()}>
                Usar preço sugerido
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setField("marginPercentOverride", null);
                  setMarginPercent(30);
                }}
              >
                Limpar override
              </button>
            </div>
          </div>
          {sim && (
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Sugerido: R$ {sim.suggestedPrice.toFixed(2)} · Taxa: R$ {sim.estimatedFee.toFixed(2)} ·
              Lucro: R$ {sim.estimatedProfit.toFixed(2)}
              {form.marginPercentOverride != null && (
                <> · Override margem: {form.marginPercentOverride}%</>
              )}
            </p>
          )}
        </div>

        <label className="full">
          <FieldLabel help={LISTING_HELP.description}>Descrição</FieldLabel>
          <textarea value={form.description} onChange={(e) => setField("description", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel help={LISTING_HELP.pictures}>Fotos (JSON array de URLs)</FieldLabel>
          <textarea value={form.pictures} onChange={(e) => setField("pictures", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel help={LISTING_HELP.attributes}>Características / atributos (JSON)</FieldLabel>
          <textarea value={form.attributes} onChange={(e) => setField("attributes", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel help={LISTING_HELP.variations}>Variações + fotos (JSON)</FieldLabel>
          <textarea value={form.variations} onChange={(e) => setField("variations", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel help={LISTING_HELP.regulatory}>Informação regulatória (JSON)</FieldLabel>
          <textarea value={form.regulatory} onChange={(e) => setField("regulatory", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel help={LISTING_HELP.shippingJson}>Shipping extra (JSON)</FieldLabel>
          <textarea value={form.shippingJson} onChange={(e) => setField("shippingJson", e.target.value)} />
        </label>
      </div>
    </div>
  );
}
