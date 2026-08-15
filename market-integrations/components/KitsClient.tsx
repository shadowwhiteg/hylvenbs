"use client";

import { useEffect, useState } from "react";
import { BP } from "@/lib/base-path";
import Link from "next/link";

type Kit = {
  id: string;
  title: string;
  costPrice: number;
  status: string;
  source?: string;
  aiRationale?: string | null;
  mlPermalink?: string | null;
  shopeeItemId?: string | null;
  shopeeItemUrl?: string | null;
  /** Itens vindos de anúncios ML não têm `product` local — o snapshot é a fonte do rótulo. */
  items: { titleSnapshot?: string; product?: { title: string } | null }[];
  draft?: { price: number } | null;
  shopeeDraft?: { price: number } | null;
};

function itemLabel(item: Kit["items"][number]): string {
  return item.titleSnapshot || item.product?.title || "(item removido)";
}

export function KitsClient() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(BP + "/api/kits");
    const data = await res.json();
    setKits(data.kits || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function publishSelected(marketplace: "ml" | "shopee") {
    if (!selected.size) return;
    setError(null);
    const url = marketplace === "ml" ? `${BP}/api/publish` : `${BP}/api/shopee-publish`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kitIds: Array.from(selected) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Falha");
      return;
    }
    setMessage(`Job ${data.job.id} criado`);
    setSelected(new Set());
    await load();
  }

  async function deleteKit(id: string) {
    if (!confirm("Excluir este kit? Essa ação não pode ser desfeita.")) return;
    setError(null);
    const res = await fetch(`${BP}/api/kits/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Falha ao excluir kit");
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await load();
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Excluir ${selected.size} kit(s)? Essa ação não pode ser desfeita.`)) return;
    setError(null);
    const ids = Array.from(selected);
    const results = await Promise.all(
      ids.map((id) => fetch(`${BP}/api/kits/${id}`, { method: "DELETE" }))
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed) setError(`${failed} kit(s) não puderam ser excluídos`);
    setSelected(new Set());
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Kits</h1>
          <p className="muted">Una 2+ produtos no catálogo para publicar como um anúncio.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-primary" onClick={() => void publishSelected("ml")} disabled={!selected.size}>
            Publicar no ML ({selected.size})
          </button>
          <button className="btn btn-primary" onClick={() => void publishSelected("shopee")} disabled={!selected.size}>
            Publicar na Shopee ({selected.size})
          </button>
          <button
            className="btn"
            style={{ color: "var(--danger, #b42318)" }}
            onClick={() => void deleteSelected()}
            disabled={!selected.size}
          >
            Excluir kits ({selected.size})
          </button>
        </div>
      </div>
      {message && <div className="alert">{message}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Kit</th>
              <th>Itens</th>
              <th>Custo</th>
              <th>Preço</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {kits.map((k) => (
              <tr key={k.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(k.id)}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(k.id)) next.delete(k.id);
                        else next.add(k.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td>
                  <strong>{k.title}</strong>
                  {(k.source === "ml_listings" || k.source === "shopee_listings") && (
                    <div className="badge-row" style={{ marginTop: "0.25rem" }}>
                      <span className="badge info">
                        de anúncios {k.source === "ml_listings" ? "ML" : "Shopee"}
                      </span>
                      {k.aiRationale && <span className="badge soft">sugerido por IA</span>}
                    </div>
                  )}
                  {k.aiRationale && <div className="cell-sub">{k.aiRationale}</div>}
                  {k.mlPermalink && (
                    <div>
                      <a href={k.mlPermalink} target="_blank" rel="noreferrer">
                        Ver no ML
                      </a>
                    </div>
                  )}
                  {k.shopeeItemId && (
                    <div className="cell-sub">
                      Shopee: {k.shopeeItemId}
                      {k.shopeeItemUrl && (
                        <>
                          {" · "}
                          <a href={k.shopeeItemUrl} target="_blank" rel="noreferrer">
                            ver na Shopee
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </td>
                <td>{k.items.map(itemLabel).join(", ")}</td>
                <td>R$ {k.costPrice.toFixed(2)}</td>
                <td>
                  R$ {(k.draft?.price ?? 0).toFixed(2)}
                  {k.shopeeDraft && (
                    <div className="cell-sub">Shopee: R$ {k.shopeeDraft.price.toFixed(2)}</div>
                  )}
                </td>
                <td>
                  <span className="badge">{k.status}</span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Link className="btn" href={`/kits/${k.id}`}>
                      Editar
                    </Link>
                    <button
                      className="btn"
                      style={{ color: "var(--danger, #b42318)" }}
                      onClick={() => void deleteKit(k.id)}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!kits.length && (
              <tr>
                <td colSpan={7} className="muted">
                  Nenhum kit. Selecione 2+ produtos no catálogo e clique em Criar kit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
