"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PriceInput from "./PriceInput";
import { OneClickPublishPanel, type OneClickActiveJobInfo } from "./OneClickPublishPanel";
import { CatalogToolsPanel } from "./CatalogToolsPanel";
import { BP } from "@/lib/base-path";

type Listing = {
  id: string;
  title: string;
  price: number;
  currencyId: string;
  stock: number;
  status: string;
  categoryId?: string | null;
  permalink?: string | null;
  thumbnail?: string | null;
  lastApiSyncAt: string;
  product?: { id: string; title: string; costPrice: number } | null;
  kit?: { id: string; title: string; costPrice: number } | null;
  itemSku?: string | null;
};

type FiltersState = {
  status: string;
  origin: string;
  stock: string;
  missingSku: string;
  priceMin: string;
  priceMax: string;
  costMin: string;
  costMax: string;
  sort: string;
  dir: string;
};

const EMPTY_FILTERS: FiltersState = {
  status: "",
  origin: "",
  stock: "",
  missingSku: "",
  priceMin: "",
  priceMax: "",
  costMin: "",
  costMax: "",
  sort: "updated",
  dir: "desc",
};

type SuggestionItem = {
  id: string;
  title: string;
  price: number;
};

type KitSuggestion = {
  title: string;
  rationale: string;
  discountPercent: number;
  items: SuggestionItem[];
  grossPrice: number;
  price: number;
  source: "ai" | "fallback";
};

type EditableSuggestion = KitSuggestion & { include: boolean };

function suggestionPricing(suggestion: EditableSuggestion) {
  const gross = suggestion.items.reduce((sum, i) => sum + i.price, 0);
  const percent = Number.isFinite(suggestion.discountPercent) ? suggestion.discountPercent : 0;
  const final = Math.round(gross * (1 - percent / 100) * 100) / 100;
  return { gross, final };
}

const REVIEW_TERMINAL_STATUSES = new Set(["success", "error", "partial"]);

type ReviewJobItemApi = { status: string; error?: string | null };
type ReviewJobApi = { id: string; status: string; items: ReviewJobItemApi[] };

type ReviewJobState = {
  id: string;
  status: string;
  total: number;
  done: number;
  success: number;
  skipped: number;
  errorCount: number;
  errorSamples: string[];
};

function summarizeReviewJob(job: ReviewJobApi): ReviewJobState {
  const success = job.items.filter((i) => i.status === "success").length;
  const skipped = job.items.filter((i) => i.status === "skipped").length;
  const errored = job.items.filter((i) => i.status === "error");
  const done = success + skipped + errored.length;
  return {
    id: job.id,
    status: job.status,
    total: job.items.length,
    done,
    success,
    skipped,
    errorCount: errored.length,
    errorSamples: errored.slice(0, 3).map((i) => i.error || "erro desconhecido"),
  };
}

function errorMessage(res: Response, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value) return value;
  }
  return `falha HTTP ${res.status}`;
}

const GATEWAY_ERROR_STATUSES = new Set([502, 503, 504, 522, 523, 524]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export function ShopeeListingsClient() {
  const [activeTab, setActiveTab] = useState<"publish" | "manage">("publish");
  const [oneClickJob, setOneClickJob] = useState<OneClickActiveJobInfo | null>(null);
  const oneClickCancelRef = useRef<(() => Promise<void>) | null>(null);
  const handleOneClickJobChange = useCallback((job: OneClickActiveJobInfo | null) => {
    setOneClickJob(job);
  }, []);

  const [listings, setListings] = useState<Listing[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkMargin, setBulkMargin] = useState("");
  const [bulkDiscountPct, setBulkDiscountPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discountPct, setDiscountPct] = useState("");

  const [suggestions, setSuggestions] = useState<EditableSuggestion[] | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestWarnings, setSuggestWarnings] = useState<string[]>([]);
  const [suggestModel, setSuggestModel] = useState("");
  const [enrichWithAi, setEnrichWithAi] = useState(true);
  const [createdKits, setCreatedKits] = useState<Array<{ id: string; title: string }>>([]);
  const [kitDiscount, setKitDiscount] = useState("10");
  const [reviewJob, setReviewJob] = useState<ReviewJobState | null>(null);
  const reviewPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (reviewPollTimer.current) clearTimeout(reviewPollTimer.current);
    };
  }, []);

  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [counts, setCounts] = useState({ matched: 0, kit: 0, avulso: 0, hasVideo: 0 });
  const [total, setTotal] = useState(0);

  async function load(nextFilters: FiltersState = filters, nextQ: string = q) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextQ.trim()) params.set("q", nextQ.trim());
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.origin) params.set("origin", nextFilters.origin);
      if (nextFilters.stock) params.set("stock", nextFilters.stock);
      if (nextFilters.missingSku) params.set("missingSku", nextFilters.missingSku);
      if (nextFilters.priceMin) params.set("priceMin", nextFilters.priceMin);
      if (nextFilters.priceMax) params.set("priceMax", nextFilters.priceMax);
      if (nextFilters.costMin) params.set("costMin", nextFilters.costMin);
      if (nextFilters.costMax) params.set("costMax", nextFilters.costMax);
      params.set("sort", nextFilters.sort);
      params.set("dir", nextFilters.dir);
      params.set("pageSize", "500");
      const res = await fetch(`${BP}/api/shopee-listings?${params}`);
      const data = (await readJson(res)) as {
        listings?: Listing[];
        total?: number;
        statuses?: string[];
        counts?: { matched: number; kit: number; avulso: number; hasVideo: number };
      } | null;
      if (!res.ok || !data) {
        setError(errorMessage(res, data));
        return;
      }
      setListings(data.listings ?? []);
      setTotal(data.total ?? 0);
      setStatuses(data.statuses ?? []);
      setCounts(data.counts ?? { matched: 0, kit: 0, avulso: 0, hasVideo: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function patchFilters(patch: Partial<FiltersState>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next, q);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setQ("");
    void load(EMPTY_FILTERS, "");
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importNow() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings`, { method: "POST" });
      const data = (await readJson(res)) as { imported?: number; errors?: string[] } | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      setMessage(
        `Importados ${data.imported ?? 0} anúncio(s)${
          data.errors?.length ? ` · ${data.errors.length} erro(s)` : ""
        }`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulk() {
    if (!selected.size) return;
    const price = bulkPrice.trim() ? Number(bulkPrice) : undefined;
    const marginPercent = bulkMargin.trim() ? Number(bulkMargin) : undefined;
    if (price == null && marginPercent == null) {
      setError("Informe um preço fixo ou uma margem %");
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/bulk-price`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), price, marginPercent }),
      });
      const data = (await readJson(res)) as { updated?: number; errors?: string[] } | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      setMessage(
        `Preço atualizado em ${data.updated ?? 0} anúncio(s)${
          data.errors?.length ? ` · ${data.errors.length} erro(s): ${data.errors.join("; ")}` : ""
        }`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyBulkDiscount() {
    if (!selected.size) return;
    const percent = Number(bulkDiscountPct);
    if (!(percent > 0 && percent < 100)) {
      setError("Informe um % de desconto válido (entre 0 e 100)");
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/bulk-promotion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), percent }),
      });
      const data = (await readJson(res)) as { updated?: number; errors?: string[] } | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      setMessage(
        `Desconto de ${percent}% aplicado em ${data.updated ?? 0} anúncio(s)${
          data.errors?.length ? ` · ${data.errors.length} erro(s): ${data.errors.join("; ")}` : ""
        }`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyBulkStatus(status: "active" | "paused") {
    if (!selected.size) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/bulk-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), status }),
      });
      const data = (await readJson(res)) as { updated?: number; errors?: string[] } | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      setMessage(
        `${status === "paused" ? "Desativado" : "Reativado"} em ${data.updated ?? 0} anúncio(s)${
          data.errors?.length ? ` · ${data.errors.length} erro(s): ${data.errors.join("; ")}` : ""
        }`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createKitManual() {
    if (selected.size < 2) {
      setError("Selecione ao menos 2 anúncios para montar um kit");
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    setCreatedKits([]);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingIds: Array.from(selected),
          bundleDiscountPercent: Number(kitDiscount) || undefined,
          enrichWithAi,
        }),
      });
      const data = (await readJson(res)) as {
        created?: Array<{ id: string; title: string; price: number }>;
        warnings?: string[];
      } | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      const kit = data.created?.[0];
      setCreatedKits(data.created ?? []);
      setMessage(
        `Kit "${kit?.title}" criado por R$ ${kit?.price.toFixed(2)}.` +
          (data.warnings?.length ? ` Avisos: ${data.warnings.join("; ")}` : "")
      );
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function requestSuggestions() {
    setSuggestBusy(true);
    setMessage(null);
    setError(null);
    setSuggestions(null);
    setSuggestWarnings([]);
    setCreatedKits([]);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/kit-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected.size ? Array.from(selected) : [] }),
      });
      const data = (await readJson(res)) as {
        suggestions?: KitSuggestion[];
        model?: string;
        warnings?: string[];
      } | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      setSuggestions((data.suggestions ?? []).map((s) => ({ ...s, include: true })));
      setSuggestWarnings(data.warnings ?? []);
      setSuggestModel(data.model ?? "");
      if (!data.suggestions?.length) {
        setError("A IA não encontrou combinações de kit para estes anúncios.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestBusy(false);
    }
  }

  function patchSuggestion(index: number, patch: Partial<EditableSuggestion>) {
    setSuggestions((prev) => (prev ? prev.map((s, i) => (i === index ? { ...s, ...patch } : s)) : prev));
  }

  async function createSelectedSuggestions() {
    const chosen = (suggestions ?? []).filter((s) => s.include);
    if (!chosen.length) {
      setError("Marque ao menos uma sugestão para criar");
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    setCreatedKits([]);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrichWithAi,
          kits: chosen.map((s) => ({
            listingIds: s.items.map((i) => i.id),
            title: s.title,
            bundleDiscountPercent: s.discountPercent,
            aiRationale: s.rationale || undefined,
          })),
        }),
      });
      const data = (await readJson(res)) as {
        created?: Array<{ id: string; title: string; price: number }>;
        errors?: string[];
        warnings?: string[];
      } | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      setCreatedKits(data.created ?? []);
      setMessage(
        `${data.created?.length ?? 0} kit(s) criado(s).` +
          (data.errors?.length ? ` ${data.errors.length} falha(s): ${data.errors.join("; ")}` : "") +
          (data.warnings?.length ? ` Avisos: ${data.warnings.join("; ")}` : "")
      );
      setSuggestions(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setIndividualPrice(id: string, price: number) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/${id}/price`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      setMessage(`Preço de ${id} atualizado para R$ ${price.toFixed(2)}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setIndividualMargin(id: string, marginPercent: number) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/${id}/price`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marginPercent }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      setMessage(`Margem de ${marginPercent}% aplicada em ${id} (preço recalculado a partir do custo Meu Drop)`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reviewListing(id: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const data = (await readJson(res)) as { job?: ReviewJobApi } | null;
      if (!res.ok || !data?.job) throw new Error(errorMessage(res, data));
      setMessage(`${id}: revisão enfileirada`);
      void pollReviewJob(data.job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pollReviewJob(jobId: string) {
    try {
      const res = await fetch(`${BP}/api/shopee-listings/review?jobId=${encodeURIComponent(jobId)}`);
      const data = (await readJson(res)) as { job?: ReviewJobApi } | null;
      if (!res.ok || !data?.job) throw new Error(errorMessage(res, data));

      const summary = summarizeReviewJob(data.job);
      setReviewJob(summary);

      if (!REVIEW_TERMINAL_STATUSES.has(summary.status)) {
        reviewPollTimer.current = setTimeout(() => void pollReviewJob(jobId), 1500);
        return;
      }

      setMessage(
        `Revisão concluída: ${summary.success} atualizado(s) · ${summary.skipped} pulado(s) (avulsos ou já atualizados)` +
          (summary.errorCount ? ` · ${summary.errorCount} erro(s): ${summary.errorSamples.join("; ")}` : "")
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReviewJob(null);
    }
  }

  async function reviewSelected() {
    const ids = selected.size ? Array.from(selected) : listings.filter((l) => l.product).map((l) => l.id);
    if (!ids.length) {
      setError("Nenhum anúncio vinculado a produto do Meu Drop para revisar");
      return;
    }
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await readJson(res)) as { job?: ReviewJobApi } | null;
      if (!res.ok || !data?.job) throw new Error(errorMessage(res, data));

      setReviewJob(summarizeReviewJob(data.job));
      void pollReviewJob(data.job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function syncStock() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const ids = selected.size ? Array.from(selected) : undefined;
      const res = await fetch(`${BP}/api/shopee-listings/sync-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await readJson(res)) as
        | { updated?: number; paused?: number; skipped?: number; errors?: string[] }
        | null;
      if (!res.ok || !data) throw new Error(errorMessage(res, data));
      setMessage(
        `Estoque atualizado em ${data.updated ?? 0} anúncio(s)` +
          (data.paused ? ` · ${data.paused} desativado(s) por falta de estoque no Meu Drop` : "") +
          ` · ${data.skipped ?? 0} pulado(s)` +
          (data.errors?.length ? ` · ${data.errors.length} erro(s): ${data.errors.join("; ")}` : "")
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function matchCatalog() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const ids = selected.size ? Array.from(selected) : undefined;
      let res = await fetch(`${BP}/api/shopee-listings/match-catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (GATEWAY_ERROR_STATUSES.has(res.status)) {
        await sleep(1500);
        res = await fetch(`${BP}/api/shopee-listings/match-catalog`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
      }
      const data = (await readJson(res)) as
        | {
            matched?: number;
            skipped?: number;
            ambiguous?: number;
            details?: Array<{ listingTitle: string; productTitle: string; method: string }>;
          }
        | null;
      if (!res.ok || !data) {
        const detail = errorMessage(res, data);
        throw new Error(
          GATEWAY_ERROR_STATUSES.has(res.status)
            ? `${detail} (falha de conexão com o túnel — tente novamente em alguns segundos)`
            : detail
        );
      }
      const sample = (data.details ?? [])
        .slice(0, 5)
        .map((d) => `"${d.listingTitle}" ↔ "${d.productTitle}" (${d.method})`)
        .join(" · ");
      setMessage(
        `${data.matched ?? 0} anúncio(s) vinculado(s) ao catálogo Meu Drop` +
          (sample ? ` — ${sample}${(data.details?.length ?? 0) > 5 ? "…" : ""}` : "") +
          (data.ambiguous ? ` · ${data.ambiguous} ambíguo(s) (revise manualmente)` : "") +
          ` · ${data.skipped ?? 0} sem correspondência`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyIndividualDiscount(id: string) {
    const price = listings.find((l) => l.id === id)?.price;
    const pct = Number(discountPct);
    if (!price || !(pct > 0)) {
      setError("Informe um % de desconto válido");
      return;
    }
    const dealPrice = Math.round(price * (1 - pct / 100) * 100) / 100;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${BP}/api/shopee-listings/${id}/promotions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealPrice }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      setMessage(`Desconto de ${pct}% aplicado em ${id} (R$ ${dealPrice.toFixed(2)})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const reviewRunning = Boolean(reviewJob && !REVIEW_TERMINAL_STATUSES.has(reviewJob.status));
  const reviewPct = reviewJob?.total ? Math.round((reviewJob.done / reviewJob.total) * 100) : 0;
  const showJobsBar = Boolean(oneClickJob?.running || reviewRunning);

  return (
    <div>
      {showJobsBar && (
        <div className="jobs-bar" role="status">
          {oneClickJob?.running && (
            <>
              <strong>One Click</strong>
              <span className="badge ok">{oneClickJob.success} ok</span>
              <span className="badge err">{oneClickJob.failed} falha</span>
              <span className="badge">{oneClickJob.pending} pendente</span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                {oneClickJob.done}/{oneClickJob.total} · {oneClickJob.pct}%
              </strong>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${oneClickJob.pct}%` }} />
              </div>
              <button
                className="btn"
                onClick={() => void oneClickCancelRef.current?.()}
                disabled={oneClickJob.cancelling}
              >
                {oneClickJob.cancelling ? "Cancelando…" : "Cancelar"}
              </button>
              <button className="btn" type="button" onClick={() => setActiveTab("publish")}>
                Ver detalhes
              </button>
            </>
          )}
          {reviewRunning && reviewJob && (
            <>
              {oneClickJob?.running && (
                <span className="spacer" style={{ flexBasis: "100%", height: 0 }} />
              )}
              <strong>Revisão IA</strong>
              <span className="badge ok">{reviewJob.success} ok</span>
              <span className="badge err">{reviewJob.errorCount} falha</span>
              <span className="badge">{Math.max(0, reviewJob.total - reviewJob.done)} pendente</span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                {reviewJob.done}/{reviewJob.total} · {reviewPct}%
              </strong>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${reviewPct}%` }} />
              </div>
              <button className="btn" type="button" onClick={() => setActiveTab("manage")}>
                Ver detalhes
              </button>
            </>
          )}
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Anúncios Shopee</h1>
          <p className="muted">
            Publique pelo One Click do Meu Drop ou gerencie anúncios já no ar pela API da Shopee.
          </p>
        </div>
        {activeTab === "manage" && (
          <div className="toolbar">
            <button
              className="btn btn-accent"
              onClick={() => void requestSuggestions()}
              disabled={busy || suggestBusy}
              title="A IA analisa seus anúncios e sugere combos que fazem sentido vender juntos"
            >
              {suggestBusy ? "Analisando..." : "✨ Sugerir kits com IA"}
            </button>
            <button
              className="btn"
              onClick={() => void syncStock()}
              disabled={busy}
              title="Atualiza o estoque na Shopee conforme o estoque atual do Meu Drop; zerou lá, desativa o anúncio"
            >
              Atualizar estoque (Meu Drop)
            </button>
            <button
              className="btn"
              onClick={() => void matchCatalog()}
              disabled={busy}
              title="Vincula anúncios avulsos (sem produto local) a produtos do catálogo Meu Drop por SKU ou título"
            >
              Sincronizar avulsos com catálogo
            </button>
            <button className="btn btn-primary" onClick={() => void importNow()} disabled={busy}>
              Atualizar agora
            </button>
          </div>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="Anúncios Shopee">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "publish"}
          className={`tab${activeTab === "publish" ? " active" : ""}`}
          onClick={() => setActiveTab("publish")}
        >
          Publicar One Click
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "manage"}
          className={`tab${activeTab === "manage" ? " active" : ""}`}
          onClick={() => setActiveTab("manage")}
        >
          Gerenciar anúncios
        </button>
      </div>

      {message && <div className="alert">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div hidden={activeTab !== "publish"}>
        <OneClickPublishPanel
          marketplace="shopee"
          hideStickyProgress
          onActiveJobChange={handleOneClickJobChange}
          cancelRef={oneClickCancelRef}
          onJobFinished={() => void load()}
        />
      </div>

      {activeTab === "manage" && (
        <>
          <CatalogToolsPanel onCatalogSynced={() => void load()} />

          {createdKits.length > 0 && (
            <div className="alert">
              <strong>Kits criados:</strong>{" "}
              {createdKits.map((k, i) => (
                <Fragment key={k.id}>
                  {i > 0 && " · "}
                  <Link href={`/kits/${k.id}`} style={{ textDecoration: "underline" }}>
                    {k.title}
                  </Link>
                </Fragment>
              ))}
              {" — "}
              <Link href="/kits" style={{ textDecoration: "underline" }}>
                ver todos os kits
              </Link>
            </div>
          )}

          {suggestions !== null && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="filters-head">
                <h3 style={{ margin: 0 }}>
                  {suggestions.length} kit(s) sugerido(s)
                  {suggestModel && <span className="cell-sub"> · modelo {suggestModel}</span>}
                </h3>
                <div className="toolbar">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={enrichWithAi}
                      onChange={(e) => setEnrichWithAi(e.target.checked)}
                    />
                    Preencher categoria/características com IA
                  </label>
                  <button
                    className="btn btn-primary"
                    onClick={() => void createSelectedSuggestions()}
                    disabled={busy || !suggestions.some((s) => s.include)}
                  >
                    Criar {suggestions.filter((s) => s.include).length} kit(s)
                  </button>
                  <button className="btn" onClick={() => setSuggestions(null)} disabled={busy}>
                    Descartar
                  </button>
                </div>
              </div>

              {suggestWarnings.map((w, i) => (
                <div className="alert" key={i}>
                  {w}
                </div>
              ))}

              <div className="suggestion-list">
                {suggestions.map((s, index) => {
                  const { gross, final } = suggestionPricing(s);
                  return (
                    <div
                      className={`suggestion${s.include ? " selected" : ""}`}
                      key={index}
                      style={{ flexDirection: "column", alignItems: "stretch", gap: "0.6rem" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <input
                          type="checkbox"
                          checked={s.include}
                          onChange={(e) => patchSuggestion(index, { include: e.target.checked })}
                        />
                        <input
                          value={s.title}
                          onChange={(e) => patchSuggestion(index, { title: e.target.value })}
                          style={{ flex: "1 1 320px", fontWeight: 600 }}
                          maxLength={120}
                        />
                        <span className="badge soft">{s.title.length}/120</span>
                        <span className={`badge ${s.source === "ai" ? "info" : "warn"}`}>
                          {s.source === "ai" ? "IA" : "por categoria"}
                        </span>
                      </div>

                      {s.rationale && <div className="cell-sub">{s.rationale}</div>}

                      <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                        {s.items.map((item) => (
                          <li key={item.id} className="cell-sub">
                            {item.title} — R$ {item.price.toFixed(2)}
                          </li>
                        ))}
                      </ul>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.35rem" }}>
                          Desconto
                          <input
                            type="number"
                            value={s.discountPercent}
                            onChange={(e) => patchSuggestion(index, { discountPercent: Number(e.target.value) })}
                            style={{ width: 70 }}
                          />
                          %
                        </label>
                        <span>
                          <s className="muted">R$ {gross.toFixed(2)}</s> <strong>R$ {final.toFixed(2)}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
                {!suggestions.length && (
                  <p className="muted">Nenhuma sugestão de kit para os anúncios analisados.</p>
                )}
              </div>
            </div>
          )}

          <div className="filters">
            <div className="filters-head">
              <h2>Filtros</h2>
              <div className="toolbar">
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  {total} anúncio(s) · {counts.matched} vinculado(s) a produto · {counts.kit} em kit ·{" "}
                  {counts.avulso} avulso(s)
                </span>
                <button className="btn" onClick={clearFilters} disabled={loading}>
                  Limpar filtros
                </button>
              </div>
            </div>
            <div className="filter-grid">
              <label className="wide">
                Título, ID ou SKU
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void load(filters, q)}
                  placeholder="Buscar..."
                />
              </label>
              <label>
                Status
                <select value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })}>
                  <option value="">Todos</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Origem local
                <select value={filters.origin} onChange={(e) => patchFilters({ origin: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="matched">Vinculado a produto</option>
                  <option value="kit">Kit</option>
                  <option value="avulso">Avulso</option>
                </select>
              </label>
              <label>
                Estoque
                <select value={filters.stock} onChange={(e) => patchFilters({ stock: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="in">Com estoque</option>
                  <option value="out">Sem estoque</option>
                </select>
              </label>
              <label>
                Faixa de preço
                <span className="range">
                  <input
                    type="number"
                    placeholder="mín."
                    value={filters.priceMin}
                    onChange={(e) => patchFilters({ priceMin: e.target.value })}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="máx."
                    value={filters.priceMax}
                    onChange={(e) => patchFilters({ priceMax: e.target.value })}
                  />
                </span>
              </label>
              <label>
                Faixa de custo (Meu Drop)
                <span className="range">
                  <input
                    type="number"
                    placeholder="mín."
                    value={filters.costMin}
                    onChange={(e) => patchFilters({ costMin: e.target.value })}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="máx."
                    value={filters.costMax}
                    onChange={(e) => patchFilters({ costMax: e.target.value })}
                  />
                </span>
              </label>
              <label>
                Ordenar por
                <select value={filters.sort} onChange={(e) => patchFilters({ sort: e.target.value })}>
                  <option value="updated">Atualização</option>
                  <option value="price">Preço</option>
                  <option value="stock">Estoque</option>
                  <option value="title">Título</option>
                </select>
              </label>
              <label>
                Direção
                <select value={filters.dir} onChange={(e) => patchFilters({ dir: e.target.value })}>
                  <option value="desc">Decrescente</option>
                  <option value="asc">Crescente</option>
                </select>
              </label>
            </div>
            <div className="toggle-row">
              <label className={`toggle${filters.missingSku === "1" ? " on" : ""}`}>
                <input
                  type="checkbox"
                  checked={filters.missingSku === "1"}
                  onChange={(e) => patchFilters({ missingSku: e.target.checked ? "1" : "" })}
                />
                Sem SKU
              </label>
            </div>
          </div>

          <div className="selection-bar">
            <strong>
              {selected.size > 0 ? `${selected.size} selecionado(s)` : "Ações em massa"}
            </strong>
            <span className="spacer" />
            <button
              className="btn"
              onClick={() => setSelected(new Set(listings.map((l) => l.id)))}
              disabled={!listings.length}
              title="Marca todos os anúncios que passaram pelos filtros atuais"
            >
              Selecionar todos filtrados ({listings.length})
            </button>
            {selected.size > 0 && (
              <button className="btn" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </button>
            )}
          </div>

          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>{selected.size} selecionado(s)</strong>
              <input
                type="number"
                placeholder="Preço fixo (R$)"
                value={bulkPrice}
                onChange={(e) => {
                  setBulkPrice(e.target.value);
                  if (e.target.value) setBulkMargin("");
                }}
                style={{ width: 140 }}
              />
              <span className="muted">ou</span>
              <input
                type="number"
                placeholder="Margem %"
                value={bulkMargin}
                onChange={(e) => {
                  setBulkMargin(e.target.value);
                  if (e.target.value) setBulkPrice("");
                }}
                style={{ width: 100 }}
              />
              <button className="btn btn-primary" onClick={() => void applyBulk()} disabled={busy}>
                Aplicar preço ({selected.size})
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </button>
            </div>
          )}

          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>Promoção (desconto %)</strong>
              <input
                type="number"
                placeholder="Desconto %"
                value={bulkDiscountPct}
                onChange={(e) => setBulkDiscountPct(e.target.value)}
                style={{ width: 100 }}
              />
              <button className="btn btn-accent" onClick={() => void applyBulkDiscount()} disabled={busy}>
                Aplicar desconto ({selected.size})
              </button>
              <span className="cell-sub">
                Cada anúncio ganha um Discount próprio na Shopee — falhas em um não travam os demais.
              </span>
            </div>
          )}

          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>Status do anúncio</strong>
              <button
                className="btn"
                style={{ color: "var(--danger, #b42318)" }}
                onClick={() => void applyBulkStatus("paused")}
                disabled={busy}
              >
                Desativar selecionados ({selected.size})
              </button>
              <button className="btn" onClick={() => void applyBulkStatus("active")} disabled={busy}>
                Reativar selecionados ({selected.size})
              </button>
            </div>
          )}

          <div className="selection-bar">
            <strong>Revisar com IA (título, características)</strong>
            <span className="cell-sub">de acordo com o catálogo do Meu Drop</span>
            <button
              className="btn btn-accent"
              onClick={() => void reviewSelected()}
              disabled={Boolean(reviewJob && !REVIEW_TERMINAL_STATUSES.has(reviewJob.status))}
              title="Processa em lotes de 10 anúncios por vez em segundo plano."
            >
              {selected.size ? `Revisar selecionados (${selected.size})` : `Revisar todos vinculados (${counts.matched})`}
            </button>
            <span className="spacer" />
            <span className="cell-sub">Só funciona em anúncios vinculados a produto do Meu Drop.</span>
          </div>

          {reviewJob && (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${reviewJob.total ? Math.round((reviewJob.done / reviewJob.total) * 100) : 0}%` }}
                />
              </div>
              <p className="cell-sub" style={{ margin: "0.5rem 0 0" }}>
                {REVIEW_TERMINAL_STATUSES.has(reviewJob.status) ? "Revisão concluída" : "Revisando em lotes de 10…"}{" "}
                {reviewJob.done}/{reviewJob.total} (
                {reviewJob.total ? Math.round((reviewJob.done / reviewJob.total) * 100) : 0}%) · {reviewJob.success}{" "}
                atualizado(s) · {reviewJob.skipped} pulado(s) · {reviewJob.errorCount} erro(s)
              </p>
            </div>
          )}

          {selected.size > 0 && (
            <div className="selection-bar">
              <strong>Montar kit</strong>
              <label style={{ flexDirection: "row", alignItems: "center", gap: "0.35rem" }}>
                Desconto de combo
                <input
                  type="number"
                  value={kitDiscount}
                  onChange={(e) => setKitDiscount(e.target.value)}
                  style={{ width: 70 }}
                />
                %
              </label>
              <label className="toggle">
                <input type="checkbox" checked={enrichWithAi} onChange={(e) => setEnrichWithAi(e.target.checked)} />
                Preencher categoria/características com IA
              </label>
              <button
                className="btn btn-accent"
                onClick={() => void createKitManual()}
                disabled={busy || selected.size < 2}
              >
                Criar kit ({selected.size})
              </button>
              <span className="cell-sub">
                {selected.size < 2
                  ? "Selecione ao menos 2 anúncios."
                  : "Preço = soma dos anúncios menos o desconto; estoque limitado pelo item mais escasso."}
              </span>
            </div>
          )}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={listings.length > 0 && selected.size === listings.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(listings.map((l) => l.id)) : new Set())}
                    />
                  </th>
                  <th>Foto</th>
                  <th>Anúncio</th>
                  <th>Preço</th>
                  <th>Estoque</th>
                  <th>Status</th>
                  <th>Origem local</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td>
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      </td>
                      <td>
                        {l.thumbnail ? <img src={l.thumbnail} alt="" className="thumb" /> : <div className="thumb" />}
                      </td>
                      <td className="col-product">
                        {l.permalink ? (
                          <a href={l.permalink} target="_blank" rel="noreferrer">
                            {l.title}
                          </a>
                        ) : (
                          l.title
                        )}
                        <div className="cell-sub">
                          {l.id} · {l.itemSku ? `SKU: ${l.itemSku}` : "sem SKU"}
                        </div>
                      </td>
                      <td className="col-num">
                        <PriceInput
                          price={l.price}
                          title="Preço fixo"
                          onCommit={(value) => void setIndividualPrice(l.id, value)}
                        />
                        <input
                          type="number"
                          placeholder="margem %"
                          style={{ width: 90, marginTop: "0.3rem" }}
                          title="Margem % sobre o custo Meu Drop"
                          onBlur={(e) => {
                            const value = Number(e.target.value);
                            if (value > 0) void setIndividualMargin(l.id, value);
                            e.target.value = "";
                          }}
                        />
                      </td>
                      <td className="col-num">{l.stock}</td>
                      <td>
                        <span className={`badge ${l.status === "NORMAL" ? "ok" : l.status === "UNLIST" ? "warn" : ""}`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="cell-sub">
                        {l.product ? `produto: ${l.product.title}` : l.kit ? `kit: ${l.kit.title}` : "avulso"}
                      </td>
                      <td className="badge-row">
                        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.3rem" }}>
                          <input
                            type="number"
                            placeholder="%"
                            value={discountPct}
                            onChange={(e) => setDiscountPct(e.target.value)}
                            style={{ width: 55 }}
                          />
                          <button className="btn" onClick={() => void applyIndividualDiscount(l.id)} disabled={busy}>
                            Desconto
                          </button>
                        </label>
                        <button
                          className="btn"
                          onClick={() => void reviewListing(l.id)}
                          disabled={busy || !l.product}
                          title={
                            l.product
                              ? "Revisa título/características de acordo com o catálogo do Meu Drop"
                              : "Avulso: sem produto do Meu Drop vinculado"
                          }
                        >
                          Revisar
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {!listings.length && (
                  <tr>
                    <td colSpan={8} className="muted">
                      {loading ? "Carregando..." : 'Nenhum anúncio importado ainda. Clique em "Atualizar agora".'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
