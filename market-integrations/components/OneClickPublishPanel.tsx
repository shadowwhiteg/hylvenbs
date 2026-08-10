"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import {
  formatOneClickBulkSelectionMessage,
  selectOneClickBulkCandidates,
  summarizeOneClickErrors,
} from "@/lib/oneclick/bulk";
import { gtinFromProduct, isValidGtin } from "@/lib/oneclick/gtin";
import { feesForPrice, solvePriceForMargin } from "@/lib/pricing/marketplace-fees";
import { BP } from "@/lib/base-path";

export type OneClickActiveJobInfo = {
  id: string;
  status: string;
  pct: number;
  done: number;
  total: number;
  success: number;
  failed: number;
  pending: number;
  running: boolean;
  cancelling: boolean;
};

type Marketplace = "ml" | "shopee";

type Product = {
  id: string;
  title: string;
  sku?: string | null;
  stock?: number | null;
  costPrice: number;
  mlItemId?: string | null;
  shopeeItemId?: string | null;
  attributesJson?: string | null;
  draft?: { attributes?: string | null } | null;
};

type SelectedItem = {
  productId: string;
  sku: string;
  title: string;
  price: string;
  gtin: string;
  /** Custo Meu Drop, guardado para estimar taxas e lucro da seleção. */
  cost: number;
};

type JobItem = {
  id: string;
  sku: string;
  title: string;
  status: string;
  error?: string | null;
  resultItemId?: string | null;
  resultUrl?: string | null;
};

type Job = {
  id: string;
  status: string;
  listingType?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  items: JobItem[];
};

const TERMINAL = new Set(["success", "error", "partial", "cancelled"]);
const ITEM_DONE = new Set(["success", "error", "conflict", "cancelled"]);
const CANCELLABLE = new Set(["pending", "running"]);

function statusBadgeClass(status: string): string {
  if (status === "success") return "badge ok";
  if (status === "error") return "badge err";
  if (status === "conflict" || status === "cancelled") return "badge warn";
  return "badge";
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "aguardando";
    case "running":
      return "publicando…";
    case "success":
      return "publicado";
    case "error":
      return "erro";
    case "conflict":
      return "SKU já existe";
    case "cancelled":
      return "cancelado";
    default:
      return status;
  }
}

export function OneClickPublishPanel({
  marketplace,
  onJobFinished,
  hideStickyProgress = false,
  onActiveJobChange,
  cancelRef,
}: {
  marketplace: Marketplace;
  /** Called when an active job reaches a terminal status (success/error/partial). */
  onJobFinished?: () => void;
  /** When true, progress card is a normal (non-sticky) card — parent may show a global jobs bar. */
  hideStickyProgress?: boolean;
  onActiveJobChange?: (job: OneClickActiveJobInfo | null) => void;
  cancelRef?: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const apiBase =
    marketplace === "ml" ? `${BP}/api/one-click-ml` : `${BP}/api/one-click-shopee`;
  const showGtin = marketplace === "ml";
  const marketplaceLabel = marketplace === "ml" ? "ML" : "Shopee";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-error feedback (bulk selection summary) — rendered as a neutral alert. */
  const [notice, setNotice] = useState<string | null>(null);
  const [markupPct, setMarkupPct] = useState("");
  const [priceMode, setPriceMode] = useState<"markup" | "margin">("markup");
  const [listingType, setListingType] = useState<"gold_special" | "gold_pro">("gold_special");
  const [jobMode, setJobMode] = useState<"publish" | "sync">("publish");
  const [bulkLoading, setBulkLoading] = useState<"unpublished" | "sync" | null>(null);
  const [notifiedJobId, setNotifiedJobId] = useState<string | null>(null);

  /**
   * "markup" = percentual cru sobre o custo (comportamento antigo).
   * "margin" = lucro líquido desejado, resolvido depois de descontar comissão e
   * taxa fixa do marketplace (tabelas em lib/pricing/marketplace-fees).
   */
  function computePrice(cost: number | null | undefined): string {
    const base = cost || 0;
    if (!base) return "";
    const pct = Number(markupPct);
    if (!Number.isFinite(pct)) return base.toFixed(2);

    if (priceMode === "margin") {
      try {
        const solved = solvePriceForMargin({
          cost: base,
          marginPercent: pct,
          marketplace,
          listingTypeId: listingType,
        });
        return solved.price.toFixed(2);
      } catch {
        return "";
      }
    }

    const withMarkup = pct !== 0 ? base * (1 + pct / 100) : base;
    return withMarkup.toFixed(2);
  }

  async function loadAllProducts(): Promise<Product[]> {
    const all: Product[] = [];
    let page = 1;
    for (;;) {
      const params = new URLSearchParams();
      params.set("pageSize", "500");
      params.set("page", String(page));
      const res = await fetch(`${BP}/api/products?${params.toString()}`);
      const data = await res.json();
      const batch: Product[] = data.products || [];
      all.push(...batch);
      if (!batch.length || all.length >= (data.total || 0)) break;
      page += 1;
    }
    return all;
  }

  /**
   * SKUs + ids of listings that still exist on the marketplace (last sync).
   * Falha de rede devolve `undefined` — "não sei", e não "nenhum anúncio":
   * um Set vazio aqui apagaria todos os vínculos na hora de selecionar.
   */
  async function loadPublishedRefs(): Promise<{
    publishedSkus?: Set<string>;
    liveListingIds?: Set<string>;
  }> {
    try {
      const res = await fetch(`${apiBase}/published-skus`);
      if (!res.ok) return {};
      const data = await res.json();
      if (!Array.isArray(data.itemIds) || !Array.isArray(data.skus)) return {};
      return {
        publishedSkus: new Set<string>(data.skus),
        liveListingIds: new Set<string>(data.itemIds),
      };
    } catch {
      return {};
    }
  }

  async function selectBulk(kind: "unpublished" | "sync") {
    setBulkLoading(kind);
    setError(null);
    setNotice(null);
    try {
      const [all, refs] = await Promise.all([loadAllProducts(), loadPublishedRefs()]);
      const {
        selected: candidates,
        skippedOutOfStock,
        skippedWithoutSku,
        skippedAlreadyPublished,
        staleLinks,
      } = selectOneClickBulkCandidates(
        all,
        kind,
        marketplace,
        refs.publishedSkus,
        refs.liveListingIds
      );
      if (!candidates.length) {
        setError(
          kind === "unpublished"
            ? skippedOutOfStock
              ? `Nenhum produto com estoque para anunciar (${skippedOutOfStock} sem estoque foram ignorados — o One Click não lista SKUs zerados).`
              : "Nenhum produto pendente de anúncio encontrado."
            : "Nenhum produto já anunciado encontrado para sincronizar."
        );
        return;
      }
      const next = new Map<string, SelectedItem>();
      // EAN inválido do catálogo (placeholders tipo 7891234567890) faz o ML
      // recusar o anúncio inteiro. Numa seleção em massa, descartar o EAN ruim é
      // melhor que travar a publicação de todos por causa de alguns registros.
      let droppedGtins = 0;
      for (const p of candidates) {
        const rawGtin = showGtin ? gtinFromProduct(p) : "";
        const usableGtin = rawGtin && isValidGtin(rawGtin) ? rawGtin : "";
        if (rawGtin && !usableGtin) droppedGtins += 1;
        next.set(p.id, {
          productId: p.id,
          sku: p.sku as string,
          title: p.title,
          price: computePrice(p.costPrice),
          gtin: usableGtin,
          cost: p.costPrice || 0,
        });
      }
      setSelected(next);
      setJobMode(kind === "sync" ? "sync" : "publish");
      setNotice(
        [
          formatOneClickBulkSelectionMessage({
            kind,
            marketplace,
            selectedCount: candidates.length,
            catalogTotal:
              candidates.length + skippedOutOfStock + skippedWithoutSku + skippedAlreadyPublished,
            skippedOutOfStock,
            skippedWithoutSku,
            skippedAlreadyPublished,
            staleLinks,
          }),
          droppedGtins
            ? `${droppedGtins} EAN/GTIN inválido(s) do catálogo foram descartados — esses anúncios vão sem EAN.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    } finally {
      setBulkLoading(null);
    }
  }

  async function loadJobs() {
    const res = await fetch(apiBase);
    const data = await res.json();
    setJobs(data.jobs || []);
  }

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplace]);

  useEffect(() => {
    if (!activeJobId) return;
    const job = jobs.find((j) => j.id === activeJobId);
    if (job && TERMINAL.has(job.status)) {
      if (notifiedJobId !== activeJobId) {
        setNotifiedJobId(activeJobId);
        onJobFinished?.();
      }
      return;
    }
    const t = setInterval(() => void loadJobs(), 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId, jobs, apiBase, notifiedJobId]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const hasQuery = query.trim().length >= 2;
      if (!hasQuery) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const params = new URLSearchParams();
        params.set("q", query.trim());
        params.set("pageSize", "25");
        const res = await fetch(`${BP}/api/products?${params.toString()}`);
        const data = await res.json();
        setResults(data.products || []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function toggleSelect(product: Product) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(product.id)) {
        next.delete(product.id);
      } else {
        if (!product.sku) return prev;
        next.set(product.id, {
          productId: product.id,
          sku: product.sku,
          title: product.title,
          price: computePrice(product.costPrice),
          gtin: showGtin ? gtinFromProduct(product) : "",
          cost: product.costPrice || 0,
        });
      }
      return next;
    });
    setJobMode("publish");
  }

  function updateSelected(productId: string, patch: Partial<SelectedItem>) {
    setSelected((prev) => {
      const next = new Map(prev);
      const item = next.get(productId);
      if (item) next.set(productId, { ...item, ...patch });
      return next;
    });
  }

  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

  /** Receita/taxas/lucro da seleção, para revisar antes de publicar. */
  const selectionTotals = useMemo(() => {
    let revenue = 0;
    let fees = 0;
    let cost = 0;
    let priced = 0;
    for (const item of selectedList) {
      const price = Number(item.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      priced += 1;
      revenue += price;
      fees += feesForPrice(price, marketplace, listingType).total;
      cost += item.cost || 0;
    }
    const profit = revenue - fees - cost;
    return {
      priced,
      revenue,
      fees,
      cost,
      profit,
      marginPercent: revenue > 0 ? (profit / revenue) * 100 : 0,
    };
  }, [selectedList, marketplace, listingType]);

  const gtinErrors = useMemo(() => {
    const errs = new Map<string, string>();
    for (const item of selectedList) {
      if (showGtin && item.gtin.trim() && !isValidGtin(item.gtin)) {
        errs.set(item.productId, "EAN/GTIN inválido");
      }
    }
    return errs;
  }, [selectedList, showGtin]);

  async function publish() {
    if (!selectedList.length) return;
    if (gtinErrors.size) {
      setError("Corrija o(s) EAN/GTIN inválido(s) antes de publicar.");
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: jobMode,
          listingType: showGtin ? listingType : undefined,
          items: selectedList.map((item) => ({
            productId: item.productId,
            sku: item.sku,
            title: item.title,
            price: item.price ? Number(item.price) : null,
            gtin: showGtin && item.gtin.trim() ? item.gtin.trim() : null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao publicar");
      setActiveJobId(data.job.id);
      setNotifiedJobId(null);
      setSelected(new Map());
      setJobMode("publish");
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  async function cancelJob(jobId: string) {
    setCancellingId(jobId);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/${jobId}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao cancelar");
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingId(null);
    }
  }

  async function clearHistory() {
    if (
      !window.confirm(
        `Apagar todo o histórico One Click (${marketplaceLabel})? Esta ação não pode ser desfeita.`
      )
    ) {
      return;
    }
    setClearingHistory(true);
    setError(null);
    try {
      const res = await fetch(apiBase, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao limpar histórico");
      setActiveJobId(null);
      setNotifiedJobId(null);
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingHistory(false);
    }
  }

  const activeJob = jobs.find((j) => j.id === activeJobId) || null;
  const activeDone = activeJob ? activeJob.items.filter((i) => ITEM_DONE.has(i.status)).length : 0;
  const activeTotal = activeJob ? activeJob.items.length : 0;
  const activeRemaining = Math.max(0, activeTotal - activeDone);
  const activePct = activeTotal ? Math.round((activeDone / activeTotal) * 100) : 0;
  const activeSuccess = activeJob
    ? activeJob.items.filter((i) => i.status === "success").length
    : 0;
  const activeFailed = activeJob
    ? activeJob.items.filter((i) => i.status === "error" || i.status === "conflict").length
    : 0;
  const activeRunning = activeJob
    ? activeJob.items.filter((i) => i.status === "running" || i.status === "pending").length
    : 0;
  const jobRunning = !!activeJob && !TERMINAL.has(activeJob.status);
  const activeErrorSummary = useMemo(
    () => (activeJob ? summarizeOneClickErrors(activeJob.items) : []),
    [activeJob]
  );

  useEffect(() => {
    if (!onActiveJobChange) return;
    if (!activeJob) {
      onActiveJobChange(null);
      return;
    }
    onActiveJobChange({
      id: activeJob.id,
      status: activeJob.status,
      pct: activePct,
      done: activeDone,
      total: activeTotal,
      success: activeSuccess,
      failed: activeFailed,
      pending: activeRunning,
      running: jobRunning,
      cancelling: cancellingId === activeJob.id,
    });
  }, [
    activeJob,
    activePct,
    activeDone,
    activeTotal,
    activeSuccess,
    activeFailed,
    activeRunning,
    jobRunning,
    cancellingId,
    onActiveJobChange,
  ]);

  useEffect(() => {
    if (!cancelRef) return;
    cancelRef.current = activeJob && jobRunning ? () => cancelJob(activeJob.id) : null;
    return () => {
      cancelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelRef, activeJob?.id, jobRunning]);

  return (
    <div>
      {activeJob && (
        <div
          className="card"
          style={{
            marginBottom: "1rem",
            ...(hideStickyProgress
              ? {}
              : {
                  position: "sticky" as const,
                  top: 0,
                  zIndex: 20,
                }),
            borderColor: jobRunning ? "var(--accent)" : undefined,
            boxShadow: jobRunning ? "0 8px 24px rgba(0,0,0,0.12)" : undefined,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0 }}>
              {jobRunning
                ? "Publicação One Click em andamento"
                : "Publicação One Click finalizada"}
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                {activeDone}/{activeTotal} · {activePct}%
              </strong>
              {jobRunning && (
                <button
                  className="btn"
                  onClick={() => void cancelJob(activeJob.id)}
                  disabled={cancellingId === activeJob.id}
                >
                  {cancellingId === activeJob.id ? "Cancelando…" : "Cancelar job"}
                </button>
              )}
            </div>
          </div>
          <p className="muted" style={{ margin: "0.4rem 0 0.75rem" }}>
            <span className="badge ok">{activeSuccess} ok</span>{" "}
            <span className="badge err">{activeFailed} falha</span>{" "}
            <span className="badge">{activeRunning} pendente</span>
            {" · "}
            {activeRemaining > 0
              ? `${activeRemaining} restante${activeRemaining === 1 ? "" : "s"}`
              : "nada restante"}
          </p>
          {!!activeErrorSummary.length && (
            <ul
              className="muted"
              style={{
                margin: "0 0 0.75rem",
                paddingLeft: "1.1rem",
                fontSize: "0.9rem",
              }}
            >
              {activeErrorSummary.map((row) => (
                <li key={row.label}>
                  {row.count}× {row.label}
                </li>
              ))}
            </ul>
          )}
          <div className="progress-bar" style={{ height: 14 }}>
            <div className="progress-bar-fill" style={{ width: `${activePct}%` }} />
          </div>
          <ul
            style={{
              marginTop: "0.75rem",
              marginBottom: 0,
              paddingLeft: "1.1rem",
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {activeJob.items.map((i) => (
              <li key={i.id}>
                <code>{i.sku}</code> · {i.title} ·{" "}
                <span className={statusBadgeClass(i.status)}>{statusLabel(i.status)}</span>
                {i.resultUrl ? (
                  <>
                    {" "}
                    ·{" "}
                    <a href={i.resultUrl} target="_blank" rel="noreferrer">
                      ver anúncio
                    </a>
                  </>
                ) : null}
                {i.error ? (
                  <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
                    {i.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {TERMINAL.has(activeJob.status) && (
            <p className="muted" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
              Job finalizado. Na aba Gerenciar anúncios, use &quot;Atualizar agora&quot; para puxar os
              anúncios novos da conta ML.
            </p>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Publicar / sincronizar via One Click</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Usa o Sistema One Click do Meu Drop: o SKU puxa título, fotos e categoria. Defina só o
          preço{showGtin ? " e, se houver, o EAN/GTIN" : ""}. Gestão de anúncios já no ar (promo,
          pausar, IA, kits) fica na aba Gerenciar anúncios, pela API{" "}
          {marketplace === "ml" ? "do Mercado Livre" : "da Shopee"}.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert">{notice}</div>}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Ações em massa (One Click)</h3>
        <label className="muted" style={{ display: "block", marginBottom: "0.4rem" }}>
          Cálculo do preço
          <br />
          <select
            className="input"
            style={{ marginTop: "0.25rem", minWidth: 320 }}
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as "markup" | "margin")}
          >
            <option value="markup">Markup simples sobre o custo (%)</option>
            <option value="margin">Margem de lucro líquida (%) — desconta as taxas</option>
          </select>
        </label>
        <label className="muted" style={{ display: "block", marginBottom: "0.4rem" }}>
          {priceMode === "margin" ? "Margem de lucro líquida (%)" : "Markup sobre o custo (%)"}
          <input
            className="input"
            style={{ width: 100, marginLeft: "0.5rem" }}
            type="number"
            step="0.1"
            placeholder="0"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
          />
        </label>
        {priceMode === "margin" && (
          <p className="cell-sub" style={{ marginTop: 0 }}>
            O preço é resolvido para sobrar {markupPct || 0}% de lucro <em>depois</em> de descontar a
            comissão e a taxa fixa{" "}
            {marketplace === "shopee"
              ? "da Shopee (CNPJ: 20% + R$ 4 até R$ 79,99; 14% + R$ 16/20/26 nas faixas acima)"
              : "do Mercado Livre (comissão do tipo de anúncio + custo fixo por unidade abaixo de R$ 79)"}
            .
          </p>
        )}
        {showGtin && (
          <label className="muted" style={{ display: "block", marginBottom: "0.75rem" }}>
            Tipo de anúncio
            <br />
            <select
              className="input"
              style={{ marginTop: "0.25rem", minWidth: 220 }}
              value={listingType}
              onChange={(e) => setListingType(e.target.value as "gold_special" | "gold_pro")}
            >
              <option value="gold_special">Clássico (gold_special)</option>
              <option value="gold_pro">Premium (gold_pro)</option>
            </select>
          </label>
        )}
        <p className="muted" style={{ marginTop: 0 }}>
          Aplicado ao preço sugerido (custo) ao selecionar produtos abaixo. Revise antes de publicar.
          &quot;Selecionar todos não anunciados&quot; ignora produtos sem estoque — o picker do One
          Click não retorna SKUs zerados.
          {showGtin
            ? " O tipo de anúncio vale para todos os itens deste job de publicação."
            : ""}
        </p>
        <div className="toolbar">
          <button
            className="btn"
            onClick={() => void selectBulk("unpublished")}
            disabled={bulkLoading !== null}
          >
            {bulkLoading === "unpublished"
              ? "Buscando…"
              : `Selecionar todos não anunciados (${marketplaceLabel})`}
          </button>
          <button className="btn" onClick={() => void selectBulk("sync")} disabled={bulkLoading !== null}>
            {bulkLoading === "sync" ? "Buscando…" : "Sincronizar todos já anunciados"}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Buscar produtos (nome ou SKU)</h3>
        <input
          className="input"
          style={{ width: "100%", maxWidth: 420 }}
          placeholder="Digite ao menos 2 caracteres…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <p className="muted">Buscando…</p>}
        {!!results.length && (
          <table className="table" style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th></th>
                <th>Produto</th>
                <th>SKU</th>
                <th>Custo</th>
                <th>Publicado</th>
              </tr>
            </thead>
            <tbody>
              {results.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      disabled={!p.sku}
                      onChange={() => toggleSelect(p)}
                    />
                  </td>
                  <td>{p.title}</td>
                  <td>
                    <code>{p.sku || "—"}</code>
                  </td>
                  <td>R$ {p.costPrice.toFixed(2)}</td>
                  <td>
                    {marketplace === "ml" && p.mlItemId ? <span className="badge ok">ML</span> : null}
                    {marketplace === "shopee" && p.shopeeItemId ? (
                      <span className="badge ok">Shopee</span>
                    ) : null}
                    {marketplace === "ml" && !p.mlItemId ? <span className="muted">—</span> : null}
                    {marketplace === "shopee" && !p.shopeeItemId ? <span className="muted">—</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>
          Selecionados ({selectedList.length})
          {jobMode === "sync" && (
            <span className="badge warn" style={{ marginLeft: "0.5rem" }}>
              modo sincronizar
            </span>
          )}
          {showGtin && (
            <span className="badge" style={{ marginLeft: "0.5rem" }}>
              {listingType === "gold_pro" ? "Premium" : "Clássico"}
            </span>
          )}
        </h3>
        {!selectedList.length && <p className="muted">Nenhum produto selecionado ainda.</p>}
        {!!selectedList.length && !!selectionTotals.priced && (
          <p className="cell-sub" style={{ marginTop: 0 }}>
            {selectionTotals.priced} item(ns) com preço · receita bruta R${" "}
            {selectionTotals.revenue.toFixed(2)} · taxas estimadas R${" "}
            {selectionTotals.fees.toFixed(2)} · custo R$ {selectionTotals.cost.toFixed(2)} ·{" "}
            <strong>
              lucro estimado R$ {selectionTotals.profit.toFixed(2)} (
              {selectionTotals.marginPercent.toFixed(1)}%)
            </strong>
          </p>
        )}
        {!!selectedList.length && (
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU</th>
                <th>Preço (R$)</th>
                {showGtin && <th>EAN/GTIN (opcional)</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {selectedList.map((item) => (
                <tr key={item.productId}>
                  <td>{item.title}</td>
                  <td>
                    <code>{item.sku}</code>
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ width: 100 }}
                      type="number"
                      step="0.01"
                      value={item.price}
                      onChange={(e) => updateSelected(item.productId, { price: e.target.value })}
                    />
                  </td>
                  {showGtin && (
                    <td>
                      <input
                        className="input"
                        style={{ width: 150 }}
                        placeholder="opcional"
                        value={item.gtin}
                        onChange={(e) => updateSelected(item.productId, { gtin: e.target.value })}
                      />
                      {gtinErrors.has(item.productId) && (
                        <div
                          className="muted"
                          style={{ color: "var(--badge-err-fg)", fontSize: "0.8rem" }}
                        >
                          {gtinErrors.get(item.productId)}
                        </div>
                      )}
                    </td>
                  )}
                  <td>
                    <button
                      className="btn"
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Map(prev);
                          next.delete(item.productId);
                          return next;
                        })
                      }
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="toolbar" style={{ marginTop: "0.75rem" }}>
          <button
            className="btn btn-primary"
            onClick={() => void publish()}
            disabled={publishing || !selectedList.length}
          >
            {publishing
              ? "Enviando…"
              : jobMode === "sync"
                ? `Sincronizar via One Click (${selectedList.length})`
                : `Publicar via One Click (${selectedList.length})`}
          </button>
        </div>
      </div>

      <div className="card">
        <div
          className="toolbar"
          style={{
            marginTop: 0,
            marginBottom: "0.75rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ margin: 0 }}>Histórico One Click</h3>
          <button
            className="btn"
            onClick={() => void clearHistory()}
            disabled={clearingHistory || !jobs.length || jobRunning}
            title={
              jobRunning
                ? "Cancele ou aguarde o job em andamento antes de limpar"
                : "Apaga todos os jobs One Click deste marketplace"
            }
          >
            {clearingHistory ? "Limpando…" : "Limpar histórico"}
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Itens</th>
              <th>Criado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  <code>{j.id.slice(0, 8)}</code>
                </td>
                <td>
                  <span
                    className={`badge ${
                      j.status === "success"
                        ? "ok"
                        : j.status === "error"
                          ? "err"
                          : j.status === "cancelled"
                            ? "warn"
                            : ""
                    }`}
                  >
                    {j.status === "cancelled" ? "cancelado" : j.status}
                  </span>
                  {marketplace === "ml" && j.listingType ? (
                    <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.2rem" }}>
                      {j.listingType === "gold_pro" ? "Premium" : "Clássico"}
                    </div>
                  ) : null}
                </td>
                <td>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {j.items.map((i) => (
                      <li key={i.id}>
                        <code>{i.sku}</code> · {statusLabel(i.status)}
                        {i.resultItemId ? ` · ${i.resultItemId}` : ""}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{new Date(j.createdAt).toLocaleString("pt-BR")}</td>
                <td>
                  {CANCELLABLE.has(j.status) ? (
                    <button
                      className="btn"
                      onClick={() => void cancelJob(j.id)}
                      disabled={cancellingId === j.id}
                      title="Para o job; itens já publicados permanecem"
                    >
                      {cancellingId === j.id ? "Cancelando…" : "Cancelar"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!jobs.length && (
              <tr>
                <td colSpan={5} className="muted">
                  Nenhuma publicação ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
