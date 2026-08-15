"use client";

import { useCallback, useEffect, useState } from "react";
import { BP } from "@/lib/base-path";
import { useSearchParams } from "next/navigation";
import { FieldLabel, HelpTip } from "@/components/HelpTip";
import { SETTINGS_HELP } from "@/lib/ui/help-texts";
import {
  AI_PROVIDER_CLI_DEFAULTS,
  AI_PROVIDER_FIELDS,
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_MODEL_PLACEHOLDER,
  type AiProviderId,
} from "@/lib/agent/providers/meta";

const SYNC_MODES = [
  { value: "always", label: "Sempre (estoque + preço recalculado)" },
  { value: "stock_only", label: "Somente estoque" },
  { value: "respect_user_edits", label: "Respeitar edições de preço" },
  { value: "manual", label: "Manual (sem PUT automático)" },
] as const;

const LISTING_TYPES = [
  { value: "gold_pro", label: "Premium (gold_pro)" },
  { value: "gold_special", label: "Clássico (gold_special)" },
  { value: "gold", label: "gold" },
] as const;

const SHIPPING_MODES = [
  { value: "me2", label: "Mercado Envios (me2)" },
  { value: "custom", label: "Custom" },
  { value: "not_specified", label: "Não especificado" },
] as const;

const LISTING_DEFAULTS = {
  defaultListingTypeId: "gold_pro",
  defaultFreeShipping: true,
  defaultLocalPickUp: false,
  defaultShippingMode: "me2",
  defaultWarrantyType: "Garantia de fábrica",
  defaultWarrantyTime: "90 dias",
} as const;

type TunnelStatus = "stopped" | "starting" | "up" | "error";

type SettingsResponse = {
  ml?: { connected?: boolean; userId?: string };
  settings?: {
    marginPercent?: number;
    autoSyncMode?: string;
    autoPauseWhenUnavailable?: boolean;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    aiProvider?: string;
    aiBaseUrl?: string | null;
    aiModel?: string | null;
    aiCliCommand?: string | null;
    aiCliArgs?: string;
    aiMaxTokens?: number;
    defaultListingTypeId?: string;
    defaultFreeShipping?: boolean;
    defaultLocalPickUp?: boolean;
    defaultShippingMode?: string;
    defaultWarrantyType?: string;
    defaultWarrantyTime?: string;
    catalogStockPercent?: number;
    shopeeDefaultWeightKg?: number;
    shopeeDefaultDaysToShip?: number;
  };
  tunnelUrl?: string | null;
  tunnelStatus?: TunnelStatus | null;
  oauthCallbackUrl?: string | null;
  notificationsCallbackUrl?: string | null;
  hasMlClientSecret?: boolean;
  hasAiApiKey?: boolean;
  hasShopeePartnerKey?: boolean;
  error?: string;
};

type ShopeeStatusResponse = {
  connected?: boolean;
  shopId?: string;
  tunnelUrl?: string | null;
  tunnelStatus?: TunnelStatus | null;
  shopeeCallbackUrl?: string | null;
  hasShopeePartnerKey?: boolean;
};

function parseCliArgsInput(text: string): string[] {
  return text
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
}

function tunnelBadgeClass(status: TunnelStatus | null): string {
  if (status === "up") return "badge ok";
  if (status === "starting") return "badge";
  return "badge err";
}

function tunnelStatusLabel(status: TunnelStatus | null): string {
  switch (status) {
    case "up":
      return "ativo";
    case "starting":
      return "iniciando…";
    case "error":
      return "erro";
    case "stopped":
      return "parado";
    default:
      return "desconhecido";
  }
}

export function SettingsClient() {
  const search = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [userId, setUserId] = useState<string | undefined>();
  const [marginPercent, setMarginPercent] = useState(30);
  const [catalogStockPercent, setCatalogStockPercent] = useState(100);
  const [autoSyncMode, setAutoSyncMode] = useState("always");
  const [autoPauseWhenUnavailable, setAutoPauseWhenUnavailable] = useState(true);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3.5:4b");
  const [aiProvider, setAiProvider] = useState<AiProviderId>("ollama");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiCliCommand, setAiCliCommand] = useState("");
  const [aiCliArgsText, setAiCliArgsText] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [hasAiApiKey, setHasAiApiKey] = useState(false);
  const [aiMaxTokens, setAiMaxTokens] = useState(2048);
  const [defaultListingTypeId, setDefaultListingTypeId] = useState<string>(
    LISTING_DEFAULTS.defaultListingTypeId
  );
  const [defaultFreeShipping, setDefaultFreeShipping] = useState<boolean>(
    LISTING_DEFAULTS.defaultFreeShipping
  );
  const [defaultLocalPickUp, setDefaultLocalPickUp] = useState<boolean>(
    LISTING_DEFAULTS.defaultLocalPickUp
  );
  const [defaultShippingMode, setDefaultShippingMode] = useState<string>(
    LISTING_DEFAULTS.defaultShippingMode
  );
  const [defaultWarrantyType, setDefaultWarrantyType] = useState<string>(
    LISTING_DEFAULTS.defaultWarrantyType
  );
  const [defaultWarrantyTime, setDefaultWarrantyTime] = useState<string>(
    LISTING_DEFAULTS.defaultWarrantyTime
  );
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [oauthCallbackUrl, setOauthCallbackUrl] = useState<string | null>(null);
  const [notificationsCallbackUrl, setNotificationsCallbackUrl] = useState<string | null>(null);
  const [hasMlClientSecret, setHasMlClientSecret] = useState(false);
  const [mlClientSecret, setMlClientSecret] = useState("");
  const [shopeeConnected, setShopeeConnected] = useState(false);
  const [shopeeShopId, setShopeeShopId] = useState<string | undefined>();
  const [shopeeCallbackUrl, setShopeeCallbackUrl] = useState<string | null>(null);
  const [hasShopeePartnerKey, setHasShopeePartnerKey] = useState(false);
  const [shopeePartnerKey, setShopeePartnerKey] = useState("");
  const [shopeeDefaultWeightKg, setShopeeDefaultWeightKg] = useState(0.3);
  const [shopeeDefaultDaysToShip, setShopeeDefaultDaysToShip] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(BP + "/api/settings");
    const data = (await res.json()) as SettingsResponse;
    setConnected(Boolean(data.ml?.connected));
    setUserId(data.ml?.userId);
    setMarginPercent(data.settings?.marginPercent ?? 30);
    setCatalogStockPercent(data.settings?.catalogStockPercent ?? 100);
    setAutoSyncMode(data.settings?.autoSyncMode ?? "always");
    setAutoPauseWhenUnavailable(data.settings?.autoPauseWhenUnavailable ?? true);
    setOllamaBaseUrl(data.settings?.ollamaBaseUrl ?? "http://127.0.0.1:11434");
    setOllamaModel(data.settings?.ollamaModel ?? "qwen3.5:4b");
    const provider = data.settings?.aiProvider;
    setAiProvider(
      provider && (AI_PROVIDER_IDS as readonly string[]).includes(provider)
        ? (provider as AiProviderId)
        : "ollama"
    );
    setAiBaseUrl(data.settings?.aiBaseUrl ?? "");
    setAiModel(data.settings?.aiModel ?? "");
    setAiCliCommand(data.settings?.aiCliCommand ?? "");
    try {
      const args = JSON.parse(data.settings?.aiCliArgs || "[]");
      setAiCliArgsText(Array.isArray(args) ? args.join(" ") : "");
    } catch {
      setAiCliArgsText("");
    }
    setHasAiApiKey(Boolean(data.hasAiApiKey));
    // Never prefill real key — only placeholder if set
    setAiApiKey("");
    setAiMaxTokens(data.settings?.aiMaxTokens ?? 2048);
    // Os defaults de anúncio podem ainda não existir na API; caem no valor local.
    setDefaultListingTypeId(
      data.settings?.defaultListingTypeId ?? LISTING_DEFAULTS.defaultListingTypeId
    );
    setDefaultFreeShipping(
      data.settings?.defaultFreeShipping ?? LISTING_DEFAULTS.defaultFreeShipping
    );
    setDefaultLocalPickUp(
      data.settings?.defaultLocalPickUp ?? LISTING_DEFAULTS.defaultLocalPickUp
    );
    setDefaultShippingMode(
      data.settings?.defaultShippingMode ?? LISTING_DEFAULTS.defaultShippingMode
    );
    setDefaultWarrantyType(
      data.settings?.defaultWarrantyType ?? LISTING_DEFAULTS.defaultWarrantyType
    );
    setDefaultWarrantyTime(
      data.settings?.defaultWarrantyTime ?? LISTING_DEFAULTS.defaultWarrantyTime
    );
    setTunnelUrl(data.tunnelUrl ?? null);
    setTunnelStatus(data.tunnelStatus ?? null);
    setOauthCallbackUrl(data.oauthCallbackUrl ?? null);
    setNotificationsCallbackUrl(data.notificationsCallbackUrl ?? null);
    setHasMlClientSecret(Boolean(data.hasMlClientSecret));
    // Never prefill real secret — only placeholder if set
    setMlClientSecret("");
    setShopeeDefaultWeightKg(data.settings?.shopeeDefaultWeightKg ?? 0.3);
    setShopeeDefaultDaysToShip(data.settings?.shopeeDefaultDaysToShip ?? 2);
    setHasShopeePartnerKey(Boolean(data.hasShopeePartnerKey));
    setShopeePartnerKey("");

    const shopeeRes = await fetch(BP + "/api/auth/shopee/status");
    const shopeeData = (await shopeeRes.json()) as ShopeeStatusResponse;
    setShopeeConnected(Boolean(shopeeData.connected));
    setShopeeShopId(shopeeData.shopId);
    setShopeeCallbackUrl(shopeeData.shopeeCallbackUrl ?? null);
  }, []);

  useEffect(() => {
    void load();
    if (search.get("connected")) setMessage("Mercado Livre conectado com sucesso");
    const err = search.get("error");
    const oauthReason = search.get("oauth_reason");
    if (err === "oauth") {
      const reasonHints: Record<string, string> = {
        redirect_uri_mismatch:
          "redirect_uri diferente do DevCenter. Copie o Callback abaixo e cadastre exatamente em URIs de redirect.",
        ml_denied: "O Mercado Livre recusou a autorização (conta, KYC ou app).",
        missing_code: "Callback sem código. Confira se o redirect no DevCenter aponta para este app.",
        exchange_failed:
          "Troca do code por token falhou. Confira Secret Key, App ID e se o callback no DevCenter é idêntico ao desta tela.",
      };
      setError(
        reasonHints[oauthReason || ""] ||
          "Falha no OAuth do Mercado Livre. Cadastre o callback exato no DevCenter e abra o app pela URL do túnel."
      );
    }
    if (err === "ml_app_id") setError("ML_APP_ID ausente no .env");
    if (err === "ml_secret") {
      setError(
        "Secret Key do ML ausente — preencha em Configurações ou no .env (ML_CLIENT_SECRET)."
      );
    }
    if (err === "oauth_origin") {
      setError(
        "Origem não permitida. Use localhost, 10.131.24.6 ou *.trycloudflare.com"
      );
    }
    if (err === "oauth_private_redirect") {
      setError(
        "O Mercado Livre bloqueia OAuth com redirect em localhost/IP privado. Aguarde o túnel Cloudflare ficar ativo (veja a URL abaixo) e cadastre o callback no DevCenter."
      );
    }
    if (search.get("shopee_connected")) setMessage("Shopee conectada com sucesso");
    if (err === "shopee_partner_id") setError("SHOPEE_PARTNER_ID ausente no .env");
    if (err === "shopee_partner_key") {
      setError(
        "Partner Key da Shopee ausente — preencha em Configurações ou no .env (SHOPEE_PARTNER_KEY)."
      );
    }
    if (err === "shopee_oauth") {
      const shopeeReasonHints: Record<string, string> = {
        missing_code_or_shop: "Callback sem code/shop_id. Confira o redirect cadastrado no app Shopee.",
        exchange_failed:
          "Troca do code por token falhou. Confira Partner ID/Key e se o domínio de redirect está cadastrado no Partner App da Shopee.",
      };
      setError(
        shopeeReasonHints[oauthReason || ""] ||
          "Falha no OAuth da Shopee. Cadastre o callback exato no Partner App e abra o app pela URL do túnel."
      );
    }
  }, [search, load]);

  // Poll tunnel while starting
  useEffect(() => {
    if (tunnelStatus === "up" || tunnelStatus === "error") return;
    const id = window.setInterval(() => {
      void load();
    }, 2500);
    return () => window.clearInterval(id);
  }, [tunnelStatus, load]);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Não foi possível copiar para a área de transferência");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        marginPercent,
        catalogStockPercent,
        autoSyncMode,
        autoPauseWhenUnavailable,
        ollamaBaseUrl,
        ollamaModel,
        aiProvider,
        aiBaseUrl,
        aiModel,
        aiCliCommand,
        aiCliArgs: parseCliArgsInput(aiCliArgsText),
        aiMaxTokens,
        defaultListingTypeId,
        defaultFreeShipping,
        defaultLocalPickUp,
        defaultShippingMode,
        defaultWarrantyType,
        defaultWarrantyTime,
        shopeeDefaultWeightKg,
        shopeeDefaultDaysToShip,
      };
      if (mlClientSecret.trim()) {
        body.mlClientSecret = mlClientSecret.trim();
      }
      if (aiApiKey.trim()) {
        body.aiApiKey = aiApiKey.trim();
      }
      if (shopeePartnerKey.trim()) {
        body.shopeePartnerKey = shopeePartnerKey.trim();
      }
      const res = await fetch(BP + "/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as SettingsResponse;
      if (!res.ok) {
        setError(data.error || "Erro");
        return;
      }
      setHasMlClientSecret(Boolean(data.hasMlClientSecret));
      setMlClientSecret("");
      setHasAiApiKey(Boolean(data.hasAiApiKey));
      setAiApiKey("");
      setHasShopeePartnerKey(Boolean(data.hasShopeePartnerKey));
      setShopeePartnerKey("");
      setMessage(
        data.hasMlClientSecret && body.mlClientSecret
          ? "Configurações e Secret Key salvos (efeito imediato no servidor)"
          : "Configurações salvas"
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Configurações</h1>
          <p className="muted">
            OAuth Mercado Livre, túnel Cloudflare, políticas de sync automático e Ollama.
          </p>
        </div>
      </div>
      {message && <div className="alert">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Mercado Livre</h3>
        <p>
          Status:{" "}
          <span className={`badge ${connected ? "ok" : "err"}`}>
            {connected ? `conectado${userId ? ` (${userId})` : ""}` : "desconectado"}
          </span>
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <p style={{ marginBottom: "0.35rem" }}>
            <FieldLabel help={SETTINGS_HELP.tunnel}>Túnel Cloudflare</FieldLabel>:{" "}
            <span className={tunnelBadgeClass(tunnelStatus)}>
              {tunnelStatusLabel(tunnelStatus)}
            </span>
            <button
              type="button"
              className="btn"
              style={{ marginLeft: "0.5rem", padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
              onClick={() => void load()}
            >
              Atualizar
            </button>
          </p>
          {tunnelUrl ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <code style={{ wordBreak: "break-all" }}>{tunnelUrl}</code>
              <button
                type="button"
                className="btn"
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                onClick={() => void copyText("tunnel", tunnelUrl)}
              >
                {copied === "tunnel" ? "Copiado" : "Copiar URL"}
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              URL ainda não disponível. O app inicia o túnel automaticamente; se falhar, rode{" "}
              <code>npm run tunnel</code>.
            </p>
          )}
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <FieldLabel help={SETTINGS_HELP.callback}>
            <span style={{ display: "block", marginBottom: "0.35rem" }}>
              Callback para o DevCenter
            </span>
          </FieldLabel>
          {oauthCallbackUrl ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <code style={{ wordBreak: "break-all" }}>{oauthCallbackUrl}</code>
              <button
                type="button"
                className="btn"
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                onClick={() => void copyText("callback", oauthCallbackUrl)}
              >
                {copied === "callback" ? "Copiado" : "Copiar callback"}
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Cadastre <code>{"{URL_DO_TUNEL}/api/auth/ml/callback"}</code> quando o túnel
              estiver ativo.
            </p>
          )}
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <FieldLabel help={SETTINGS_HELP.notifications}>
            <span style={{ display: "block", marginBottom: "0.35rem" }}>
              URL de notificações para o DevCenter
            </span>
          </FieldLabel>
          {notificationsCallbackUrl ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <code style={{ wordBreak: "break-all" }}>{notificationsCallbackUrl}</code>
              <button
                type="button"
                className="btn"
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                onClick={() => void copyText("notifications", notificationsCallbackUrl)}
              >
                {copied === "notifications" ? "Copiado" : "Copiar notificações"}
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Cadastre <code>{"{URL_DO_TUNEL}/api/ml/notifications"}</code> quando o túnel
              estiver ativo.
            </p>
          )}
        </div>

        <div style={{ marginBottom: "1rem", maxWidth: 420 }}>
          <label>
            <FieldLabel help={SETTINGS_HELP.mlSecret}>Secret Key (ML_CLIENT_SECRET)</FieldLabel>
            <input
              type="password"
              autoComplete="new-password"
              value={mlClientSecret}
              onChange={(e) => setMlClientSecret(e.target.value)}
              placeholder={hasMlClientSecret ? "•••••••• (já configurado)" : "Cole o Secret Key"}
            />
          </label>
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {hasMlClientSecret
              ? "Já há um secret salvo. Digite um novo apenas para substituir."
              : "Obrigatório para conectar. Salvo no servidor (não é exibido de volta)."}
          </p>
        </div>

        <div
          className="alert"
          style={{ marginBottom: "1rem", fontSize: "0.9rem", lineHeight: 1.45 }}
        >
          <strong>Antes de conectar</strong>
          <ol style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
            <li>
              No DevCenter, em <em>URIs de redirect</em>, cole exatamente o Callback acima
              (sem barra no final).
            </li>
            <li>
              Em <em>URL de notificações</em>, use a URL de notificações (não o callback
              OAuth).
            </li>
            <li>
              Abra este app pela URL do túnel Cloudflare (HTTPS), não por IP/localhost, e
              clique em Conectar.
            </li>
            <li>
              Faça login com a conta <em>principal</em> do vendedor (não colaborador).
            </li>
          </ol>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <a className="btn btn-primary" href={`${BP}/api/auth/ml`}>
            Conectar Mercado Livre
          </a>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch(BP + "/api/auth/ml/verify", { method: "POST" });
                  const data = (await res.json()) as {
                    ok?: boolean;
                    userId?: string;
                    error?: string;
                  };
                  if (!res.ok || !data.ok) {
                    setConnected(false);
                    setUserId(undefined);
                    setError(data.error || "Token inválido — reconecte o Mercado Livre");
                    return;
                  }
                  setConnected(true);
                  setUserId(data.userId);
                  setMessage(`Token válido${data.userId ? ` (user ${data.userId})` : ""}`);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Verificar token
          </button>
          {connected && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Desconectar a conta do Mercado Livre deste app?")) return;
                void (async () => {
                  setBusy(true);
                  try {
                    await fetch(BP + "/api/auth/ml/disconnect", { method: "POST" });
                    setConnected(false);
                    setUserId(undefined);
                    setMessage("Mercado Livre desconectado");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Desconectar
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Shopee</h3>
        <p>
          Status:{" "}
          <span className={`badge ${shopeeConnected ? "ok" : "err"}`}>
            {shopeeConnected ? `conectada${shopeeShopId ? ` (loja ${shopeeShopId})` : ""}` : "desconectada"}
          </span>
        </p>

        <div style={{ marginBottom: "1rem" }}>
          <FieldLabel help={SETTINGS_HELP.tunnel}>
            <span style={{ display: "block", marginBottom: "0.35rem" }}>
              Callback para o Partner App (open.shopee.com)
            </span>
          </FieldLabel>
          {shopeeCallbackUrl ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <code style={{ wordBreak: "break-all" }}>{shopeeCallbackUrl}</code>
              <button
                type="button"
                className="btn"
                style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                onClick={() => void copyText("shopee-callback", shopeeCallbackUrl)}
              >
                {copied === "shopee-callback" ? "Copiado" : "Copiar callback"}
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Cadastre <code>{"{URL_DO_TUNEL}/api/auth/shopee/callback"}</code> como Redirect URL
              do app em open.shopee.com quando o túnel estiver ativo.
            </p>
          )}
        </div>

        <div style={{ marginBottom: "1rem", maxWidth: 420 }}>
          <label>
            <FieldLabel help={SETTINGS_HELP.shopeePartnerKey}>
              Partner Key (SHOPEE_PARTNER_KEY)
            </FieldLabel>
            <input
              type="password"
              autoComplete="new-password"
              value={shopeePartnerKey}
              onChange={(e) => setShopeePartnerKey(e.target.value)}
              placeholder={hasShopeePartnerKey ? "•••••••• (já configurada)" : "Cole a Partner Key"}
            />
          </label>
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
            {hasShopeePartnerKey
              ? "Já há uma Partner Key salva. Digite uma nova apenas para substituir."
              : "Obrigatória para conectar (junto com SHOPEE_PARTNER_ID no .env). Salva no servidor."}
          </p>
        </div>

        <div className="form-grid" style={{ marginBottom: "1rem" }}>
          <label style={{ maxWidth: 220 }}>
            <FieldLabel help={SETTINGS_HELP.shopeeDefaultWeightKg}>Peso padrão (kg)</FieldLabel>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={shopeeDefaultWeightKg}
              onChange={(e) => setShopeeDefaultWeightKg(Number(e.target.value))}
            />
          </label>
          <label style={{ maxWidth: 220 }}>
            <FieldLabel help={SETTINGS_HELP.shopeeDefaultDaysToShip}>Dias pra despachar</FieldLabel>
            <input
              type="number"
              min={0}
              step={1}
              value={shopeeDefaultDaysToShip}
              onChange={(e) => setShopeeDefaultDaysToShip(Number(e.target.value))}
            />
          </label>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <a className="btn btn-primary" href={`${BP}/api/auth/shopee`}>
            Conectar Shopee
          </a>
          {shopeeConnected && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Desconectar a conta Shopee deste app?")) return;
                void (async () => {
                  setBusy(true);
                  try {
                    await fetch(BP + "/api/auth/shopee/disconnect", { method: "POST" });
                    setShopeeConnected(false);
                    setShopeeShopId(undefined);
                    setMessage("Shopee desconectada");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Desconectar
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Simulador</h3>
        <div className="form-grid">
          <label style={{ maxWidth: 280 }}>
            <FieldLabel help={SETTINGS_HELP.margin}>Margem padrão (%)</FieldLabel>
            <input
              type="number"
              value={marginPercent}
              onChange={(e) => setMarginPercent(Number(e.target.value))}
            />
          </label>
          <label style={{ maxWidth: 280 }}>
            <FieldLabel help={SETTINGS_HELP.catalogStockPercent}>
              Estoque do catálogo (% do Meu Drop)
            </FieldLabel>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={catalogStockPercent}
              onChange={(e) => setCatalogStockPercent(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
          Ex.: com 25% e 30 unidades no Meu Drop, o catálogo usa 7 unidades.
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Padrões de anúncio</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Valores aplicados a novos rascunhos criados pelo sync do catálogo.
        </p>
        <div className="form-grid">
          <label htmlFor="default-listing-type">
            <FieldLabel help={SETTINGS_HELP.listingType}>Tipo de anúncio padrão</FieldLabel>
            <select
              id="default-listing-type"
              value={defaultListingTypeId}
              onChange={(e) => setDefaultListingTypeId(e.target.value)}
            >
              {LISTING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="default-shipping-mode">
            <FieldLabel help={SETTINGS_HELP.shippingMode}>Forma de entrega padrão</FieldLabel>
            <select
              id="default-shipping-mode"
              value={defaultShippingMode}
              onChange={(e) => setDefaultShippingMode(e.target.value)}
            >
              {SHIPPING_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="default-warranty-type">
            <FieldLabel help={SETTINGS_HELP.warrantyType}>Tipo de garantia padrão</FieldLabel>
            <input
              id="default-warranty-type"
              value={defaultWarrantyType}
              placeholder={LISTING_DEFAULTS.defaultWarrantyType}
              onChange={(e) => setDefaultWarrantyType(e.target.value)}
            />
          </label>

          <label htmlFor="default-warranty-time">
            <FieldLabel help={SETTINGS_HELP.warrantyTime}>Tempo de garantia padrão</FieldLabel>
            <input
              id="default-warranty-time"
              value={defaultWarrantyTime}
              placeholder={LISTING_DEFAULTS.defaultWarrantyTime}
              onChange={(e) => setDefaultWarrantyTime(e.target.value)}
            />
          </label>
        </div>

        <div className="toggle-row">
          <label className={`toggle${defaultFreeShipping ? " on" : ""}`}>
            <input
              type="checkbox"
              checked={defaultFreeShipping}
              onChange={(e) => setDefaultFreeShipping(e.target.checked)}
            />
            Frete grátis por padrão
            <HelpTip text={SETTINGS_HELP.freeShipping} />
          </label>
          <label className={`toggle${defaultLocalPickUp ? " on" : ""}`}>
            <input
              type="checkbox"
              checked={defaultLocalPickUp}
              onChange={(e) => setDefaultLocalPickUp(e.target.checked)}
            />
            Oferecer retirada pessoalmente
            <HelpTip text={SETTINGS_HELP.localPickUp} />
          </label>
        </div>
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
          Retirada desmarcada equivale a &quot;Não ofereço&quot; no anúncio.
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Sync automático (ML)</h3>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Após cada sync do catálogo, anúncios publicados recebem PUT de preço/estoque
          conforme o modo.
        </p>
        <label style={{ maxWidth: 420 }}>
          <FieldLabel help={SETTINGS_HELP.autoSyncMode}>Modo de auto-sync</FieldLabel>
          <select value={autoSyncMode} onChange={(e) => setAutoSyncMode(e.target.value)}>
            {SYNC_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.75rem",
            maxWidth: 420,
          }}
        >
          <input
            type="checkbox"
            checked={autoPauseWhenUnavailable}
            onChange={(e) => setAutoPauseWhenUnavailable(e.target.checked)}
          />
          Pausar anúncio no ML quando indisponível
          <HelpTip text={SETTINGS_HELP.autoPause} />
        </label>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>IA (provedor do agente)</h3>
        <div className="form-grid">
          <label>
            <FieldLabel help={SETTINGS_HELP.aiProvider}>Provedor</FieldLabel>
            <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value as AiProviderId)}>
              {AI_PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {AI_PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {aiProvider === "ollama" && (
          <div className="form-grid" style={{ marginTop: "0.75rem" }}>
            <label>
              <FieldLabel help={SETTINGS_HELP.ollamaUrl}>Base URL</FieldLabel>
              <input
                value={ollamaBaseUrl}
                onChange={(e) => setOllamaBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:11434"
              />
            </label>
            <label>
              <FieldLabel help={SETTINGS_HELP.ollamaModel}>Modelo</FieldLabel>
              <input
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                placeholder="qwen3.5:4b"
              />
            </label>
          </div>
        )}

        {(AI_PROVIDER_FIELDS[aiProvider].baseUrl || AI_PROVIDER_FIELDS[aiProvider].model) &&
          aiProvider !== "ollama" && (
            <div className="form-grid" style={{ marginTop: "0.75rem" }}>
              {AI_PROVIDER_FIELDS[aiProvider].baseUrl && (
                <label>
                  <FieldLabel help={SETTINGS_HELP.aiBaseUrl}>Base URL</FieldLabel>
                  <input
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    placeholder="https://meu-endpoint.exemplo.com/v1"
                  />
                </label>
              )}
              {AI_PROVIDER_FIELDS[aiProvider].model && (
                <label>
                  <FieldLabel help={SETTINGS_HELP.aiModel}>Modelo</FieldLabel>
                  <input
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder={AI_PROVIDER_MODEL_PLACEHOLDER[aiProvider]}
                  />
                </label>
              )}
            </div>
          )}

        {AI_PROVIDER_FIELDS[aiProvider].apiKey && (
          <div style={{ marginTop: "0.75rem", maxWidth: 420 }}>
            <label>
              <FieldLabel help={SETTINGS_HELP.aiApiKey}>API key</FieldLabel>
              <input
                type="password"
                autoComplete="new-password"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder={hasAiApiKey ? "•••••••• (já configurada)" : "Cole a API key"}
              />
            </label>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              {hasAiApiKey
                ? "Já há uma key salva. Digite uma nova apenas para substituir."
                : "Salva só no servidor (não é exibida de volta)."}
            </p>
          </div>
        )}

        <div className="form-grid" style={{ marginTop: "0.75rem" }}>
          <label>
            <FieldLabel help={SETTINGS_HELP.aiMaxTokens}>Máx. tokens (saída)</FieldLabel>
            <input
              type="number"
              min={256}
              max={128000}
              step={1}
              value={aiMaxTokens}
              onChange={(e) => setAiMaxTokens(Number(e.target.value))}
            />
          </label>
        </div>

        {AI_PROVIDER_FIELDS[aiProvider].cli && (
          <div style={{ marginTop: "0.75rem" }}>
            <div className="form-grid">
              <label>
                <FieldLabel help={SETTINGS_HELP.aiCliCommand}>Comando do CLI</FieldLabel>
                <input
                  value={aiCliCommand}
                  onChange={(e) => setAiCliCommand(e.target.value)}
                  placeholder={AI_PROVIDER_CLI_DEFAULTS[aiProvider as "cursor" | "claude-code"].command}
                />
              </label>
              <label>
                <FieldLabel help={SETTINGS_HELP.aiCliArgs}>Argumentos extras</FieldLabel>
                <input
                  value={aiCliArgsText}
                  onChange={(e) => setAiCliArgsText(e.target.value)}
                  placeholder={AI_PROVIDER_CLI_DEFAULTS[aiProvider as "cursor" | "claude-code"].args.join(" ")}
                />
              </label>
            </div>
            <p className="cell-sub" style={{ margin: "0.5rem 0 0" }}>
              Executa o binário localmente como subprocesso desta máquina, enviando o prompt pelo
              stdin — precisa estar instalado e autenticado aqui. Não suporta as ferramentas (tools)
              do Agente, só geração de texto simples (títulos, características, categorização,
              sugestões de kit).
            </p>
          </div>
        )}
      </div>

      <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
        Salvar configurações
      </button>
    </div>
  );
}
