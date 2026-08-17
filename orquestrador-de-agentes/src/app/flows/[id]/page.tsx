"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, History, RotateCcw, Tag, Upload } from "lucide-react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { GraphTree } from "@/components/graph/GraphTree";
import { GraphView } from "@/components/graph/GraphView";
import { NodeDetail } from "@/components/graph/NodeDetail";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, Spinner } from "@/components/ui";
import { can, useMe } from "@/lib/auth-client";
import { api, type DiffEntryDto, type FlowDto, type FlowVersionDto, type GraphDataDto } from "@/lib/client";

type FlowDetail = FlowDto & { draft: unknown; isDirty: boolean };

export default function FlowDetailPage() {
  const params = useParams<{ id: string }>();
  const flowId = params.id;
  const { me } = useMe();
  const canPublish = can(me, "flow.publish");
  const canRollback = can(me, "flow.rollback");

  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [versions, setVersions] = useState<FlowVersionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [publishing, setPublishing] = useState(false);

  const [from, setFrom] = useState("draft");
  const [to, setTo] = useState("draft");
  const [diff, setDiff] = useState<DiffEntryDto[] | null>(null);
  const [diffing, setDiffing] = useState(false);

  const [graphVersion, setGraphVersion] = useState("draft");
  const [graph, setGraph] = useState<GraphDataDto | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [nextFlow, nextVersions] = await Promise.all([
      api.get<FlowDetail>(`/api/flows/${flowId}`),
      api.get<FlowVersionDto[]>(`/api/flows/${flowId}/versions`),
    ]);
    setFlow(nextFlow);
    setVersions(nextVersions);
    if (nextVersions.length > 0 && to === "draft") setTo(String(nextVersions[0].version));
    if (nextVersions.length > 1 && from === "draft") setFrom(String(nextVersions[1]?.version ?? nextVersions[0].version));
    return nextVersions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);

  useEffect(() => {
    setSelectedNodeId(null);
    api
      .get<GraphDataDto>(`/api/flows/${flowId}/graph?version=${encodeURIComponent(graphVersion)}`)
      .then(setGraph)
      .catch(() => setGraph(null));
  }, [flowId, graphVersion]);

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      await api.post(`/api/flows/${flowId}/publish`, { message });
      setMessage("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function rollback(version: number) {
    if (!confirm(`Reverter para a v${version}? Isso publica uma versão nova com o conteúdo daquela versão.`)) return;
    setError(null);
    try {
      await api.post(`/api/flows/${flowId}/versions/${version}/rollback`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function tagVersion(version: number) {
    const tag = prompt(`Etiqueta para a v${version} (ex.: producao):`);
    if (!tag) return;
    setError(null);
    try {
      await api.post(`/api/flows/${flowId}/versions/${version}/tag`, { tag });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runDiff() {
    setDiffing(true);
    setError(null);
    setDiff(null);
    try {
      const result = await api.get<{ entries: DiffEntryDto[] }>(
        `/api/flows/${flowId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setDiff(result.entries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDiffing(false);
    }
  }

  if (!flow) {
    return (
      <>
        <PageHeader title="Fluxo" />
        <div className="flex items-center justify-center p-16">
          <Spinner />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={flow.name}
        description={flow.description || "Grafo do orquestrador e seus subagentes, versionado."}
        action={
          <Badge tone={flow.isDirty ? "warning" : "success"}>
            {flow.isDirty ? "alterações não publicadas" : "rascunho igual à última versão"}
          </Badge>
        }
      />

      <div className="space-y-4 p-8">
        {error ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        ) : null}

        {canPublish ? (
          <Card>
            <CardHeader title="Publicar versão" subtitle="Congela o rascunho atual como uma versão imutável (RQ-VER-02)." />
            <div className="flex items-end gap-3 p-5">
              <Field label="Mensagem" className="flex-1">
                <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="O que mudou nesta versão?" />
              </Field>
              <Button variant="primary" onClick={publish} disabled={publishing || !flow.isDirty}>
                {publishing ? <Spinner /> : <Upload className="size-3.5" />} Publicar
              </Button>
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Comparar" subtitle="Diferenças estruturais entre duas versões, ou contra o rascunho." />
          <div className="flex flex-wrap items-end gap-3 p-5">
            <Field label="De">
              <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="draft">rascunho</option>
                {versions?.map((v) => (
                  <option key={v.id} value={v.version}>
                    v{v.version}
                    {v.tag ? ` (${v.tag})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Para">
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="draft">rascunho</option>
                {versions?.map((v) => (
                  <option key={v.id} value={v.version}>
                    v{v.version}
                    {v.tag ? ` (${v.tag})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Button onClick={runDiff} disabled={diffing}>
              {diffing ? <Spinner /> : <ArrowLeftRight className="size-3.5" />} Comparar
            </Button>
          </div>
          {diff ? (
            <div className="border-t border-border p-5">
              {diff.length === 0 ? (
                <p className="text-xs text-fg-muted">Nenhuma diferença.</p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {diff.map((entry, i) => (
                    <li key={i} className="rounded-md bg-bg-subtle px-3 py-2 font-mono">
                      <DiffLine entry={entry} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Grafo"
            subtitle="Topologia da versão escolhida (RQ-VIS-01)."
            action={
              <Select value={graphVersion} onChange={(e) => setGraphVersion(e.target.value)} className="w-auto">
                <option value="draft">rascunho</option>
                {versions?.map((v) => (
                  <option key={v.id} value={v.version}>
                    v{v.version}
                    {v.tag ? ` (${v.tag})` : ""}
                  </option>
                ))}
              </Select>
            }
          />
          {graph ? (
            <div className="grid gap-4 p-5 lg:grid-cols-[2fr_1fr]">
              <GraphView graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
              <div className="space-y-3">
                {selectedNodeId ? (
                  <NodeDetail graph={graph} nodeId={selectedNodeId} onClose={() => setSelectedNodeId(null)} />
                ) : (
                  <GraphTree graph={graph} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center p-10">
              <Spinner />
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Versões" subtitle="Linha do tempo — histórico append-only, nada é apagado (RQ-VER-08)." />
          {!versions || versions.length === 0 ? (
            <EmptyState title="Nenhuma versão publicada" description="Publique o rascunho acima para começar o histórico." />
          ) : (
            <div className="divide-y divide-border">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone="accent">v{v.version}</Badge>
                      {v.tag ? (
                        <Badge>
                          <Tag className="size-3" /> {v.tag}
                        </Badge>
                      ) : null}
                      {flow.currentVersion?.version === v.version ? <Badge tone="success">atual</Badge> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-fg-muted">
                      {v.message || "(sem mensagem)"} · {new Date(v.createdAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {canPublish ? (
                      <Button size="sm" variant="ghost" onClick={() => tagVersion(v.version)} title="Etiquetar">
                        <Tag className="size-3.5" />
                      </Button>
                    ) : null}
                    {canRollback ? (
                      <Button size="sm" variant="secondary" onClick={() => rollback(v.version)} title="Rollback">
                        <RotateCcw className="size-3.5" /> Rollback
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function DiffLine({ entry }: { entry: DiffEntryDto }) {
  switch (entry.type) {
    case "agent.added":
      return <span className="text-success">+ agente "{entry.name}" adicionado</span>;
    case "agent.removed":
      return <span className="text-danger">- agente "{entry.name}" removido</span>;
    case "agent.changed":
      return (
        <span>
          <History className="mr-1 inline size-3 text-fg-muted" />
          "{entry.name}".{entry.field}: <span className="text-danger">{JSON.stringify(entry.from)}</span> →{" "}
          <span className="text-success">{JSON.stringify(entry.to)}</span>
        </span>
      );
    case "edge.added":
      return <span className="text-success">+ delegação {entry.from} → {entry.to}</span>;
    case "edge.removed":
      return <span className="text-danger">- delegação {entry.from} → {entry.to}</span>;
    case "mcp.bound":
      return <span className="text-success">+ servidor MCP vinculado ao agente {entry.agentId}</span>;
    case "mcp.unbound":
      return <span className="text-danger">- servidor MCP desvinculado do agente {entry.agentId}</span>;
    case "mcp.configChanged":
      return <span className="text-warning">~ configuração de "{entry.name}" mudou</span>;
    default:
      return null;
  }
}
