import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { BP } from "@/lib/base-path";
import { getPublicOrigin } from "@/lib/net/allowed-hosts";

export type TunnelStatus = "stopped" | "starting" | "up" | "error";

type TunnelState = {
  status: TunnelStatus;
  url: string | null;
  error: string | null;
  pid: number | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mlDropTunnelState: TunnelState | undefined;
  // eslint-disable-next-line no-var
  var __mlDropTunnelChild: ChildProcess | undefined;
  // eslint-disable-next-line no-var
  var __mlDropTunnelStarted: boolean | undefined;
}

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;

function rootDir(): string {
  return process.cwd();
}

function tunnelUrlPath(): string {
  return path.join(rootDir(), ".tunnel-url");
}

function tunnelStatusPath(): string {
  return path.join(rootDir(), ".tunnel-status");
}

function persistStatus(status: TunnelStatus, error?: string | null) {
  try {
    const payload = JSON.stringify({
      status,
      error: error || null,
      updatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(tunnelStatusPath(), `${payload}\n`, "utf8");
  } catch {
    // ignore
  }
}

function readPersistedStatus(): { status: TunnelStatus; error: string | null } | null {
  try {
    const raw = fs.readFileSync(tunnelStatusPath(), "utf8").trim();
    const parsed = JSON.parse(raw) as { status?: string; error?: string | null };
    const status = parsed.status as TunnelStatus | undefined;
    if (
      status === "stopped" ||
      status === "starting" ||
      status === "up" ||
      status === "error"
    ) {
      return { status, error: parsed.error ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

function getState(): TunnelState {
  if (!global.__mlDropTunnelState) {
    global.__mlDropTunnelState = {
      status: "stopped",
      url: null,
      error: null,
      pid: null,
    };
  }
  return global.__mlDropTunnelState;
}

function persistUrl(url: string) {
  try {
    fs.writeFileSync(tunnelUrlPath(), `${url.trim()}\n`, "utf8");
  } catch {
    // ignore write failures (permissions, read-only fs)
  }
}

function readPersistedUrl(): string | null {
  try {
    const raw = fs.readFileSync(tunnelUrlPath(), "utf8").trim();
    if (!raw) return null;
    const match = raw.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    return match ? match[0].replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

let loggedUrl: string | null = null;

function logTunnelUrl(url: string) {
  const cleaned = url.replace(/\/$/, "");
  if (loggedUrl !== cleaned) {
    loggedUrl = cleaned;
    console.log(`  \x1b[36m- Tunnel:\x1b[0m      \x1b[4m${cleaned}\x1b[0m`);
  }
}

function setUrl(url: string) {
  const cleaned = url.replace(/\/$/, "");
  const state = getState();
  state.url = cleaned;
  state.status = "up";
  state.error = null;
  persistUrl(cleaned);
  persistStatus("up");
  logTunnelUrl(cleaned);
}

function ingestChunk(chunk: string) {
  URL_RE.lastIndex = 0;
  const matches = chunk.match(URL_RE);
  if (!matches?.length) return;
  setUrl(matches[matches.length - 1]);
}

export function isTunnelDisabled(): boolean {
  return process.env.DISABLE_TUNNEL === "1" || process.env.DISABLE_TUNNEL === "true";
}

/**
 * Current tunnel URL from in-memory state or `.tunnel-url` (standalone tunnel).
 *
 * Com o túnel desligado devolve null mesmo que os arquivos `.tunnel-url` /
 * `.tunnel-status` de uma sessão anterior ainda existam no disco — senão o
 * OAuth cairia numa URL morta e as Configurações mostrariam status falso.
 */
export function getTunnelUrl(): string | null {
  if (isTunnelDisabled()) return null;
  const state = getState();
  if (state.url) return state.url;
  const fromFile = readPersistedUrl();
  if (fromFile) {
    state.url = fromFile;
    if (state.status === "stopped") state.status = "up";
  }
  return state.url;
}

export function getTunnelInfo(): {
  tunnelUrl: string | null;
  tunnelStatus: TunnelStatus;
  publicBaseUrl: string | null;
  oauthCallbackUrl: string | null;
  notificationsCallbackUrl: string | null;
  shopeeCallbackUrl: string | null;
} {
  const tunnelUrl = getTunnelUrl();
  const state = getState();
  const fileStatus = isTunnelDisabled() ? null : readPersistedStatus();

  let tunnelStatus = isTunnelDisabled() ? ("stopped" as TunnelStatus) : state.status;
  if (fileStatus && state.status === "stopped") {
    tunnelStatus = fileStatus.status;
  }
  if (tunnelUrl && (tunnelStatus === "stopped" || tunnelStatus === "starting")) {
    tunnelStatus = "up";
  }

  // A origem pública fixa (PUBLIC_BASE_URL) tem precedência sobre o túnel:
  // com domínio próprio os callbacks devem apontar para ele, não para uma
  // URL efêmera do trycloudflare.
  const baseUrl =
    getPublicOrigin() || (tunnelUrl ? tunnelUrl.replace(/\/$/, "") : null);

  return {
    tunnelUrl,
    tunnelStatus,
    publicBaseUrl: getPublicOrigin(),
    oauthCallbackUrl: baseUrl ? `${baseUrl}${BP}/api/auth/ml/callback` : null,
    notificationsCallbackUrl: baseUrl ? `${baseUrl}${BP}/api/ml/notifications` : null,
    shopeeCallbackUrl: baseUrl ? `${baseUrl}${BP}/api/auth/shopee/callback` : null,
  };
}

/**
 * Starts Cloudflare Quick Tunnel as a child process (idempotent).
 * Failures never throw — app keeps running; status is exposed via getTunnelInfo().
 */
export function startTunnelIfNeeded(): void {
  if (global.__mlDropTunnelStarted) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DISABLE_TUNNEL === "1" || process.env.DISABLE_TUNNEL === "true") {
    return;
  }

  global.__mlDropTunnelStarted = true;

  const state = getState();
  // Clear any old/stale URL from previous sessions
  state.url = null;
  loggedUrl = null;
  state.status = "starting";
  state.error = null;
  persistStatus("starting");

  const port = process.env.TUNNEL_PORT || process.env.PORT || "3000";
  const target = `http://127.0.0.1:${port}`;
  const script = path.join(rootDir(), "scripts", "tunnel.sh");

  try {
    // Reuses scripts/tunnel.sh (download + .tunnel-url persistence)
    const child = spawn("bash", [script], {
      cwd: rootDir(),
      env: { ...process.env, TUNNEL_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      // Processo líder de um novo grupo: o script roda cloudflared dentro de
      // um pipeline (stdbuf | while read), então matar só o PID do bash não
      // derruba o cloudflared. Com detached, matamos o grupo inteiro (-pid).
      detached: true,
    });

    global.__mlDropTunnelChild = child;
    state.pid = child.pid ?? null;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (data: string) => {
      ingestChunk(data);
      const fromFile = readPersistedUrl();
      if (fromFile && state.url !== fromFile) setUrl(fromFile);
    });
    child.stderr?.on("data", (data: string) => {
      ingestChunk(data);
      const fromFile = readPersistedUrl();
      if (fromFile && state.url !== fromFile) setUrl(fromFile);
    });

    child.on("error", (err) => {
      state.status = "error";
      state.error = err.message || "Falha ao iniciar cloudflared";
      persistStatus("error", state.error);
      console.warn("[tunnel] não iniciado:", state.error);
    });

    child.on("exit", (code, signal) => {
      if (state.status !== "up") {
        state.status = "error";
        state.error =
          state.error ||
          `túnel encerrou (code=${code ?? "?"}, signal=${signal ?? "-"})`;
        persistStatus("error", state.error);
      } else {
        state.status = "stopped";
        persistStatus("stopped");
      }
      state.pid = null;
      global.__mlDropTunnelChild = undefined;
    });

    console.log(`[tunnel] iniciando via scripts/tunnel.sh → ${target}`);

    // Garante que o túnel morre junto com o servidor: sem isso, um cloudflared
    // órfão continuaria rodando e um próximo `npm run dev` criaria um segundo
    // túnel com URL diferente da anunciada.
    const killChild = () => {
      if (child.pid && !child.killed) {
        try {
          // PID negativo = mata o grupo de processos inteiro (bash + pipeline + cloudflared).
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // já encerrado
        }
      }
    };
    process.once("exit", killChild);
    process.once("SIGINT", () => {
      killChild();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      killChild();
      process.exit(0);
    });
  } catch (err) {
    state.status = "error";
    state.error = err instanceof Error ? err.message : "Falha ao iniciar túnel";
    persistStatus("error", state.error);
    console.warn("[tunnel] não iniciado:", state.error);
  }
}
