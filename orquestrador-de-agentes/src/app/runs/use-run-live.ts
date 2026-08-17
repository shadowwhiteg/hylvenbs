"use client";

import { useEffect, useRef, useState } from "react";
import { api, type LogEntryDto, type RunDto, type RunStatus, type SpanDto } from "@/lib/client";

const ACTIVE_STATUSES: RunStatus[] = ["queued", "running"];

/**
 * Acompanha uma run ao vivo por SSE (RQ-ASY-03/04): busca o estado inicial e depois
 * assina `/api/runs/:id/events`, aplicando `span`/`log`/`status`/`done` no estado
 * local. Reconecta sozinho (comportamento nativo do EventSource) — o servidor
 * reenvia a partir do `Last-Event-ID` automaticamente.
 */
export function useRunLive(runId: string | null) {
  const [run, setRun] = useState<RunDto | null>(null);
  const [spans, setSpans] = useState<Map<string, SpanDto>>(new Map());
  const [logs, setLogs] = useState<LogEntryDto[]>([]);
  const [live, setLive] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    sourceRef.current?.close();
    setRun(null);
    setSpans(new Map());
    setLogs([]);
    setLive(false);
    if (!runId) return;

    let cancelled = false;

    Promise.all([api.get<RunDto>(`/api/runs/${runId}`), api.get<LogEntryDto[]>(`/api/runs/${runId}/logs?limit=5000`)])
      .then(([full, initialLogs]) => {
        if (cancelled) return;
        setRun(full);
        setSpans(new Map((full.spans ?? []).map((s) => [s.spanId, s])));
        setLogs(initialLogs);
      })
      .catch(() => undefined);

    const source = new EventSource(`/api/runs/${runId}/events`);
    sourceRef.current = source;
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);

    source.addEventListener("span", (ev) => {
      const span = JSON.parse((ev as MessageEvent).data) as SpanDto;
      setSpans((prev) => {
        const next = new Map(prev);
        next.set(span.spanId, span);
        return next;
      });
    });

    source.addEventListener("log", (ev) => {
      const entry = JSON.parse((ev as MessageEvent).data) as LogEntryDto;
      setLogs((prev) => (prev.some((l) => l.seq === entry.seq) ? prev : [...prev, entry].sort((a, b) => a.seq - b.seq)));
    });

    source.addEventListener("status", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { status: RunStatus; errorType: string | null };
      setRun((prev) => (prev ? { ...prev, status: data.status, errorType: data.errorType } : prev));
    });

    source.addEventListener("done", () => {
      source.close();
      setLive(false);
      api
        .get<RunDto>(`/api/runs/${runId}`)
        .then((full) => {
          if (!cancelled) {
            setRun(full);
            setSpans(new Map((full.spans ?? []).map((s) => [s.spanId, s])));
          }
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
      source.close();
      sourceRef.current = null;
    };
  }, [runId]);

  const sortedSpans = [...spans.values()].sort((a, b) => a.seq - b.seq);
  const isActive = run ? ACTIVE_STATUSES.includes(run.status) : false;

  async function cancel() {
    if (!runId) return;
    await api.post(`/api/runs/${runId}/cancel`);
  }

  return { run, spans: sortedSpans, logs, live, isActive, cancel };
}
