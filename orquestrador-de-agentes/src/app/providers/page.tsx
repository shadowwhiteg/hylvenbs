"use client";

import { useEffect, useState } from "react";
import { Check, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Spinner } from "@/components/ui";
import { can, useMe } from "@/lib/auth-client";
import { api, type ProviderDto } from "@/lib/client";

/**
 * Presets de provedor. OpenRouter, DeepSeek e Google AI Studio expõem API
 * compatível com o formato de chat completions da OpenAI — não precisam de
 * protocolo próprio, só de kind "openai-compatible" com a baseUrl certa
 * (RQ-NFR-04: sem dependência nova para isso).
 */
const PRESETS = [
  { key: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", keyHint: "console.anthropic.com" },
  { key: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", keyHint: "platform.openai.com/api-keys" },
  {
    key: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    keyHint: "openrouter.ai/keys",
  },
  {
    key: "google",
    label: "Google AI Studio (Gemini)",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyHint: "aistudio.google.com/apikey",
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    keyHint: "platform.deepseek.com/api_keys",
  },
  {
    key: "custom",
    label: "Outro compatível com OpenAI (Ollama, vLLM, Groq…)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    keyHint: null,
  },
] as const;

type Draft = {
  name: string;
  preset: (typeof PRESETS)[number]["key"];
  kind: ProviderDto["kind"];
  baseUrl: string;
  apiKey: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  preset: PRESETS[0].key,
  kind: PRESETS[0].kind,
  baseUrl: PRESETS[0].baseUrl,
  apiKey: "",
};

export default function ProvidersPage() {
  const { me } = useMe();
  const canWrite = can(me, "secret.write");
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const selectedPreset = PRESETS.find((p) => p.key === draft.preset) ?? PRESETS[0];

  async function reload() {
    setProviders(await api.get<ProviderDto[]>("/api/providers"));
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api.post("/api/providers", {
        name: draft.name,
        kind: draft.kind,
        baseUrl: draft.baseUrl || null,
        apiKey: draft.apiKey || null,
      });
      setDraft(EMPTY_DRAFT);
      setCreating(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function refreshModels(provider: ProviderDto) {
    setBusyId(provider.id);
    setError(null);
    try {
      const result = await api.get<{ models: string[]; source: string; warning?: string }>(
        `/api/providers/${provider.id}/models`,
      );
      if (result.source === "fallback") {
        setError(`${provider.name}: usando lista sugerida — ${result.warning}`);
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(provider: ProviderDto) {
    await api.patch(`/api/providers/${provider.id}`, { enabled: !provider.enabled });
    await reload();
  }

  async function remove(provider: ProviderDto) {
    if (!confirm(`Excluir o provedor "${provider.name}"?`)) return;
    await api.del(`/api/providers/${provider.id}`);
    await reload();
  }

  return (
    <>
      <PageHeader
        title="Provedores"
        description="Endpoints de LLM disponíveis para os agentes. A chave fica no banco local e nunca é devolvida pela API."
        action={
          canWrite ? (
            <Button variant="primary" onClick={() => setCreating((v) => !v)}>
              {creating ? <X className="size-4" /> : <Plus className="size-4" />}
              {creating ? "Cancelar" : "Novo provedor"}
            </Button>
          ) : null
        }
      />

      <div className="space-y-4 p-8">
        {error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {creating ? (
          <Card>
            <CardHeader title="Novo provedor" subtitle="Deixe a chave vazia para usar variáveis de ambiente." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Provedor">
                <Select
                  value={draft.preset}
                  onChange={(e) => {
                    const preset = PRESETS.find((p) => p.key === e.target.value)!;
                    setDraft({
                      ...draft,
                      preset: preset.key,
                      kind: preset.kind,
                      baseUrl: preset.baseUrl,
                      name: draft.name || preset.label,
                    });
                  }}
                >
                  {PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nome">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Anthropic produção"
                />
              </Field>
              <Field label="Base URL">
                <Input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                />
              </Field>
              <Field
                label="API key"
                hint={selectedPreset.keyHint ? `opcional · gere em ${selectedPreset.keyHint}` : "opcional"}
              >
                <Input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-…"
                />
              </Field>
              <div className="sm:col-span-2">
                <Button variant="primary" onClick={create} disabled={!draft.name}>
                  <Check className="size-4" />
                  Criar provedor
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {loading ? (
          <Card>
            <EmptyState title="Carregando…" description="Buscando provedores cadastrados." />
          </Card>
        ) : providers.length === 0 ? (
          <Card>
            <EmptyState
              title="Nenhum provedor cadastrado"
              description="Cadastre pelo menos um provedor para poder criar agentes."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus className="size-4" /> Novo provedor
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {providers.map((provider) => (
              <Card key={provider.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {provider.name}
                      <Badge tone={provider.enabled ? "success" : "neutral"}>
                        {provider.enabled ? "ativo" : "inativo"}
                      </Badge>
                    </span>
                  }
                  subtitle={`${provider.kind} · ${provider.baseUrl ?? "URL padrão"}`}
                  action={
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        onClick={() => refreshModels(provider)}
                        disabled={busyId === provider.id}
                        title="Descobrir modelos"
                      >
                        {busyId === provider.id ? <Spinner /> : <RefreshCw className="size-3.5" />}
                        Modelos
                      </Button>
                      {canWrite ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => toggle(provider)}>
                            {provider.enabled ? "Desativar" : "Ativar"}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => remove(provider)} title="Excluir">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  }
                />
                <div className="space-y-3 p-5">
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <span className="font-medium text-fg">Chave:</span>
                    {provider.hasApiKey ? (
                      <Badge tone="success">configurada e cifrada</Badge>
                    ) : (
                      <span>via variável de ambiente</span>
                    )}
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-medium">Modelos ({provider.models.length})</p>
                    {provider.models.length === 0 ? (
                      <p className="text-xs text-fg-muted">
                        Clique em “Modelos” para consultar o provedor.
                      </p>
                    ) : (
                      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                        {provider.models.map((model) => (
                          <Badge key={model}>{model}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
