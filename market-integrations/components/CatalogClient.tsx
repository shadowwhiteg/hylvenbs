"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BP } from "@/lib/base-path";
import Link from "next/link";
import { countPictures, hasAttributes } from "@/lib/catalog/filters";
import { FieldLabel, HelpTip } from "@/components/HelpTip";
import { CATALOG_FILTER_HELP } from "@/lib/ui/help-texts";

type Draft = {
  price: number;
  title: string;
  attributes?: string;
  categoryId?: string;
  listingTypeId?: string;
  freeShipping?: boolean;
  catalogProductId?: string | null;
  marginPercentOverride?: number | null;
};

type Product = {
  id: string;
  title: string;
  sku?: string | null;
  costPrice: number;
  status: string;
  pictures: string;
  attributesJson?: string;
  stock?: number | null;
  sourceStock?: number | null;
  videoUrl?: string | null;
  mlItemId?: string | null;
  mlPermalink?: string | null;
  draft?: Draft | null;
};

type Counts = {
  byStatus: Record<string, number>;
  published: number;
  notPublished: number;
};

type Announcement = {
  id: string;
  text: string;
  capturedAt: string;
};

type StockChange = {
  id: string;
  productTitle: string;
  previousStock: number | null;
  newStock: number | null;
  delta: number | null;
  detectedAt: string;
};

const PIPELINE_STEP_DEFS: { key: string; label: string }[] = [
  { key: "sync-now", label: "Atualizar agora" },
  { key: "sync-ml", label: "Sync ML" },
  { key: "ai-title", label: "Títulos ML com IA" },
  { key: "ai-attributes", label: "Preencher características com IA" },
  { key: "categorize", label: "Gerar categoryId" },
  { key: "catalog-match", label: "Buscar no catálogo ML" },
  { key: "price-sync", label: "Atualizar preços" },
  { key: "stock-sync", label: "Atualizar estoque" },
];

type ProductsResponse = {
  products?: Product[];
  total?: number;
  page?: number;
  pageSize?: number;
  counts?: Counts;
};

type UiFilters = {
  q: string;
  status: string;
  published: string;
  hasVideo: string;
  hasImages: string;
  missingAttributes: boolean;
  missingCategory: boolean;
  priceMin: string;
  priceMax: string;
  costMin: string;
  costMax: string;
  stock: string;
  hasCatalog: string;
  freeShipping: string;
  listingType: string;
  sort: string;
  dir: string;
};

const EMPTY_FILTERS: UiFilters = {
  q: "",
  status: "",
  published: "",
  hasVideo: "",
  hasImages: "",
  missingAttributes: false,
  missingCategory: false,
  priceMin: "",
  priceMax: "",
  costMin: "",
  costMax: "",
  stock: "",
  hasCatalog: "",
  freeShipping: "",
  listingType: "",
  sort: "updated",
  dir: "desc",
};

const STATUS_OPTIONS = [
  "synced",
  "draft_ready",
  "queued",
  "published",
  "error",
  "unavailable",
] as const;

const LISTING_TYPES = [
  { value: "gold_pro", label: "Premium (gold_pro)" },
  { value: "gold_special", label: "Clássico (gold_special)" },
  { value: "gold", label: "gold" },
] as const;

const PAGE_SIZES = [25, 50, 100, 200] as const;

const TRI_STATE = [
  { value: "", label: "Todos" },
  { value: "1", label: "Sim" },
  { value: "0", label: "Não" },
] as const;

const CHIP_LABELS: Partial<Record<keyof UiFilters, string>> = {
  q: "Busca",
  status: "Status",
  published: "Publicado no ML",
  hasVideo: "Tem vídeo",
  hasImages: "Tem imagens",
  missingAttributes: "Sem características",
  missingCategory: "Sem categoryId",
  priceMin: "Preço mín.",
  priceMax: "Preço máx.",
  costMin: "Custo mín.",
  costMax: "Custo máx.",
  stock: "Estoque",
  hasCatalog: "Match de catálogo",
  freeShipping: "Frete grátis",
  listingType: "Tipo de anúncio",
};

function triLabel(value: string): string {
  return value === "1" ? "Sim" : "Não";
}

function chipValue(key: keyof UiFilters, filters: UiFilters): string {
  const value = filters[key];
  if (typeof value === "boolean") return "sim";
  switch (key) {
    case "published":
      return value === "yes" ? "sim" : "não";
    case "stock":
      return value === "in" ? "com estoque" : "sem estoque";
    case "hasVideo":
    case "hasImages":
    case "hasCatalog":
    case "freeShipping":
      return triLabel(value);
    default:
      return value;
  }
}

function toQuery(filters: UiFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.published) params.set("published", filters.published);
  if (filters.hasVideo) params.set("hasVideo", filters.hasVideo);
  if (filters.hasImages) params.set("hasImages", filters.hasImages);
  if (filters.missingAttributes) params.set("missingAttributes", "1");
  if (filters.missingCategory) params.set("missingCategory", "1");
  if (filters.priceMin) params.set("priceMin", filters.priceMin);
  if (filters.priceMax) params.set("priceMax", filters.priceMax);
  if (filters.costMin) params.set("costMin", filters.costMin);
  if (filters.costMax) params.set("costMax", filters.costMax);
  if (filters.stock) params.set("stock", filters.stock);
  if (filters.hasCatalog) params.set("hasCatalog", filters.hasCatalog);
  if (filters.freeShipping) params.set("freeShipping", filters.freeShipping);
  if (filters.listingType) params.set("listingType", filters.listingType);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.dir) params.set("dir", filters.dir);
  return params;
}

function firstPic(pictures: string): string | null {
  try {
    const arr = JSON.parse(pictures || "[]") as unknown[];
    const first = arr[0];
    return typeof first === "string" ? first : null;
  } catch {
    return null;
  }
}

function errorMessage(res: Response, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value) return value;
  }
  if (res.status === 404) return "recurso indisponível neste servidor (HTTP 404)";
  return `falha HTTP ${res.status}`;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export function CatalogClient() {
  const [filters, setFilters] = useState<UiFilters>(EMPTY_FILTERS);
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>({
    byStatus: {},
    published: 0,
    notPublished: 0,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncInfo, setSyncInfo] = useState<string>("");
  const [mlSyncInfo, setMlSyncInfo] = useState<string>("");
  const [bulkMargin, setBulkMargin] = useState(30);
  const [pushAfterMargin, setPushAfterMargin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [stockChanges, setStockChanges] = useState<StockChange[]>([]);
  const [stockChangesOpen, setStockChangesOpen] = useState(false);

  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<Set<string>>(
    () => new Set(PIPELINE_STEP_DEFS.map((s) => s.key))
  );
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState<{
    index: number;
    total: number;
    label: string;
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  const requestSeq = useRef(0);

  const loadProducts = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const params = toQuery(filters);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`${BP}/api/products?${params}`);
      const data = (await readJson(res)) as ProductsResponse | null;
      if (seq !== requestSeq.current) return;
      if (!res.ok || !data) {
        setError(errorMessage(res, data));
        return;
      }
      setProducts(data.products ?? []);
      setTotal(data.total ?? data.products?.length ?? 0);
      setCounts(data.counts ?? { byStatus: {}, published: 0, notPublished: 0 });
    } catch (e) {
      if (seq === requestSeq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters, page, pageSize]);

  const loadSyncInfo = useCallback(async () => {
    try {
      const syncRes = await fetch(BP + "/api/sync");
      const syncData = (await readJson(syncRes)) as {
        last?: { status: string; startedAt: string };
      } | null;
      if (syncData?.last) {
        setSyncInfo(
          `Último sync: ${syncData.last.status} · ${new Date(syncData.last.startedAt).toLocaleString("pt-BR")}`
        );
      }
      const mlRes = await fetch(BP + "/api/ml-sync");
      const mlData = (await readJson(mlRes)) as {
        last?: { status: string; updatedCount: number; errorCount: number };
      } | null;
      if (mlData?.last) {
        setMlSyncInfo(
          `Último ML sync: ${mlData.last.status} · atualizados ${mlData.last.updatedCount} · erros ${mlData.last.errorCount}`
        );
      }
    } catch {
      // Painel informativo: falhar em silêncio não bloqueia o catálogo.
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    void loadSyncInfo();
  }, [loadSyncInfo]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setFilters((prev) => (prev.q === qInput.trim() ? prev : { ...prev, q: qInput.trim() }));
    }, 350);
    return () => window.clearTimeout(id);
  }, [qInput]);

  function patchFilters(patch: Partial<UiFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setQInput("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  const activeChips = useMemo(() => {
    const keys = Object.keys(CHIP_LABELS) as (keyof UiFilters)[];
    return keys
      .filter((key) => {
        const value = filters[key];
        return typeof value === "boolean" ? value : value !== "";
      })
      .map((key) => ({
        key,
        label: CHIP_LABELS[key] ?? String(key),
        value: typeof filters[key] === "boolean" ? "" : chipValue(key, filters),
      }));
  }, [filters]);

  function removeChip(key: keyof UiFilters) {
    if (key === "q") setQInput("");
    const reset = EMPTY_FILTERS[key];
    patchFilters({ [key]: reset } as Partial<UiFilters>);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  const pageAllSelected = useMemo(
    () => products.length > 0 && products.every((p) => selected.has(p.id)),
    [products, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) products.forEach((p) => next.delete(p.id));
      else products.forEach((p) => next.add(p.id));
      return next;
    });
  }

  async function selectAllFiltered() {
    setBusy(true);
    setError(null);
    try {
      const params = toQuery(filters);
      params.set("idsOnly", "1");
      const res = await fetch(`${BP}/api/products?${params}`);
      const data = (await readJson(res)) as { ids?: string[] } | null;
      if (!res.ok || !data?.ids) throw new Error(errorMessage(res, data));
      setSelected(new Set(data.ids));
      setMessage(`${data.ids.length} produto(s) selecionado(s)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(BP + "/api/sync", { method: "POST" });
      const data = (await readJson(res)) as {
        runId?: string;
        status?: string;
        alreadyRunning?: boolean;
        run?: { createdCount?: number; updatedCount?: number };
      } | null;
      if (!res.ok) throw new Error(errorMessage(res, data));

      const runId = data?.runId;
      setMessage(
        data?.alreadyRunning
          ? "Sync já em andamento… aguardando conclusão"
          : "Sync iniciado em segundo plano…"
      );

      const startedAt = Date.now();
      const maxWaitMs = 15 * 60_000;
      while (Date.now() - startedAt < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 2500));
        const pollRes = await fetch(BP + "/api/sync");
        const pollData = (await readJson(pollRes)) as {
          last?: {
            id: string;
            status: string;
            createdCount?: number;
            updatedCount?: number;
            error?: string | null;
          };
        } | null;
        const last = pollData?.last;
        if (!last) continue;
        if (runId && last.id !== runId) continue;
        if (last.status === "running") {
          setMessage("Sync em andamento… (scrape do Meu Drop + IA)");
          continue;
        }
        if (last.status === "error") {
          throw new Error(last.error || "Sync falhou");
        }
        setMessage(
          `Sync ${last.status}. Criados: ${last.createdCount ?? 0}, atualizados: ${last.updatedCount ?? 0}`
        );
        break;
      }

      await Promise.all([loadProducts(), loadSyncInfo()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function mlSyncNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(BP + "/api/ml-sync", { method: "POST" });
      const data = (await readJson(res)) as {
        status?: string;
        run?: { updatedCount?: number; skippedCount?: number; errorCount?: number };
      } | null;
      if (!res.ok) throw new Error(errorMessage(res, data));
      setMessage(
        `ML sync ${data?.status ?? "ok"}: atualizados ${data?.run?.updatedCount ?? 0}, pulados ${data?.run?.skippedCount ?? 0}, erros ${data?.run?.errorCount ?? 0}`
      );
      await Promise.all([loadProducts(), loadSyncInfo()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runAnnouncementsScrape() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(BP + "/api/meudrop/announcements", { method: "POST" });
      const data = (await readJson(res)) as {
        found?: boolean;
        saved?: boolean;
        warnings?: string[];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(errorMessage(res, data));
      if (data?.error) throw new Error(data.error);
      setMessage(
        data?.found
          ? data.saved
            ? "Novo comunicado capturado e registrado."
            : "Comunicado capturado (igual ao último já registrado)."
          : `Nenhum comunicado encontrado agora.${data?.warnings?.length ? " " + data.warnings.join("; ") : ""}`
      );
      await loadAnnouncements();
      setAnnouncementsOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadAnnouncements() {
    try {
      const res = await fetch(BP + "/api/meudrop/announcements");
      const data = (await readJson(res)) as { announcements?: Announcement[] } | null;
      setAnnouncements(data?.announcements ?? []);
    } catch {
      // painel informativo, falha silenciosa
    }
  }

  async function toggleStockChanges() {
    const next = !stockChangesOpen;
    setStockChangesOpen(next);
    if (next && !stockChanges.length) {
      try {
        const res = await fetch(BP + "/api/stock-changes");
        const data = (await readJson(res)) as { changes?: StockChange[] } | null;
        setStockChanges(data?.changes ?? []);
      } catch {
        // painel informativo, falha silenciosa
      }
    }
  }

  async function applyBulkMargin() {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(BP + "/api/products/bulk-margin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: Array.from(selected),
          marginPercent: bulkMargin,
          pushToMl: pushAfterMargin,
          setOverride: true,
        }),
      });
      const data = (await readJson(res)) as {
        updated?: number;
        mlSync?: { updatedCount: number };
      } | null;
      if (!res.ok) throw new Error(errorMessage(res, data));
      setMessage(
        `Margem ${bulkMargin}% aplicada em ${data?.updated ?? 0} produto(s)` +
          (pushAfterMargin && data?.mlSync ? ` · ML: ${data.mlSync.updatedCount} atualizados` : "")
      );
      await loadProducts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBulkProductAction(
    path: "ai-attributes" | "catalog-match" | "ai-title" | "categorize" | "price-sync" | "stock-sync",
    label: string,
    body: Record<string, unknown>
  ) {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += 1) {
        const percent = Math.round(((i + 1) / ids.length) * 100);
        setProgress(`${label}: ${i + 1}/${ids.length} (${percent}%)`);
        try {
          const res = await fetch(`${BP}/api/products/${ids[i]}/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await readJson(res);
          if (!res.ok) {
            failures.push(errorMessage(res, data));
            continue;
          }
          ok += 1;
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }
      const summary = `${label}: ${ok}/${ids.length} concluído(s)`;
      if (failures.length) {
        setError(`${summary}. Primeira falha: ${failures[0]}`);
      } else {
        setMessage(summary);
      }
      await loadProducts();
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(BP + "/api/products/export");
      if (!res.ok) throw new Error(errorMessage(res, await readJson(res)));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `catalogo-meudrop-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  function togglePipelineStep(key: string) {
    setPipelineSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function runPipeline() {
    const steps = PIPELINE_STEP_DEFS.filter((s) => pipelineSteps.has(s.key));
    if (!steps.length || pipelineRunning) return;
    setPipelineRunning(true);
    try {
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        setPipelineProgress({ index: i, total: steps.length, label: step.label });
        switch (step.key) {
          case "sync-now":
            await syncNow();
            break;
          case "sync-ml":
            await mlSyncNow();
            break;
          case "ai-title":
            await runBulkProductAction("ai-title", "Títulos ML com IA", { apply: true });
            break;
          case "ai-attributes":
            await runBulkProductAction("ai-attributes", "Características com IA", { apply: true });
            break;
          case "categorize":
            await runBulkProductAction("categorize", "Gerar categoryId", { apply: true });
            break;
          case "catalog-match":
            await runBulkProductAction("catalog-match", "Match de catálogo", {});
            break;
          case "price-sync":
            await runBulkProductAction("price-sync", "Atualizar preços", {});
            break;
          case "stock-sync":
            await runBulkProductAction("stock-sync", "Atualizar estoque", {});
            break;
        }
      }
      setPipelineProgress({ index: steps.length, total: steps.length, label: "Concluído" });
    } finally {
      setPipelineRunning(false);
      setTimeout(() => setPipelineProgress(null), 3000);
    }
  }

  async function publishSelected() {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(BP + "/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: Array.from(selected) }),
      });
      const data = (await readJson(res)) as {
        job?: { id: string; items: unknown[] };
      } | null;
      if (!res.ok || !data?.job) throw new Error(errorMessage(res, data));
      setMessage(`Job ${data.job.id} criado com ${data.job.items.length} itens`);
      setSelected(new Set());
      await loadProducts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createKit() {
    if (selected.size < 2) {
      setError("Selecione ao menos 2 produtos para criar um kit");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(BP + "/api/kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: Array.from(selected) }),
      });
      const data = (await readJson(res)) as { kit?: { id: string } } | null;
      if (!res.ok || !data?.kit) throw new Error(errorMessage(res, data));
      window.location.href = `/kits/${data.kit.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Antigo Catálogo</h1>
          <p className="muted">{syncInfo || "Ainda sem sync"}</p>
          {mlSyncInfo && <p className="muted">{mlSyncInfo}</p>}
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => void syncNow()} disabled={busy}>
            Atualizar agora
          </button>
          <button className="btn" onClick={() => void mlSyncNow()} disabled={busy}>
            Sync ML
          </button>
          <button className="btn" onClick={() => void runAnnouncementsScrape()} disabled={busy}>
            Últimos comunicados do MEUDROPBRASIL
          </button>
          <button className="btn" onClick={() => void toggleStockChanges()} disabled={busy}>
            Últimas alterações nos estoques
          </button>
          <button className="btn btn-accent" onClick={() => void createKit()} disabled={busy}>
            Criar kit
          </button>
          <button className="btn" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void publishSelected()}
            disabled={busy || !selected.size}
          >
            Publicar ({selected.size})
          </button>
          <button
            className="btn btn-accent"
            onClick={() => setPipelineOpen((v) => !v)}
            disabled={pipelineRunning}
          >
            Executar em sequência
          </button>
        </div>
      </div>

      {pipelineOpen && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="filters-head">
            <h3 style={{ margin: 0 }}>Executar em sequência</h3>
            <button className="btn" onClick={() => setPipelineOpen(false)} disabled={pipelineRunning}>
              Fechar
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            As etapas marcadas rodam em ordem, uma após a outra. As etapas de IA/preço/estoque/categoria
            atuam sobre os {selected.size} produto(s) selecionado(s).
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.75rem" }}>
            {PIPELINE_STEP_DEFS.map((step) => (
              <label
                key={step.key}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}
              >
                <input
                  type="checkbox"
                  checked={pipelineSteps.has(step.key)}
                  onChange={() => togglePipelineStep(step.key)}
                  disabled={pipelineRunning}
                />
                {step.label}
              </label>
            ))}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void runPipeline()}
            disabled={pipelineRunning || busy || !pipelineSteps.size}
          >
            {pipelineRunning ? "Executando…" : "Executar selecionados"}
          </button>
          {pipelineProgress && (
            <div style={{ marginTop: "0.75rem" }}>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${
                      pipelineProgress.total
                        ? Math.round((pipelineProgress.index / pipelineProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="cell-sub" style={{ margin: "0.5rem 0 0" }}>
                {pipelineProgress.index}/{pipelineProgress.total} ·{" "}
                {pipelineProgress.index >= pipelineProgress.total
                  ? "Concluído"
                  : `Executando: ${pipelineProgress.label}`}
              </p>
            </div>
          )}
        </div>
      )}

      {progress && <div className="alert">{progress}</div>}
      {message && <div className="alert">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {announcementsOpen && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="filters-head">
            <h3 style={{ margin: 0 }}>Últimos comunicados do MEUDROPBRASIL</h3>
            <button className="btn" onClick={() => setAnnouncementsOpen(false)}>
              Fechar
            </button>
          </div>
          {announcements.map((a) => (
            <div key={a.id} className="suggestion" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="cell-sub">{new Date(a.capturedAt).toLocaleString("pt-BR")}</div>
                <div>{a.text}</div>
              </div>
            </div>
          ))}
          {!announcements.length && (
            <p className="muted">Nenhum comunicado registrado ainda.</p>
          )}
        </div>
      )}

      {stockChangesOpen && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="filters-head">
            <h3 style={{ margin: 0 }}>Últimas alterações nos estoques</h3>
            <button className="btn" onClick={() => setStockChangesOpen(false)}>
              Fechar
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Registrado automaticamente a cada 12h.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Estoque anterior</th>
                <th>Estoque novo</th>
                <th>Delta</th>
                <th>Quando</th>
              </tr>
            </thead>
            <tbody>
              {stockChanges.map((c) => (
                <tr key={c.id}>
                  <td>{c.productTitle}</td>
                  <td className="col-num">{c.previousStock ?? "—"}</td>
                  <td className="col-num">{c.newStock ?? "—"}</td>
                  <td className="col-num">{c.delta != null ? (c.delta > 0 ? `+${c.delta}` : c.delta) : "—"}</td>
                  <td>{new Date(c.detectedAt).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
              {!stockChanges.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    Nenhuma alteração registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <section className="filters" aria-label="Filtros do catálogo">
        <div className="filters-head">
          <h2>Filtros</h2>
          <div className="toolbar">
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {counts.published} publicado(s) · {counts.notPublished} não publicado(s)
            </span>
            <button className="btn" onClick={clearFilters} disabled={busy}>
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="filter-grid">
          <label className="wide" htmlFor="f-q">
            <FieldLabel help={CATALOG_FILTER_HELP.q}>Buscar (título ou SKU)</FieldLabel>
            <input
              id="f-q"
              value={qInput}
              placeholder="Ex.: fone bluetooth ou SKU-123"
              onChange={(e) => setQInput(e.target.value)}
            />
          </label>

          <label htmlFor="f-status">
            <FieldLabel help={CATALOG_FILTER_HELP.status}>Status</FieldLabel>
            <select
              id="f-status"
              value={filters.status}
              onChange={(e) => patchFilters({ status: e.target.value })}
            >
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                  {counts.byStatus[s] !== undefined ? ` (${counts.byStatus[s]})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="f-published">
            <FieldLabel help={CATALOG_FILTER_HELP.published}>Publicado no ML</FieldLabel>
            <select
              id="f-published"
              value={filters.published}
              onChange={(e) => patchFilters({ published: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="yes">Sim</option>
              <option value="no">Não</option>
            </select>
          </label>

          <label htmlFor="f-hasVideo">
            <FieldLabel help={CATALOG_FILTER_HELP.hasVideo}>Tem vídeo</FieldLabel>
            <select
              id="f-hasVideo"
              value={filters.hasVideo}
              onChange={(e) => patchFilters({ hasVideo: e.target.value })}
            >
              {TRI_STATE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="f-hasImages">
            <FieldLabel help={CATALOG_FILTER_HELP.hasImages}>Tem imagens</FieldLabel>
            <select
              id="f-hasImages"
              value={filters.hasImages}
              onChange={(e) => patchFilters({ hasImages: e.target.value })}
            >
              {TRI_STATE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="f-stock">
            <FieldLabel help={CATALOG_FILTER_HELP.stock}>Estoque</FieldLabel>
            <select
              id="f-stock"
              value={filters.stock}
              onChange={(e) => patchFilters({ stock: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="in">Com estoque</option>
              <option value="out">Sem estoque</option>
            </select>
          </label>

          <label htmlFor="f-hasCatalog">
            <FieldLabel help={CATALOG_FILTER_HELP.hasCatalog}>Match de catálogo</FieldLabel>
            <select
              id="f-hasCatalog"
              value={filters.hasCatalog}
              onChange={(e) => patchFilters({ hasCatalog: e.target.value })}
            >
              {TRI_STATE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="f-freeShipping">
            <FieldLabel help={CATALOG_FILTER_HELP.freeShipping}>Frete grátis</FieldLabel>
            <select
              id="f-freeShipping"
              value={filters.freeShipping}
              onChange={(e) => patchFilters({ freeShipping: e.target.value })}
            >
              {TRI_STATE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="f-listingType">
            <FieldLabel help={CATALOG_FILTER_HELP.listingType}>Tipo de anúncio</FieldLabel>
            <select
              id="f-listingType"
              value={filters.listingType}
              onChange={(e) => patchFilters({ listingType: e.target.value })}
            >
              <option value="">Todos</option>
              {LISTING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <FieldLabel help={CATALOG_FILTER_HELP.priceRange}>
              <span className="muted" style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                Faixa de preço
              </span>
            </FieldLabel>
            <div className="range" style={{ marginTop: "0.35rem" }}>
              <input
                type="number"
                aria-label="Preço mínimo"
                placeholder="mín."
                value={filters.priceMin}
                onChange={(e) => patchFilters({ priceMin: e.target.value })}
              />
              <span>–</span>
              <input
                type="number"
                aria-label="Preço máximo"
                placeholder="máx."
                value={filters.priceMax}
                onChange={(e) => patchFilters({ priceMax: e.target.value })}
              />
            </div>
          </div>

          <div>
            <FieldLabel help={CATALOG_FILTER_HELP.costRange}>
              <span className="muted" style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                Faixa de custo
              </span>
            </FieldLabel>
            <div className="range" style={{ marginTop: "0.35rem" }}>
              <input
                type="number"
                aria-label="Custo mínimo"
                placeholder="mín."
                value={filters.costMin}
                onChange={(e) => patchFilters({ costMin: e.target.value })}
              />
              <span>–</span>
              <input
                type="number"
                aria-label="Custo máximo"
                placeholder="máx."
                value={filters.costMax}
                onChange={(e) => patchFilters({ costMax: e.target.value })}
              />
            </div>
          </div>

          <label htmlFor="f-sort">
            <FieldLabel help={CATALOG_FILTER_HELP.sort}>Ordenar por</FieldLabel>
            <select
              id="f-sort"
              value={filters.sort}
              onChange={(e) => patchFilters({ sort: e.target.value })}
            >
              <option value="updated">Atualização</option>
              <option value="title">Título</option>
              <option value="price">Preço do draft</option>
              <option value="cost">Custo</option>
              <option value="stock">Estoque</option>
            </select>
          </label>

          <label htmlFor="f-dir">
            <FieldLabel help={CATALOG_FILTER_HELP.dir}>Direção</FieldLabel>
            <select
              id="f-dir"
              value={filters.dir}
              onChange={(e) => patchFilters({ dir: e.target.value })}
            >
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
            </select>
          </label>
        </div>

        <div className="toggle-row">
          <label className={`toggle${filters.missingAttributes ? " on" : ""}`}>
            <input
              type="checkbox"
              checked={filters.missingAttributes}
              onChange={(e) => patchFilters({ missingAttributes: e.target.checked })}
            />
            Sem características
            <HelpTip text={CATALOG_FILTER_HELP.missingAttributes} />
          </label>
          <label className={`toggle${filters.missingCategory ? " on" : ""}`}>
            <input
              type="checkbox"
              checked={filters.missingCategory}
              onChange={(e) => patchFilters({ missingCategory: e.target.checked })}
            />
            Sem categoryId
            <HelpTip text={CATALOG_FILTER_HELP.missingCategory} />
          </label>
        </div>

        {activeChips.length > 0 && (
          <div className="chips">
            {activeChips.map((chip) => (
              <span className="chip" key={chip.key}>
                {chip.value ? `${chip.label}: ${chip.value}` : chip.label}
                <button
                  type="button"
                  aria-label={`Remover filtro ${chip.label}`}
                  onClick={() => removeChip(chip.key)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="selection-bar">
        <strong>{selected.size} selecionado(s)</strong>
        <button className="btn" onClick={() => void selectAllFiltered()} disabled={busy || !total}>
          Selecionar todos os filtrados ({total})
        </button>
        <button
          className="btn"
          onClick={() => setSelected(new Set())}
          disabled={busy || !selected.size}
        >
          Limpar seleção
        </button>
        <span className="spacer" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            className="btn"
            onClick={() =>
              void runBulkProductAction("ai-title", "Títulos ML com IA", { apply: true })
            }
            disabled={busy || !selected.size}
          >
            Títulos ML com IA
          </button>
          <HelpTip text={CATALOG_FILTER_HELP.aiTitle} />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            className="btn"
            onClick={() =>
              void runBulkProductAction("ai-attributes", "Características com IA", { apply: true })
            }
            disabled={busy || !selected.size}
          >
            Preencher características com IA
          </button>
          <HelpTip text={CATALOG_FILTER_HELP.aiAttributes} />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            className="btn"
            onClick={() =>
              void runBulkProductAction("categorize", "Gerar categoryId", { apply: true })
            }
            disabled={busy || !selected.size}
          >
            Gerar categoryId
          </button>
          <HelpTip text={CATALOG_FILTER_HELP.aiCategory} />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            className="btn"
            onClick={() => void runBulkProductAction("catalog-match", "Match de catálogo", {})}
            disabled={busy || !selected.size}
          >
            Buscar no catálogo ML
          </button>
          <HelpTip text={CATALOG_FILTER_HELP.catalogMatch} />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            className="btn"
            onClick={() => void runBulkProductAction("price-sync", "Atualizar preços", {})}
            disabled={busy || !selected.size}
          >
            Atualizar preços
          </button>
          <HelpTip text={CATALOG_FILTER_HELP.priceSync} />
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
          <button
            className="btn"
            onClick={() => void runBulkProductAction("stock-sync", "Atualizar estoque", {})}
            disabled={busy || !selected.size}
          >
            Atualizar estoque
          </button>
          <HelpTip text={CATALOG_FILTER_HELP.stockSync} />
        </span>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <label style={{ margin: 0 }} htmlFor="bulk-margin">
            <FieldLabel help={CATALOG_FILTER_HELP.bulkMargin}>Margem em massa (%)</FieldLabel>
          </label>
          <input
            id="bulk-margin"
            type="number"
            style={{ width: 100 }}
            value={bulkMargin}
            onChange={(e) => setBulkMargin(Number(e.target.value))}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <input
              type="checkbox"
              checked={pushAfterMargin}
              onChange={(e) => setPushAfterMargin(e.target.checked)}
            />
            Empurrar para ML após aplicar
            <HelpTip text={CATALOG_FILTER_HELP.pushAfterMargin} />
          </label>
          <button
            className="btn btn-accent"
            onClick={() => void applyBulkMargin()}
            disabled={busy || !selected.size}
          >
            Aplicar margem ({selected.size})
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Selecionar produtos desta página"
                    checked={pageAllSelected}
                    onChange={togglePage}
                  />
                </th>
                <th>Foto</th>
                <th className="col-product">Produto</th>
                <th className="col-sku">SKU</th>
                <th className="col-num">Custo</th>
                <th className="col-num">Estoque</th>
                <th className="col-num">Preço draft</th>
                <th>Fotos</th>
                <th>Vídeo</th>
                <th>Caract.</th>
                <th>Category ID</th>
                <th>Catálogo</th>
                <th>Anúncio</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const pic = firstPic(p.pictures);
                const photos = countPictures(p.pictures);
                const attrsOk = hasAttributes({
                  pictures: p.pictures,
                  attributesJson: p.attributesJson ?? "[]",
                  draft: p.draft ? { attributes: p.draft.attributes ?? "[]" } : null,
                });
                const video = p.videoUrl ?? "";
                return (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${p.draft?.title || p.title}`}
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                    </td>
                    <td>
                      {pic ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="thumb" src={pic} alt="" />
                      ) : (
                        <div className="thumb" />
                      )}
                    </td>
                    <td className="col-product">
                      <strong>{p.title}</strong>
                      {p.draft?.title && p.draft.title !== p.title && (
                        <span className="cell-sub" style={{ display: "block" }}>
                          ML: {p.draft.title} ({p.draft.title.length}/60)
                        </span>
                      )}
                      {!p.draft?.categoryId && (
                        <div className="badge-row" style={{ marginTop: "0.25rem" }}>
                          <span className="badge warn">sem categoryId</span>
                        </div>
                      )}
                      {p.draft?.categoryId && (
                        <span className="cell-sub" style={{ display: "block" }}>
                          categoryId: {p.draft.categoryId}
                        </span>
                      )}
                      {p.mlPermalink && (
                        <div>
                          <a href={p.mlPermalink} target="_blank" rel="noreferrer">
                            Ver no ML
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="cell-sub col-sku">
                      <span title={p.sku || undefined}>{p.sku || "—"}</span>
                    </td>
                    <td className="col-num">R$ {p.costPrice.toFixed(2)}</td>
                    <td className="col-num">
                      {p.stock ?? "—"}
                      {p.sourceStock != null && p.sourceStock !== p.stock && (
                        <div className="cell-sub" title={`Estoque Meu Drop: ${p.sourceStock}`}>
                          de {p.sourceStock}
                        </div>
                      )}
                    </td>
                    <td className="col-num">
                      R$ {(p.draft?.price ?? 0).toFixed(2)}
                      {p.draft?.marginPercentOverride != null && (
                        <div className="cell-sub">margem {p.draft.marginPercentOverride}%</div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${photos ? "soft" : "warn"}`}>{photos}</span>
                    </td>
                    <td>
                      {video ? (
                        <a href={video} target="_blank" rel="noreferrer" className="badge info">
                          vídeo
                        </a>
                      ) : (
                        <span className="cell-sub">—</span>
                      )}
                    </td>
                    <td>
                      {attrsOk ? (
                        <span className="badge ok">ok</span>
                      ) : (
                        <span className="badge warn">faltando</span>
                      )}
                    </td>
                    <td>
                      {p.draft?.categoryId ? (
                        <span className="badge info">{p.draft.categoryId}</span>
                      ) : (
                        <span className="badge warn">faltando</span>
                      )}
                    </td>
                    <td>
                      {p.draft?.catalogProductId ? (
                        <span className="badge info">{p.draft.catalogProductId}</span>
                      ) : (
                        <span className="cell-sub">—</span>
                      )}
                    </td>
                    <td>
                      <span className="badge soft">{p.draft?.listingTypeId ?? "—"}</span>
                      {p.draft?.freeShipping && (
                        <div className="badge-row" style={{ marginTop: "0.25rem" }}>
                          <span className="badge ok">frete grátis</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${p.status === "published" ? "ok" : p.status === "error" ? "err" : ""}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td>
                      <Link className="btn" href={`/products/${p.id}`}>
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!products.length && (
                <tr>
                  <td colSpan={14} className="muted">
                    {loading
                      ? "Carregando…"
                      : activeChips.length
                        ? "Nenhum produto para os filtros aplicados."
                        : 'Nenhum produto. Clique em "Atualizar agora" para sincronizar o Meu Drop.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span className="muted">
            {rangeFrom}–{rangeTo} de {total}
          </span>
          <div className="pages">
            <button
              className="btn"
              onClick={() => setPage(1)}
              disabled={page <= 1 || loading}
              aria-label="Primeira página"
            >
              «
            </button>
            <button
              className="btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Anterior
            </button>
            <span className="muted">
              Página {page} de {totalPages}
            </span>
            <button
              className="btn"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Próxima
            </button>
            <button
              className="btn"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || loading}
              aria-label="Última página"
            >
              »
            </button>
          </div>
          <label className="page-size" htmlFor="page-size">
            Por página
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
