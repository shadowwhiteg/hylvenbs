"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui";
import type { GraphDataDto, GraphNodeState } from "@/lib/client";

const STATE_TONE: Record<GraphNodeState, "neutral" | "warning" | "success" | "danger"> = {
  idle: "neutral",
  running: "warning",
  ok: "success",
  error: "danger",
  cancelled: "neutral",
};

const TYPE_LABEL = {
  orchestrator: "orquestrador",
  agent: "agente",
  subagent: "subagente",
  mcpServer: "servidor MCP",
} as const;

/** Painel de detalhe do nó selecionado (RQ-VIS-04): categoria do erro, métricas, link para o log correlacionado. */
export function NodeDetail({
  graph,
  nodeId,
  onClose,
  onSeeInLog,
}: {
  graph: GraphDataDto;
  nodeId: string;
  onClose: () => void;
  onSeeInLog?: () => void;
}) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const runtime = graph.runtime?.nodes[nodeId];
  const state = runtime?.state ?? "idle";

  const incoming = graph.edges.filter((e) => e.to === nodeId);
  const outgoing = graph.edges.filter((e) => e.from === nodeId);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{node.label}</p>
          <p className="text-xs text-fg-muted">{TYPE_LABEL[node.type]}</p>
        </div>
        <button type="button" onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Fechar detalhe">
          <X className="size-4" />
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Badge tone={STATE_TONE[state]}>{state}</Badge>
        {node.model ? <Badge>{node.model}</Badge> : null}
        {node.provider ? <Badge>{node.provider}</Badge> : null}
        {node.enabled === false ? <Badge tone="warning">desabilitado</Badge> : null}
      </div>

      {runtime ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-fg-muted">Chamadas</dt>
          <dd className="font-mono">{runtime.calls}</dd>
          <dt className="text-fg-muted">Duração</dt>
          <dd className="font-mono">{runtime.durationMs != null ? `${runtime.durationMs}ms` : "—"}</dd>
          <dt className="text-fg-muted">Tokens</dt>
          <dd className="font-mono">
            {runtime.inputTokens}/{runtime.outputTokens}
          </dd>
          <dt className="text-fg-muted">Erros</dt>
          <dd className="font-mono">{runtime.errorCount}</dd>
        </dl>
      ) : (
        <p className="text-xs text-fg-muted">Sem execução registrada para este nó ainda.</p>
      )}

      {runtime?.errorType ? (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="text-xs font-medium text-danger">{runtime.errorType}</p>
          {runtime.errorMessage ? <p className="mt-1 text-xs text-danger/90 whitespace-pre-wrap">{runtime.errorMessage}</p> : null}
        </div>
      ) : null}

      <div className="mt-3 space-y-1 text-[11px] text-fg-muted">
        {incoming.length ? <p>{incoming.length} aresta(s) de entrada</p> : null}
        {outgoing.length ? <p>{outgoing.length} aresta(s) de saída</p> : null}
      </div>

      {onSeeInLog ? (
        <button type="button" onClick={onSeeInLog} className="mt-3 text-xs text-accent hover:underline">
          ver no log →
        </button>
      ) : null}
    </div>
  );
}
