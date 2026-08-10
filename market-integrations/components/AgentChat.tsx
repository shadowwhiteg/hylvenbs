"use client";

import { useEffect, useRef, useState } from "react";
import { BP } from "@/lib/base-path";

type ChatMsg = { role: "user" | "assistant"; content: string };
type ToolTrace = { name: string; args: Record<string, unknown>; result: unknown };

export function AgentChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    ok: boolean;
    model?: string;
    provider?: string;
    providerLabel?: string;
    models?: string[];
    error?: string;
  } | null>(null);
  const [lastTrace, setLastTrace] = useState<ToolTrace[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadHealth() {
    const res = await fetch(`${BP}/api/agent/health`);
    const data = await res.json();
    setHealth(data);
  }

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    const nextHistory = [...messages, { role: "user" as const, content: text }];
    setMessages(nextHistory);

    try {
      const res = await fetch(`${BP}/api/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Falha no chat");
        if (data.hint) setError(`${data.error}\n${data.hint}`);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      setLastTrace(data.toolTrace || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Agente</h1>
          <p className="muted">
            Chat com IA + tools (sync, margem, publicar, settings). Provedor configurado em
            Configurações.
          </p>
        </div>
        <button className="btn" onClick={() => void loadHealth()} disabled={busy}>
          Checar IA
        </button>
      </div>

      {health && (
        <div className={`alert ${health.ok ? "" : "error"}`} style={{ marginBottom: "1rem" }}>
          {health.ok
            ? `${health.providerLabel} OK · modelo: ${health.model}`
            : `${health.providerLabel} indisponível (modelo: ${health.model}): ${health.error}`}
        </div>
      )}

      {error && (
        <div className="alert error" style={{ whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      <div className="card agent-chat">
        <div className="agent-messages">
          {!messages.length && (
            <p className="muted">
              Exemplos: &quot;Qual o status do sync?&quot; · &quot;Liste produtos publicados&quot; ·
              &quot;Aplique margem 35% nos ids …&quot;
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`agent-bubble ${m.role}`}>
              <strong>{m.role === "user" ? "Você" : "Agente"}</strong>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.content}</div>
            </div>
          ))}
          {busy && <p className="muted">Pensando / executando tools…</p>}
          <div ref={bottomRef} />
        </div>

        <div className="toolbar" style={{ marginTop: "0.75rem" }}>
          <input
            style={{ flex: 1 }}
            value={input}
            placeholder="Pergunte ou peça uma ação…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send()}
            disabled={busy}
          />
          <button className="btn btn-primary" onClick={() => void send()} disabled={busy || !input.trim()}>
            Enviar
          </button>
        </div>
      </div>

      {lastTrace.length > 0 && (
        <div className="card" style={{ marginTop: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Últimas tools</h3>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {lastTrace.map((t, i) => (
              <li key={i}>
                <code>{t.name}</code>
                <pre style={{ fontSize: "0.8rem", overflow: "auto" }}>
                  {JSON.stringify({ args: t.args, result: t.result }, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
