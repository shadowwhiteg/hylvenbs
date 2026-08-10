"use client";

import { useEffect, useState } from "react";
import { FieldLabel } from "@/components/HelpTip";

export type ShopeeDraftForm = {
  title: string;
  description: string;
  price: number;
  stock: number;
  condition: string;
  categoryId: string;
  attributes: string;
  pictures: string;
  itemSku: string;
  brandId: string;
  brandName: string;
  weightKg: number;
  dimensionJson: string;
  logisticsJson: string;
  daysToShip: number;
  videoUrl: string;
};

type Props = {
  costPrice: number;
  loadUrl: string;
  saveUrl: string;
  heading: string;
  /** Base pra ações de IA (categorizar); default = saveUrl sem "/shopee-draft". */
  actionsBaseUrl?: string;
};

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function errorMessage(res: Response, payload: unknown): string {
  const record = readRecord(payload);
  const value = record?.error;
  if (typeof value === "string" && value) return value;
  return `Falha HTTP ${res.status}`;
}

function draftFromApi(raw: unknown): ShopeeDraftForm {
  const d = readRecord(raw) ?? {};
  return {
    title: String(d.title ?? ""),
    description: String(d.description ?? ""),
    price: Number(d.price ?? 0),
    stock: Number(d.stock ?? 0),
    condition: String(d.condition ?? "NEW"),
    categoryId: String(d.categoryId ?? ""),
    attributes: String(d.attributes ?? "[]"),
    pictures: String(d.pictures ?? "[]"),
    itemSku: String(d.itemSku ?? ""),
    brandId: String(d.brandId ?? ""),
    brandName: String(d.brandName ?? ""),
    weightKg: Number(d.weightKg ?? 0.3),
    dimensionJson: String(d.dimensionJson ?? "{}"),
    logisticsJson: String(d.logisticsJson ?? "[]"),
    daysToShip: Number(d.daysToShip ?? 2),
    videoUrl: String(d.videoUrl ?? ""),
  };
}

export function ShopeeListingEditor({ costPrice, loadUrl, saveUrl, heading }: Props) {
  const [form, setForm] = useState<ShopeeDraftForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(loadUrl);
        const data = await readJson(res);
        if (!res.ok) throw new Error(errorMessage(res, data));
        const record = readRecord(data);
        setForm(draftFromApi(record?.draft));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUrl]);

  function setField<K extends keyof ShopeeDraftForm>(key: K, value: ShopeeDraftForm[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(saveUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(errorMessage(res, data));
      setMessage("Rascunho Shopee salvo");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Carregando rascunho Shopee...</p>;
  if (!form) return <div className="alert error">{error ?? "Não foi possível carregar o rascunho Shopee"}</div>;

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

      <div className="form-grid">
        <label className="full">
          <FieldLabel>Título na Shopee (máx. 120)</FieldLabel>
          <input value={form.title} maxLength={120} onChange={(e) => setField("title", e.target.value)} />
          <p className="cell-sub" style={{ margin: "0.35rem 0 0" }}>{form.title.length}/120 caracteres</p>
        </label>

        <label>
          <FieldLabel>Condição</FieldLabel>
          <select value={form.condition} onChange={(e) => setField("condition", e.target.value)}>
            <option value="NEW">Novo</option>
            <option value="USED">Usado</option>
          </select>
        </label>

        <label>
          <FieldLabel>category_id (Shopee)</FieldLabel>
          <input
            value={form.categoryId}
            placeholder="ex: 100182"
            onChange={(e) => setField("categoryId", e.target.value)}
          />
        </label>

        <label>
          <FieldLabel>SKU</FieldLabel>
          <input value={form.itemSku} onChange={(e) => setField("itemSku", e.target.value)} />
        </label>

        <label>
          <FieldLabel>Marca (nome)</FieldLabel>
          <input
            value={form.brandName}
            placeholder="Sem marca"
            onChange={(e) => setField("brandName", e.target.value)}
          />
        </label>

        <label>
          <FieldLabel>brand_id (Shopee, se conhecido)</FieldLabel>
          <input value={form.brandId} onChange={(e) => setField("brandId", e.target.value)} />
        </label>

        <label>
          <FieldLabel>Peso (kg)</FieldLabel>
          <input
            type="number"
            step="0.01"
            value={form.weightKg}
            onChange={(e) => setField("weightKg", Number(e.target.value))}
          />
        </label>

        <label>
          <FieldLabel>Dias para despachar</FieldLabel>
          <input
            type="number"
            value={form.daysToShip}
            onChange={(e) => setField("daysToShip", Number(e.target.value))}
          />
        </label>

        <label>
          <FieldLabel>Estoque</FieldLabel>
          <input type="number" value={form.stock} onChange={(e) => setField("stock", Number(e.target.value))} />
        </label>

        <label>
          <FieldLabel>Preço de venda (R$)</FieldLabel>
          <input
            type="number"
            step="0.01"
            value={form.price}
            onChange={(e) => setField("price", Number(e.target.value))}
          />
        </label>

        <label className="full">
          <FieldLabel>URL do vídeo</FieldLabel>
          <input value={form.videoUrl} onChange={(e) => setField("videoUrl", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel>Descrição</FieldLabel>
          <textarea value={form.description} onChange={(e) => setField("description", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel>Fotos (JSON array de URLs)</FieldLabel>
          <textarea value={form.pictures} onChange={(e) => setField("pictures", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel>{'Características (JSON [{"attribute_id":1,"value":"..."}])'}</FieldLabel>
          <textarea value={form.attributes} onChange={(e) => setField("attributes", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel>Dimensões da embalagem (JSON {"{"}length,width,height{"}"} em cm)</FieldLabel>
          <textarea value={form.dimensionJson} onChange={(e) => setField("dimensionJson", e.target.value)} />
        </label>

        <label className="full">
          <FieldLabel>Canais de logística (JSON)</FieldLabel>
          <textarea value={form.logisticsJson} onChange={(e) => setField("logisticsJson", e.target.value)} />
        </label>
      </div>
    </div>
  );
}
