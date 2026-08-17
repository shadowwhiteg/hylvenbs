"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { GraphTree } from "@/components/graph/GraphTree";
import { GraphView } from "@/components/graph/GraphView";
import { NodeDetail } from "@/components/graph/NodeDetail";
import { LogPanel } from "@/components/logs/LogPanel";
import { Badge, Button, Card, CardHeader, Spinner } from "@/components/ui";
import { useRunGraph } from "@/components/graph/useRunGraph";
import { useRunLive } from "../use-run-live";

const STATUS_TONE = {
  queued: "neutral",
  running: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
  timed_out: "danger",
} as const;

const SPAN_TONE = {
  agent: "accent",
  model: "neutral",
  tool: "neutral",
  delegate: "warning",
  "mcp.connect": "neutral",
} as const;

function pretty(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return Object.keys(parsed).length ? JSON.stringify(parsed, null, 2) : "";
  } catch {
    return "";
  }
}

/** Cabeçalho + trace ao vivo por SSE. Recebe o estado inicial vindo do servidor para não piscar no primeiro render. */
export function RunTrace({ runId }: { runId: string }) {
  const { run, spans, logs, live, isActive, cancel } = useRunLive(runId);
  const { graph } = useRunGraph(runId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  if (!run) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{run.status}</Badge>
        {isActive ? <Badge tone={live ? "success" : "neutral"}>{live ? "ao vivo" : "reconectando…"}</Badge> : null}
        {run.errorType ? <Badge tone="danger">{run.errorType}</Badge> : null}
        {run.attempt > 1 ? <Badge>tentativa {run.attempt}</Badge> : null}
        <Badge>{run.sourceKind === "version" ? "versão fixada" : "rascunho"}</Badge>
        {run.configDrift ? (
          <span title={run.driftDetail ?? undefined}>
            <Badge tone="warning">configuração divergiu</Badge>
          </span>
        ) : null}
        {run.taskType ? <Badge tone="accent">tarefa: {run.taskType}</Badge> : null}
        {run.modelFailover ? (
          <span title="Algum modelo estava indisponível e o próximo candidato da cadeia assumiu (RQ-ROT-06).">
            <Badge tone="warning">⚠ failover de modelo</Badge>
          </span>
        ) : null}
        <Badge>{spans.length} spans</Badge>
        <Badge>
          {run.inputTokens} tokens in / {run.outputTokens} out
        </Badge>
        <Badge>{run.costUsd != null ? `~$${run.costUsd.toFixed(4)} estimado` : "custo — "}</Badge>
        <Badge>{new Date(run.queuedAt).toLocaleString("pt-BR")}</Badge>
        {isActive ? (
          <Button size="sm" variant="danger" onClick={cancel} disabled={!!run.cancelRequestedAt}>
            <X className="size-3.5" /> {run.cancelRequestedAt ? "Cancelando…" : "Cancelar"}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Entrada" />
        <p className="p-5 text-sm whitespace-pre-wrap">{run.input}</p>
      </Card>

      <Card>
        <CardHeader title={run.status === "failed" || run.status === "timed_out" ? "Erro" : "Saída final"} />
        <p className="p-5 text-sm whitespace-pre-wrap">
          {run.output ?? run.error ?? (isActive ? "Executando…" : "(vazio)")}
        </p>
      </Card>

      <Card>
        <CardHeader title="Grafo" subtitle="Topologia do snapshot que rodou, com estado por nó ao vivo (RQ-VIS-03/08)." />
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
        <CardHeader title="Log" subtitle="Correlacionado com o grafo acima — clique num nó para filtrar (RQ-VIS-05/06)." />
        <div className="p-5">
          <LogPanel logs={logs} spans={spans} selectedNodeId={selectedNodeId} onSelectSpan={setSelectedNodeId} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Trace" subtitle="Árvore de spans — indentação indica profundidade da delegação." />
        {spans.length === 0 ? (
          <p className="p-5 text-sm text-fg-muted">{isActive ? "Aguardando os primeiros spans…" : "Sem spans."}</p>
        ) : (
          <ol className="divide-y divide-border">
            {spans.map((span) => (
              <li key={span.spanId} className="px-5 py-4" style={{ paddingLeft: 20 + span.depth * 24 }}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-fg-muted">#{span.seq}</span>
                  <Badge tone={SPAN_TONE[span.kind] ?? "neutral"}>{span.kind}</Badge>
                  {span.status === "running" ? <Badge tone="warning">running</Badge> : null}
                  {span.status === "error" || span.status === "cancelled" ? (
                    <Badge tone="danger">{span.errorType ?? span.status}</Badge>
                  ) : null}
                  <span className="font-mono text-xs">{span.name}</span>
                  {span.agent ? <span className="text-[11px] text-fg-muted">por {span.agent.name}</span> : null}
                  {span.inputTokens > 0 || span.outputTokens > 0 ? (
                    <span className="text-[11px] text-fg-muted">
                      {span.inputTokens}/{span.outputTokens} tok
                    </span>
                  ) : null}
                  {span.costUsd != null ? (
                    <span className="text-[11px] text-fg-muted">~${span.costUsd.toFixed(5)}</span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-fg-muted">{span.durationMs ?? 0}ms</span>
                </div>
                {span.errorMessage ? (
                  <p className="mb-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                    {span.errorMessage}
                  </p>
                ) : null}
                {pretty(span.attributes) ? (
                  <pre className="max-h-56 overflow-auto rounded-lg bg-bg-subtle p-3 font-mono text-[11px] whitespace-pre-wrap">
                    {pretty(span.attributes)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
