"use client";

import { useEffect, useState } from "react";

type Job = {
  id: string;
  status: string;
  createdAt: string;
  finishedAt?: string | null;
  items: {
    id: string;
    status: string;
    error?: string | null;
    mlItemId?: string | null;
    productId?: string | null;
    kitId?: string | null;
  }[];
};

type ShopeeJob = {
  id: string;
  status: string;
  createdAt: string;
  finishedAt?: string | null;
  items: {
    id: string;
    status: string;
    error?: string | null;
    shopeeItemId?: string | null;
    productId?: string | null;
    kitId?: string | null;
  }[];
};

type MlSyncRun = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  error?: string | null;
};

export function PublishClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shopeeJobs, setShopeeJobs] = useState<ShopeeJob[]>([]);
  const [mlRuns, setMlRuns] = useState<MlSyncRun[]>([]);
  const [shopeeRuns, setShopeeRuns] = useState<MlSyncRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/publish");
    const data = await res.json();
    setJobs(data.jobs || []);
    const mlRes = await fetch("/api/ml-sync");
    const mlData = await mlRes.json();
    setMlRuns(mlData.recent || (mlData.last ? [mlData.last] : []));

    const shopeeJobsRes = await fetch("/api/shopee-publish");
    const shopeeJobsData = await shopeeJobsRes.json();
    setShopeeJobs(shopeeJobsData.jobs || []);
    const shopeeRes = await fetch("/api/shopee-sync");
    const shopeeData = await shopeeRes.json();
    setShopeeRuns(shopeeData.recent || (shopeeData.last ? [shopeeData.last] : []));
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, []);

  async function runMlSync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ml-sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha");
      setMessage(
        `ML sync ${data.status}: ${data.run?.updatedCount ?? 0} atualizados, ${data.run?.errorCount ?? 0} erros`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runShopeeSync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/shopee-sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha");
      setMessage(
        `Shopee sync ${data.status}: ${data.run?.updatedCount ?? 0} atualizados, ${data.run?.errorCount ?? 0} erros`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearPublishJobs() {
    if (
      !window.confirm(
        "Apagar todos os jobs de publicação (e seus itens)? Esta ação não pode ser desfeita."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/publish", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao limpar jobs");
      setMessage(`Jobs de publicação limpos (${data.deleted ?? 0} removidos).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearSyncHistory() {
    if (
      !window.confirm(
        "Apagar o histórico de syncs (ML e catálogo)? Esta ação não pode ser desfeita."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const [mlRes, syncRes] = await Promise.all([
        fetch("/api/ml-sync", { method: "DELETE" }),
        fetch("/api/sync", { method: "DELETE" }),
      ]);
      const mlData = await mlRes.json();
      const syncData = await syncRes.json();
      if (!mlRes.ok) throw new Error(mlData.error || "Falha ao limpar syncs ML");
      if (!syncRes.ok) throw new Error(syncData.error || "Falha ao limpar syncs do catálogo");
      setMessage(
        `Histórico de syncs limpo (ML: ${mlData.deleted ?? 0}, catálogo: ${syncData.deleted ?? 0}).`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Publicações</h1>
          <p className="muted">
            Fila de jobs e histórico de sync de anúncios ML. Em falhas de publicação, a IA tenta
            corrigir o rascunho e republicar automaticamente (até 2 vezes por item).
          </p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => void load()} disabled={busy}>
            Atualizar
          </button>
          <button className="btn" onClick={() => void clearPublishJobs()} disabled={busy}>
            Limpar jobs de publicação
          </button>
          <button className="btn" onClick={() => void clearSyncHistory()} disabled={busy}>
            Limpar histórico de syncs
          </button>
          <button className="btn btn-primary" onClick={() => void runMlSync()} disabled={busy}>
            Sync ML agora
          </button>
          <button className="btn btn-primary" onClick={() => void runShopeeSync()} disabled={busy}>
            Sync Shopee agora
          </button>
        </div>
      </div>

      {message && <div className="alert">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Últimos syncs ML (preço/estoque)</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Status</th>
              <th>Atualizados</th>
              <th>Pulados</th>
              <th>Erros</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {mlRuns.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.startedAt).toLocaleString("pt-BR")}</td>
                <td>
                  <span className={`badge ${r.status === "success" ? "ok" : r.status === "error" ? "err" : ""}`}>
                    {r.status}
                  </span>
                </td>
                <td>{r.updatedCount}</td>
                <td>{r.skippedCount}</td>
                <td>{r.errorCount}</td>
                <td className="muted" style={{ maxWidth: 280, fontSize: "0.85rem" }}>
                  {r.error || "—"}
                </td>
              </tr>
            ))}
            {!mlRuns.length && (
              <tr>
                <td colSpan={6} className="muted">
                  Nenhum sync ML ainda. Rode o sync do catálogo ou clique em &quot;Sync ML agora&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Jobs de publicação</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Itens</th>
              <th>Criado</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  <code>{j.id.slice(0, 8)}</code>
                </td>
                <td>
                  <span className={`badge ${j.status === "success" ? "ok" : j.status === "error" ? "err" : ""}`}>
                    {j.status}
                  </span>
                </td>
                <td>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {j.items.map((i) => (
                      <li key={i.id}>
                        {i.productId ? "produto" : "kit"} · {i.status}
                        {i.mlItemId ? ` · ${i.mlItemId}` : ""}
                        {i.error ? (
                          <span
                            className="muted"
                            style={{ display: "block", maxWidth: 420, fontSize: "0.85rem" }}
                            title={i.error}
                          >
                            {i.error.includes("correção") || i.error.includes("IA:")
                              ? `Falhou após correção por IA · ${i.error}`
                              : i.error}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{new Date(j.createdAt).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {!jobs.length && (
              <tr>
                <td colSpan={4} className="muted">
                  Nenhum job ainda. Selecione produtos no Catálogo e clique em Publicar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Últimos syncs Shopee (preço/estoque)</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Status</th>
              <th>Atualizados</th>
              <th>Pulados</th>
              <th>Erros</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {shopeeRuns.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.startedAt).toLocaleString("pt-BR")}</td>
                <td>
                  <span className={`badge ${r.status === "success" ? "ok" : r.status === "error" ? "err" : ""}`}>
                    {r.status}
                  </span>
                </td>
                <td>{r.updatedCount}</td>
                <td>{r.skippedCount}</td>
                <td>{r.errorCount}</td>
                <td className="muted" style={{ maxWidth: 280, fontSize: "0.85rem" }}>
                  {r.error || "—"}
                </td>
              </tr>
            ))}
            {!shopeeRuns.length && (
              <tr>
                <td colSpan={6} className="muted">
                  Nenhum sync Shopee ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Jobs de publicação Shopee</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Itens</th>
              <th>Criado</th>
            </tr>
          </thead>
          <tbody>
            {shopeeJobs.map((j) => (
              <tr key={j.id}>
                <td>
                  <code>{j.id.slice(0, 8)}</code>
                </td>
                <td>
                  <span className={`badge ${j.status === "success" ? "ok" : j.status === "error" ? "err" : ""}`}>
                    {j.status}
                  </span>
                </td>
                <td>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {j.items.map((i) => (
                      <li key={i.id}>
                        {i.productId ? "produto" : "kit"} · {i.status}
                        {i.shopeeItemId ? ` · ${i.shopeeItemId}` : ""}
                        {i.error ? ` · ${i.error}` : ""}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>{new Date(j.createdAt).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {!shopeeJobs.length && (
              <tr>
                <td colSpan={4} className="muted">
                  Nenhum job ainda. Selecione produtos no Catálogo e clique em Publicar (Shopee).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
