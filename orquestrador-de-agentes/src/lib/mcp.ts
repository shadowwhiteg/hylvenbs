import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { decrypt, isEnvelope } from "./crypto/secrets.ts";
import { AbortedError, McpError } from "./telemetry/errors.ts";
import type { McpServerConfig, McpToolInfo } from "./types.ts";

/** Decifra o JSON de env/headers do servidor. Único ponto além de providers.ts. */
function decryptRecord(envelope: string | null | undefined, aad: string): Record<string, string> {
  if (!envelope || !isEnvelope(envelope)) return {};
  try {
    return JSON.parse(decrypt(envelope, aad)) as Record<string, string>;
  } catch {
    return {};
  }
}

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "agent-orchestrator", version: "0.1.0" };
const REQUEST_TIMEOUT_MS = 30_000;

type JsonRpcResponse = {
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

export type ToolCallOutcome = { content: string; isError: boolean };

/** Achata o `content` de tools/call em texto. */
function flattenContent(result: Record<string, unknown> | undefined): string {
  const blocks = (result?.content ?? []) as { type: string; text?: string }[];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return result ? JSON.stringify(result) : "";
  }
  return blocks
    .map((b) => (b.type === "text" ? (b.text ?? "") : JSON.stringify(b)))
    .join("\n")
    .trim();
}

interface Transport {
  request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  close(): void;
}

// -------------------------------------------------------------- stdio

class StdioTransport implements Transport {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  private stderr = "";
  private closed = false;

  constructor(cfg: McpServerConfig) {
    if (!cfg.command) throw new Error("Servidor stdio sem comando definido");
    const env = decryptRecord(cfg.envEnc, `McpServer:${cfg.id}:env`);
    this.child = spawn(cfg.command, cfg.args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });
    this.child.on("error", (err) => this.fail(err.message));
    this.child.on("exit", (code) =>
      this.fail(`processo encerrou com código ${code}${this.stderr ? `: ${this.stderr}` : ""}`),
    );
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;

      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // servidores costumam imprimir logs no stdout
      }
      const waiter = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
      if (!waiter) continue;
      this.pending.delete(msg.id as number);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result ?? {});
    }
  }

  private fail(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const [, waiter] of this.pending) waiter.reject(new McpError(reason));
    this.pending.clear();
  }

  request(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
    if (this.closed) return Promise.reject(new Error("transporte fechado"));
    const id = this.nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        onAbort && signal?.removeEventListener("abort", onAbort);
        reject(new McpError(`timeout em ${method} (${REQUEST_TIMEOUT_MS}ms)`));
      }, REQUEST_TIMEOUT_MS);

      const onAbort = signal
        ? () => {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(new AbortedError(signal.reason));
          }
        : null;
      if (onAbort) signal!.addEventListener("abort", onAbort, { once: true });

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          if (onAbort) signal?.removeEventListener("abort", onAbort);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          if (onAbort) signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async notify(method: string, params: Record<string, unknown> = {}) {
    if (this.closed) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  close() {
    this.closed = true;
    this.child.kill();
  }
}

// --------------------------------------------------------------- http

class HttpTransport implements Transport {
  private nextId = 1;
  private sessionId: string | null = null;
  private headers: Record<string, string>;
  private cfg: McpServerConfig;

  constructor(cfg: McpServerConfig) {
    if (!cfg.url) throw new Error("Servidor http sem URL definida");
    this.cfg = cfg;
    this.headers = decryptRecord(cfg.headersEnc, `McpServer:${cfg.id}:headers`);
  }

  private async send(payload: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    return fetch(this.cfg.url!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...payload }),
      signal: signal ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async request(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await this.send({ id: this.nextId++, method, params }, signal);
    } catch (err) {
      if (signal?.aborted) throw new AbortedError(signal.reason);
      throw new McpError(`falha de transporte em ${method}: ${(err as Error).message}`);
    }
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (!res.ok) throw new McpError(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);

    const raw = await res.text();
    const msg = res.headers.get("content-type")?.includes("text/event-stream")
      ? parseSse(raw)
      : (JSON.parse(raw) as JsonRpcResponse);

    if (!msg) throw new McpError("resposta SSE sem payload JSON-RPC");
    if (msg.error) throw new Error(msg.error.message);
    return msg.result ?? {};
  }

  async notify(method: string, params: Record<string, unknown> = {}) {
    await this.send({ method, params }).catch(() => undefined);
  }

  close() {}
}

/** Extrai a última mensagem JSON-RPC de um corpo SSE. */
function parseSse(raw: string): JsonRpcResponse | null {
  let last: JsonRpcResponse | null = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      last = JSON.parse(line.slice(5).trim());
    } catch {
      /* ignora keep-alives */
    }
  }
  return last;
}

// -------------------------------------------------------------- cliente

export class McpClient {
  readonly config: McpServerConfig;
  private transport: Transport;
  private ready: Promise<void>;

  constructor(config: McpServerConfig) {
    this.config = config;
    this.transport = config.transport === "http" ? new HttpTransport(config) : new StdioTransport(config);
    this.ready = this.handshake();
  }

  private async handshake() {
    await this.transport.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    await this.transport.notify("notifications/initialized");
  }

  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    await this.ready;
    const result = await this.transport.request("tools/list", {}, signal);
    return ((result.tools ?? []) as Record<string, unknown>[]).map((t) => ({
      name: String(t.name),
      description: String(t.description ?? ""),
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolCallOutcome> {
    await this.ready;
    try {
      const result = await this.transport.request("tools/call", { name, arguments: args }, signal);
      return { content: flattenContent(result), isError: Boolean(result.isError) };
    } catch (err) {
      if (err instanceof AbortedError) throw err;
      return { content: `Erro na tool ${name}: ${(err as Error).message}`, isError: true };
    }
  }

  close() {
    this.transport.close();
  }
}

/** Conecta, lista tools e desconecta — usado pelo botão "Testar" da UI. */
export async function probeServer(cfg: McpServerConfig): Promise<McpToolInfo[]> {
  const client = new McpClient(cfg);
  try {
    return await client.listTools();
  } finally {
    client.close();
  }
}

/**
 * SHA-256 da configuração não-secreta do servidor — detecta drift entre o snapshot
 * publicado e a configuração atual sem precisar decifrar nada.
 */
export function computeConfigHash(cfg: {
  transport: string;
  command?: string | null;
  args: string[];
  url?: string | null;
  envKeys: string[];
  headerKeys: string[];
}): string {
  const canonical = JSON.stringify({
    transport: cfg.transport,
    command: cfg.command ?? null,
    args: cfg.args,
    url: cfg.url ?? null,
    envKeys: [...cfg.envKeys].sort(),
    headerKeys: [...cfg.headerKeys].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
