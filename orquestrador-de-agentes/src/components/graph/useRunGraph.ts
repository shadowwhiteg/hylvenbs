"use client";

import { useEffect, useRef, useState } from "react";
import { api, type GraphDataDto, type RunDto, type RunStatus, type SpanDto } from "@/lib/client";
import { buildRuntime, type SpanRow } from "@/lib/graph/runtime";

const ACTIVE_STATUSES: RunStatus[] = ["queued", "running"];

function toSpanRow(span: SpanDto): SpanRow {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    kind: span.kind,
    status: span.status,
    errorType: span.errorType,
    errorMessage: span.errorMessage,
    attributes: span.attributes,
    agentId: span.agent?.id ?? null,
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
    durationMs: span.durationMs,
    seq: span.seq,
  };
}

/**
 * Grafo de execução ao vivo (RQ-VIS-03, T6.4). Um só caminho para "ao vivo" e
 * "depois" (design 006 D4): busca a topologia do snapshot que rodou e os spans já
 * persistidos, assina o SSE existente (/api/runs/:id/events) e reaplica
 * buildRuntime() a cada evento — o mesmo reducer do servidor, nunca dois
 * caminhos divergentes entre execução em andamento e histórico.
 */
export function useRunGraph(runId: string | null) {
  const [graph, setGraph] = useState<GraphDataDto | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const spansRef = useRef<Map<string, SpanRow>>(new Map());
  const baseRef = useRef<GraphDataDto | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    sourceRef.current?.close();
    spansRef.current = new Map();
    baseRef.current = null;
    setGraph(null);
    setStatus(null);
    if (!runId) return;

    let cancelled = false;

    function recompute() {
      const base = baseRef.current;
      if (!base) return;
      const mcpServers = base.nodes.filter((n) => n.type === "mcpServer").map((n) => ({ id: n.id, name: n.label }));
      const runtime = buildRuntime({ mcpServers }, base.edges, [...spansRef.current.values()]);
      setGraph({ rootId: base.rootId, nodes: base.nodes, edges: base.edges, runtime });
    }

    Promise.all([api.get<GraphDataDto>(`/api/runs/${runId}/graph`), api.get<RunDto>(`/api/runs/${runId}`)])
      .then(([g, run]) => {
        if (cancelled) return;
        baseRef.current = { rootId: g.rootId, nodes: g.nodes, edges: g.edges };
        for (const span of run.spans ?? []) spansRef.current.set(span.spanId, toSpanRow(span));
        setStatus(run.status);
        recompute();
      })
      .catch(() => undefined);

    const source = new EventSource(`/api/runs/${runId}/events`);
    sourceRef.current = source;

    source.addEventListener("span", (ev) => {
      const span = JSON.parse((ev as MessageEvent).data) as SpanDto;
      spansRef.current.set(span.spanId, toSpanRow(span));
      recompute();
    });

    source.addEventListener("status", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { status: RunStatus };
      setStatus(data.status);
    });

    source.addEventListener("done", () => {
      source.close();
    });

    return () => {
      cancelled = true;
      source.close();
      sourceRef.current = null;
    };
  }, [runId]);

  const isActive = status ? ACTIVE_STATUSES.includes(status) : false;
  return { graph, status, isActive };
}
