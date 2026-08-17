"use client";

import { useEffect, useState } from "react";
import { api, type LogEntryDto } from "@/lib/client";
import { Badge, Button, Select, Spinner } from "@/components/ui";

const LEVEL_TONE = { debug: "neutral", info: "accent", warn: "warning", error: "danger" } as const;
const PAGE_SIZE = 200;

function pretty(payload: string): string {
  try {
    const parsed = JSON.parse(payload);
    return Object.keys(parsed).length ? JSON.stringify(parsed, null, 2) : "";
  } catch {
    return payload;
  }
}

/** Paginado — carrega em páginas de 200 em vez de tudo de uma vez (RQ-NFR-02: 5.000 logs sem travar). */
export function LogViewer({ runId }: { runId: string }) {
  const [level, setLevel] = useState("");
  const [logs, setLogs] = useState<LogEntryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function loadPage(afterSeq: number, replace: boolean) {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), afterSeq: String(afterSeq) });
      if (level) query.set("level", level);
      const page = await api.get<LogEntryDto[]>(`/api/runs/${runId}/logs?${query}`);
      setLogs((prev) => (replace ? page : [...prev, ...page]));
      setDone(page.length < PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLogs([]);
    setDone(false);
    void loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-40">
          <option value="">Todos os níveis</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
        </Select>
        {loading ? <Spinner /> : null}
      </div>

      {logs.length === 0 && !loading ? (
        <p className="text-sm text-fg-muted">Nenhum log neste nível.</p>
      ) : (
        <ol className="max-h-[32rem] space-y-2 overflow-auto">
          {logs.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-border p-3 text-xs">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge tone={LEVEL_TONE[entry.level]}>{entry.level}</Badge>
                {entry.errorType ? <Badge tone="danger">{entry.errorType}</Badge> : null}
                <span className="font-mono text-[11px] text-fg-muted">#{entry.seq}</span>
                <span className="ml-auto text-[11px] text-fg-muted">
                  {new Date(entry.createdAt).toLocaleTimeString("pt-BR")}
                </span>
              </div>
              <p>{entry.message}</p>
              {pretty(entry.payload) ? (
                <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-bg-subtle p-2 font-mono text-[11px] whitespace-pre-wrap">
                  {pretty(entry.payload)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {!done && logs.length > 0 ? (
        <Button size="sm" onClick={() => loadPage(logs.at(-1)!.seq, false)} disabled={loading}>
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
