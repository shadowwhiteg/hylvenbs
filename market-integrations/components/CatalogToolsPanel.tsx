"use client";

import { useCallback, useEffect, useState } from "react";
import { BP } from "@/lib/base-path";

/**
 * Ferramentas do catálogo Meu Drop reaproveitadas nas abas de marketplace.
 * Vivem no "Antigo Catálogo", mas alimentam tanto a publicação One Click
 * (estoque/custo) quanto a gestão de anúncios, então precisam estar à mão nas
 * duas abas em vez de exigir a volta para a página antiga.
 */

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

function errorMessage(res: Response, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value) return value;
  }
  return `falha HTTP ${res.status}`;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export function CatalogToolsPanel({ onCatalogSynced }: { onCatalogSynced?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState("");

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [stockChanges, setStockChanges] = useState<StockChange[]>([]);
  const [stockChangesOpen, setStockChangesOpen] = useState(false);

  const loadSyncInfo = useCallback(async () => {
    try {
      const res = await fetch(BP + "/api/sync");
      const data = (await readJson(res)) as {
        last?: { status: string; startedAt: string; createdCount?: number; updatedCount?: number };
      } | null;
      if (data?.last) {
        setSyncInfo(
          `Último sync do catálogo: ${data.last.status} · ${new Date(
            data.last.startedAt
          ).toLocaleString("pt-BR")} · ${data.last.updatedCount ?? 0} atualizado(s)`
        );
      }
    } catch {
      // Painel informativo: falhar em silêncio não bloqueia a aba.
    }
  }, []);

  useEffect(() => {
    void loadSyncInfo();
  }, [loadSyncInfo]);

  /** Rescrape do Meu Drop: é daqui que vêm estoque e custo usados no One Click. */
  async function syncCatalog() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(BP + "/api/sync", { method: "POST" });
      const data = (await readJson(res)) as {
        runId?: string;
        alreadyRunning?: boolean;
      } | null;
      if (!res.ok) throw new Error(errorMessage(res, data));

      const runId = data?.runId;
      setMessage(
        data?.alreadyRunning
          ? "Sync já em andamento… aguardando conclusão"
          : "Sync do catálogo iniciado…"
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
          setMessage("Sync em andamento… (scrape do Meu Drop)");
          continue;
        }
        if (last.status === "error") throw new Error(last.error || "Sync falhou");
        setMessage(
          `Sync ${last.status}. Criados: ${last.createdCount ?? 0}, atualizados: ${
            last.updatedCount ?? 0
          }. Estoque e custo dos produtos foram renovados.`
        );
        break;
      }

      await loadSyncInfo();
      onCatalogSynced?.();
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

  async function fetchAnnouncements() {
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
          : `Nenhum comunicado encontrado agora.${
              data?.warnings?.length ? " " + data.warnings.join("; ") : ""
            }`
      );
      await loadAnnouncements();
      setAnnouncementsOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div className="filters-head">
        <div>
          <h3 style={{ margin: 0 }}>Catálogo Meu Drop</h3>
          <p className="cell-sub" style={{ margin: "0.25rem 0 0" }}>
            {syncInfo || "Ainda sem sync do catálogo"}
          </p>
        </div>
        <div className="toolbar">
          <button
            className="btn btn-primary"
            onClick={() => void syncCatalog()}
            disabled={busy}
            title="Rescrape do Meu Drop: renova estoque, custo e títulos. É o que alimenta a seleção do One Click."
          >
            {busy ? "Sincronizando…" : "Atualizar catálogo"}
          </button>
          <button
            className="btn"
            onClick={() => void toggleStockChanges()}
            disabled={busy}
            title="Movimentações de estoque detectadas nos últimos scrapes"
          >
            Alterações de estoque
          </button>
          <button
            className="btn"
            onClick={() => void fetchAnnouncements()}
            disabled={busy}
            title="Busca o comunicado mais recente publicado no Meu Drop"
          >
            Comunicados do Meu Drop
          </button>
          <button className="btn" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
      </div>

      {message && <div className="alert">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {stockChangesOpen && (
        <div style={{ marginTop: "0.75rem" }}>
          <div className="filters-head">
            <h4 style={{ margin: 0 }}>Últimas alterações nos estoques</h4>
            <button className="btn" onClick={() => setStockChangesOpen(false)}>
              Fechar
            </button>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Anterior</th>
                  <th>Novo</th>
                  <th>Delta</th>
                  <th>Detectado</th>
                </tr>
              </thead>
              <tbody>
                {stockChanges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.productTitle}</td>
                    <td>{c.previousStock ?? "—"}</td>
                    <td>{c.newStock ?? "—"}</td>
                    <td>
                      {c.delta == null ? (
                        "—"
                      ) : (
                        <span className={`badge${c.delta > 0 ? " ok" : c.delta < 0 ? " err" : ""}`}>
                          {c.delta > 0 ? `+${c.delta}` : c.delta}
                        </span>
                      )}
                    </td>
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
        </div>
      )}

      {announcementsOpen && (
        <div style={{ marginTop: "0.75rem" }}>
          <div className="filters-head">
            <h4 style={{ margin: 0 }}>Comunicados do MEUDROPBRASIL</h4>
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
          {!announcements.length && <p className="muted">Nenhum comunicado registrado ainda.</p>}
        </div>
      )}
    </div>
  );
}
