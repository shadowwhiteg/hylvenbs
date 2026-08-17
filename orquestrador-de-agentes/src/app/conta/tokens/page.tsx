"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Copy, Plug, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { api, type ApiTokenDto } from "@/lib/client";

type OpenAiModelDto = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  orq: { agent_id: string; flow_id: string | null; published_version: number | null; name: string };
};

export default function TokensPage() {
  const [tokens, setTokens] = useState<ApiTokenDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  async function reload() {
    setTokens(await api.get<ApiTokenDto[]>("/api/tokens"));
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const result = await api.post<ApiTokenDto & { token: string }>("/api/tokens", { name });
      setJustCreated(result.token);
      setName("");
      setCreating(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revogar este token?")) return;
    await api.del(`/api/tokens/${id}`);
    await reload();
  }

  return (
    <>
      <PageHeader
        title="Meus tokens de API"
        description="Use um token no header Authorization: Bearer <token> — mesma permissão do seu papel."
        action={
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            {creating ? <X className="size-4" /> : <Plus className="size-4" />}
            {creating ? "Cancelar" : "Novo token"}
          </Button>
        }
      />
      <div className="space-y-4 p-8">
        {error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {justCreated ? (
          <Card>
            <div className="space-y-2 p-5">
              <p className="text-sm font-medium">Token criado — copie agora, ele não será mostrado de novo.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md bg-bg-subtle px-2.5 py-1.5 font-mono text-xs">
                  {justCreated}
                </code>
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(justCreated);
                  }}
                >
                  <Copy className="size-3.5" /> Copiar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setJustCreated(null)}>
                  <Check className="size-3.5" /> Ok
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {creating ? (
          <Card>
            <CardHeader title="Novo token" />
            <div className="flex items-end gap-3 p-5">
              <Field label="Nome" className="flex-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI" />
              </Field>
              <Button variant="primary" onClick={create} disabled={!name}>
                Criar
              </Button>
            </div>
          </Card>
        ) : null}

        {loading ? (
          <Card>
            <EmptyState title="Carregando…" description="Buscando tokens." />
          </Card>
        ) : tokens.length === 0 ? (
          <Card>
            <EmptyState title="Nenhum token" description="Crie um token para automatizar chamadas à API." />
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-border">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {t.name}
                      {t.revoked ? <Badge tone="danger">revogado</Badge> : null}
                      {t.owner ? <Badge>{t.owner.name}</Badge> : null}
                    </p>
                    <p className="font-mono text-xs text-fg-muted">{t.prefix}…</p>
                  </div>
                  {!t.revoked ? (
                    <Button size="sm" variant="danger" onClick={() => revoke(t.id)}>
                      <Trash2 className="size-3.5" /> Revogar
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        )}

        <OpenAiIntegration token={justCreated} />
      </div>
    </>
  );
}

const LANG_TABS = ["curl", "python", "javascript", "outro"] as const;
type LangTab = (typeof LANG_TABS)[number];
const LANG_LABEL: Record<LangTab, string> = { curl: "curl", python: "Python", javascript: "JavaScript", outro: "Outro sistema" };

/**
 * Tutorial de integração via OpenAI-compatível (design 010, RQ-OAI-12). Vive ao lado
 * do token porque é o único instante em que ele existe em claro.
 */
function OpenAiIntegration({ token }: { token: string | null }) {
  const [models, setModels] = useState<OpenAiModelDto[]>([]);
  const [orchestratorId, setOrchestratorId] = useState("");
  const [version, setVersion] = useState("draft");
  const [tab, setTab] = useState<LangTab>("curl");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get<{ data: OpenAiModelDto[] }>("/api/v1/models")
      .then((res) => {
        setModels(res.data);
        if (res.data.length > 0) setOrchestratorId(res.data[0]!.id);
      })
      .catch(() => setModels([]));
  }, []);

  const selected = models.find((m) => m.id === orchestratorId) ?? null;

  const model = useMemo(() => {
    if (!selected) return "";
    if (version === "draft") return selected.id;
    if (version === "current") return `${selected.id}@current`;
    return `${selected.id}@${version}`;
  }, [selected, version]);

  const baseUrl = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "<host>/api/v1";
  const apiKey = token ?? "SEU_TOKEN";

  const snippets: Record<LangTab, string> = {
    curl: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Qual a garantia do Pulse?"}]
  }'`,
    python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${apiKey}")
r = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Qual a garantia do Pulse?"}],
)
print(r.choices[0].message.content)`,
    javascript: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${baseUrl}", apiKey: "${apiKey}" });
const r = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Qual a garantia do Pulse?" }],
});
console.log(r.choices[0].message.content);`,
    outro: `n8n, Dify, Open WebUI, LibreChat e a maioria dos plugins de IDE têm um bloco de
configuração "OpenAI-Compatible" (ou "Custom OpenAI Endpoint") com estes três campos:

  Base URL / API Base   ${baseUrl}
  API Key                ${apiKey}
  Model                  ${model}

Se o sistema pedir "Organization" ou "Project", deixe em branco — não se aplica aqui.`,
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Plug className="size-3.5" /> Conectar via API OpenAI-compatível
          </span>
        }
        subtitle="Qualquer sistema que fale o dialeto chat/completions pode chamar um orquestrador publicado como se fosse um modelo."
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Orquestrador">
            <Select value={orchestratorId} onChange={(e) => setOrchestratorId(e.target.value)} disabled={models.length === 0}>
              {models.length === 0 ? (
                <option value="">nenhum orquestrador publicável ainda</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.orq.name} ({m.id})
                  </option>
                ))
              )}
            </Select>
          </Field>
          <Field label="Versão">
            <Select value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="draft">Rascunho vigente</option>
              {selected?.orq.published_version ? (
                <>
                  <option value="current">Publicada atual (@current = v{selected.orq.published_version})</option>
                  {Array.from({ length: selected.orq.published_version }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={String(n)}>
                      Versão publicada v{n}
                    </option>
                  ))}
                </>
              ) : null}
            </Select>
          </Field>
        </div>

        <dl className="grid gap-2 rounded-lg bg-bg-subtle p-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-fg-muted">URL base</dt>
            <dd className="font-mono">{baseUrl}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">API key</dt>
            <dd className="truncate font-mono">{apiKey}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Model</dt>
            <dd className="truncate font-mono">{model || "—"}</dd>
          </div>
        </dl>

        <div className="flex gap-1 border-b border-border">
          {LANG_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={clsx(
                "border-b-2 px-3 py-1.5 text-xs font-medium transition",
                tab === t ? "border-accent text-accent" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {LANG_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="relative">
          <pre className="max-h-72 overflow-auto rounded-lg bg-bg-subtle p-3 text-xs whitespace-pre-wrap">
            <code>{snippets[tab]}</code>
          </pre>
          <Button
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => {
              navigator.clipboard.writeText(snippets[tab]);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>

        <ul className="space-y-1 text-xs text-fg-muted">
          <li>⚠ Sem memória entre chamadas — cada requisição é uma run nova; mande o histórico inteiro em `messages`.</li>
          <li>⚠ `temperature`, `top_p`, `max_tokens` e afins são ignorados — quem decide o modelo é o fluxo publicado.</li>
          <li>⚠ A primeira resposta demora o que o fluxo demorar — suba o timeout do cliente, principalmente com delegação em vários níveis.</li>
        </ul>
      </div>
    </Card>
  );
}
