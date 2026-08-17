"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, Plug, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { can, useMe } from "@/lib/auth-client";
import { api, type McpServerDto } from "@/lib/client";

type Draft = {
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  transport: "stdio",
  command: "npx",
  args: "-y @modelcontextprotocol/server-filesystem /tmp",
  env: "{}",
  url: "",
  headers: "{}",
};

/** Argumentos são digitados numa linha só, com aspas para agrupar. */
function splitArgs(value: string): string[] {
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^['"]|['"]$/g, "")) ?? [];
}

export default function McpPage() {
  const { me } = useMe();
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [secretsId, setSecretsId] = useState<string | null>(null);
  const [secretsEnv, setSecretsEnv] = useState("{}");
  const [secretsHeaders, setSecretsHeaders] = useState("{}");

  async function reload() {
    setServers(await api.get<McpServerDto[]>("/api/mcp"));
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api.post("/api/mcp", {
        name: draft.name,
        transport: draft.transport,
        command: draft.transport === "stdio" ? draft.command : null,
        args: draft.transport === "stdio" ? splitArgs(draft.args) : [],
        env: JSON.parse(draft.env || "{}"),
        url: draft.transport === "http" ? draft.url : null,
        headers: JSON.parse(draft.headers || "{}"),
      });
      setDraft(EMPTY_DRAFT);
      setCreating(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function probe(server: McpServerDto) {
    setProbingId(server.id);
    setError(null);
    try {
      const result = await api.post<{ status: string; error?: string }>(`/api/mcp/${server.id}/probe`);
      if (result.status === "error") setError(`${server.name}: ${result.error}`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProbingId(null);
    }
  }

  async function remove(server: McpServerDto) {
    if (!confirm(`Excluir o servidor "${server.name}"?`)) return;
    await api.del(`/api/mcp/${server.id}`);
    await reload();
  }

  function openSecrets(server: McpServerDto) {
    const envTemplate = Object.fromEntries(server.envKeys.map((k) => [k, ""]));
    const headersTemplate = Object.fromEntries(server.headerKeys.map((k) => [k, ""]));
    setSecretsEnv(JSON.stringify(envTemplate, null, 2));
    setSecretsHeaders(JSON.stringify(headersTemplate, null, 2));
    setSecretsId(server.id);
  }

  async function saveSecrets() {
    if (!secretsId) return;
    setError(null);
    try {
      await api.put(`/api/mcp/${secretsId}/secrets`, {
        env: JSON.parse(secretsEnv || "{}"),
        headers: JSON.parse(secretsHeaders || "{}"),
      });
      setSecretsId(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Servidores MCP"
        description="Ferramentas expostas via Model Context Protocol, por stdio ou HTTP streamable."
        action={
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            {creating ? <X className="size-4" /> : <Plus className="size-4" />}
            {creating ? "Cancelar" : "Novo servidor"}
          </Button>
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
            <CardHeader title="Novo servidor MCP" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Nome" hint="usado como prefixo das tools">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="filesystem"
                />
              </Field>
              <Field label="Transporte">
                <Select
                  value={draft.transport}
                  onChange={(e) => setDraft({ ...draft, transport: e.target.value as "stdio" | "http" })}
                >
                  <option value="stdio">stdio (processo local)</option>
                  <option value="http">http (streamable)</option>
                </Select>
              </Field>

              {draft.transport === "stdio" ? (
                <>
                  <Field label="Comando">
                    <Input
                      value={draft.command}
                      onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                    />
                  </Field>
                  <Field label="Argumentos" hint="separados por espaço">
                    <Input value={draft.args} onChange={(e) => setDraft({ ...draft, args: e.target.value })} />
                  </Field>
                  <Field label="Variáveis de ambiente (JSON)" className="sm:col-span-2">
                    <Textarea
                      rows={3}
                      value={draft.env}
                      onChange={(e) => setDraft({ ...draft, env: e.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="URL" className="sm:col-span-2">
                    <Input
                      value={draft.url}
                      onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                      placeholder="https://exemplo.com/mcp"
                    />
                  </Field>
                  <Field label="Headers (JSON)" className="sm:col-span-2">
                    <Textarea
                      rows={3}
                      value={draft.headers}
                      onChange={(e) => setDraft({ ...draft, headers: e.target.value })}
                    />
                  </Field>
                </>
              )}

              <div className="sm:col-span-2">
                <Button variant="primary" onClick={create} disabled={!draft.name}>
                  <Check className="size-4" /> Criar servidor
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {loading ? (
          <Card>
            <EmptyState title="Carregando…" description="Buscando servidores MCP." />
          </Card>
        ) : servers.length === 0 ? (
          <Card>
            <EmptyState
              title="Nenhum servidor MCP"
              description="Cadastre um servidor para dar ferramentas aos seus agentes."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus className="size-4" /> Novo servidor
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {servers.map((server) => (
              <Card key={server.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {server.name}
                      <Badge tone={server.transport === "stdio" ? "neutral" : "accent"}>
                        {server.transport}
                      </Badge>
                      {server.lastStatus ? (
                        <Badge tone={server.lastStatus === "ok" ? "success" : "danger"}>
                          {server.lastStatus === "ok" ? "conectado" : "falhou"}
                        </Badge>
                      ) : null}
                      {server.secretsStatus === "awaiting_secret" ? (
                        <Badge tone="warning">aguardando segredo</Badge>
                      ) : null}
                    </span>
                  }
                  subtitle={
                    server.transport === "stdio"
                      ? `${server.command} ${server.args.join(" ")}`
                      : (server.url ?? "")
                  }
                  action={
                    <div className="flex items-center gap-1">
                      {can(me, "secret.write") && (server.envKeys.length > 0 || server.headerKeys.length > 0) ? (
                        <Button size="sm" onClick={() => openSecrets(server)} title="Definir segredos">
                          <KeyRound className="size-3.5" />
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => probe(server)} disabled={probingId === server.id}>
                        {probingId === server.id ? <Spinner /> : <Plug className="size-3.5" />}
                        Testar
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => remove(server)} title="Excluir">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  }
                />
                {secretsId === server.id ? (
                  <div className="space-y-3 border-b border-border bg-bg-subtle/50 p-5">
                    {server.envKeys.length > 0 ? (
                      <Field label="Valores de env (JSON)">
                        <Textarea rows={3} value={secretsEnv} onChange={(e) => setSecretsEnv(e.target.value)} />
                      </Field>
                    ) : null}
                    {server.headerKeys.length > 0 ? (
                      <Field label="Valores de headers (JSON)">
                        <Textarea
                          rows={3}
                          value={secretsHeaders}
                          onChange={(e) => setSecretsHeaders(e.target.value)}
                        />
                      </Field>
                    ) : null}
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onClick={saveSecrets}>
                        <Check className="size-3.5" /> Salvar segredos
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSecretsId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="p-5">
                  {server.lastError ? (
                    <p className="mb-3 rounded-md bg-danger/10 px-2.5 py-2 font-mono text-[11px] text-danger">
                      {server.lastError}
                    </p>
                  ) : null}
                  <p className="mb-1.5 text-xs font-medium">Tools ({server.tools.length})</p>
                  {server.tools.length === 0 ? (
                    <p className="text-xs text-fg-muted">Clique em “Testar” para listar as tools.</p>
                  ) : (
                    <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                      {server.tools.map((tool) => (
                        <li key={tool.name} className="rounded-md bg-bg-subtle px-2.5 py-1.5">
                          <p className="font-mono text-[11px] text-accent">{tool.name}</p>
                          <p className="line-clamp-2 text-[11px] text-fg-muted">{tool.description}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
