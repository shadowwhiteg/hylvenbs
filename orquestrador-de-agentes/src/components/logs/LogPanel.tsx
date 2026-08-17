"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui";
import type { LogEntryDto, SpanDto } from "@/lib/client";
import { exportLogsJson, exportLogsText } from "@/lib/graph/export";

const ROW_HEIGHT = 28;
const OVERSCAN = 10;
const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_TONE: Record<Level, "neutral" | "warning" | "danger"> = {
  debug: "neutral",
  info: "neutral",
  warn: "warning",
  error: "danger",
};

function pretty(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return Object.keys(parsed).length ? JSON.stringify(parsed, null, 2) : "";
  } catch {
    return "";
  }
}

/**
 * Painel de log virtualizado (RQ-VIS-05, RQ-NFR-02, T6.6). Altura fixa por linha,
 * renderiza só a janela visível + folga — lista homogênea, sem biblioteca externa.
 * Filtros por nível/texto/nó selecionado (T6.7) e uma aba só com erros.
 */
export function LogPanel({
  logs,
  spans,
  selectedNodeId,
  onSelectSpan,
  className,
}: {
  logs: LogEntryDto[];
  spans: SpanDto[];
  selectedNodeId: string | null;
  onSelectSpan?: (nodeId: string) => void;
  className?: string;
}) {
  const [levels, setLevels] = useState<Set<Level>>(new Set(LEVELS));
  const [text, setText] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(360);

  const spanById = useMemo(() => new Map(spans.map((s) => [s.spanId, s])), [spans]);

  const filtered = useMemo(() => {
    return logs.filter((entry) => {
      if (errorsOnly && entry.level !== "error") return false;
      if (!errorsOnly && !levels.has(entry.level as Level)) return false;
      if (selectedNodeId) {
        const span = entry.spanId ? spanById.get(entry.spanId) : null;
        if (span?.agent?.id !== selectedNodeId) return false;
      }
      if (text && !entry.message.toLowerCase().includes(text.toLowerCase())) return false;
      return true;
    });
  }, [logs, levels, errorsOnly, selectedNodeId, spanById, text]);

  const errorGroups = useMemo(() => {
    const groups = new Map<string, LogEntryDto[]>();
    for (const entry of logs) {
      if (entry.level !== "error") continue;
      const key = entry.errorType ?? "erro";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }
    return groups;
  }, [logs]);

  const counts = useMemo(() => {
    const c: Record<Level, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const entry of logs) c[entry.level as Level] = (c[entry.level as Level] ?? 0) + 1;
    return c;
  }, [logs]);

  function toggleLevel(level: Level) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2;
    setFollow(atBottom);
  }

  function scrollToEnd() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setFollow(true);
  }

  const totalHeight = filtered.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(filtered.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const visible = filtered.slice(startIndex, endIndex);

  // Segue a execução: quando novas linhas chegam e follow está ligado, rola para o fim.
  const prevLenRef = useRef(0);
  if (filtered.length !== prevLenRef.current) {
    prevLenRef.current = filtered.length;
    if (follow) requestAnimationFrame(scrollToEnd);
  }

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => {
              setErrorsOnly(false);
              toggleLevel(level);
            }}
            className={clsx(
              "rounded-md px-2 py-1 transition",
              !errorsOnly && levels.has(level) ? "bg-accent-soft text-accent" : "bg-bg-subtle text-fg-muted",
            )}
          >
            {level} ({counts[level] ?? 0})
          </button>
        ))}
        <button
          type="button"
          onClick={() => setErrorsOnly((v) => !v)}
          className={clsx("rounded-md px-2 py-1", errorsOnly ? "bg-danger/15 text-danger" : "bg-bg-subtle text-fg-muted")}
        >
          Erros ({counts.error})
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="filtrar texto…"
          className="ml-auto w-40 rounded-md border border-border bg-bg-subtle px-2 py-1 text-xs focus:outline-none"
        />
        {selectedNodeId ? <Badge tone="accent">filtrado por nó selecionado</Badge> : null}
        <button type="button" onClick={() => exportLogsJson(filtered)} className="rounded-md bg-bg-subtle px-2 py-1 text-fg-muted">
          JSON
        </button>
        <button
          type="button"
          onClick={() =>
            exportLogsText(
              filtered.map((e) => `${new Date(e.createdAt).toISOString()} [${e.level}] ${e.message}`),
            )
          }
          className="rounded-md bg-bg-subtle px-2 py-1 text-fg-muted"
        >
          Texto
        </button>
      </div>

      {errorsOnly ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {[...errorGroups.entries()].map(([type, entries]) => (
            <Badge key={type} tone="danger">
              {type} ×{entries.length}
            </Badge>
          ))}
          {errorGroups.size === 0 ? <p className="text-xs text-fg-muted">Sem erros.</p> : null}
        </div>
      ) : null}

      <div className="relative">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-[360px] overflow-y-auto rounded-lg border border-border bg-bg-subtle font-mono text-[11px]"
          onMouseEnter={(e) => setViewportHeight(e.currentTarget.clientHeight)}
        >
          {filtered.length === 0 ? (
            <p className="p-4 text-fg-muted">Sem linhas de log.</p>
          ) : (
            <div style={{ height: totalHeight, position: "relative" }}>
              {visible.map((entry, i) => {
                const index = startIndex + i;
                const isOpen = expanded.has(entry.id);
                const payload = pretty(entry.payload);
                const span = entry.spanId ? spanById.get(entry.spanId) : null;
                return (
                  <div
                    key={entry.id}
                    style={{ position: "absolute", top: index * ROW_HEIGHT, left: 0, right: 0, minHeight: ROW_HEIGHT }}
                    className="flex cursor-pointer items-start gap-2 border-b border-border/50 px-2 py-1.5 hover:bg-surface-hover"
                    onClick={() => {
                      if (payload) {
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(entry.id)) next.delete(entry.id);
                          else next.add(entry.id);
                          return next;
                        });
                      }
                      if (span?.agent?.id && onSelectSpan) onSelectSpan(span.agent.id);
                    }}
                  >
                    <span className="shrink-0 text-fg-muted">{new Date(entry.createdAt).toLocaleTimeString("pt-BR")}</span>
                    <Badge tone={LEVEL_TONE[entry.level as Level]}>{entry.level}</Badge>
                    {span?.agent ? <span className="shrink-0 text-fg-muted">{span.agent.name}</span> : null}
                    <span className="min-w-0 flex-1 truncate whitespace-pre-wrap">
                      {entry.message}
                      {isOpen && payload ? <pre className="mt-1 whitespace-pre-wrap text-fg-muted">{payload}</pre> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {!follow ? (
          <button
            type="button"
            onClick={scrollToEnd}
            className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs shadow-[var(--shadow)] hover:bg-surface-hover"
          >
            <ArrowDown className="size-3.5" /> Ir para o fim
          </button>
        ) : null}
      </div>
    </div>
  );
}
