import { spawn } from "child_process";
import type { AiProvider, ChatMessage, ChatRequest, ChatResponse, ProviderHealth } from "@/lib/agent/providers/types";

export type CliProviderConfig = {
  id: string;
  label: string;
  command: string;
  args: string[];
  timeoutMs?: number;
};

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  system: "[Instruções do sistema]",
  user: "[Usuário]",
  assistant: "[Assistente]",
  tool: "[Resultado de ferramenta]",
};

/** CLIs de agente não têm o conceito de mensagens role-separadas do jeito das APIs de chat; achata tudo num prompt único. */
function renderPrompt(messages: ChatMessage[]): string {
  return messages.map((m) => `${ROLE_LABEL[m.role]}\n${m.content}`).join("\n\n");
}

function runCli(
  command: string,
  args: string[],
  input: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`"${command}" excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `Não foi possível executar "${command}": ${err.message}. Verifique se está instalado e disponível no PATH.`
        )
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `"${command}" saiu com código ${code}: ${stderr.trim().slice(0, 300) || "(sem stderr)"}`
          )
        );
        return;
      }
      resolve(stdout);
    });

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

/**
 * Invoca um CLI de agente instalado localmente (Claude Code, Cursor) como
 * subprocesso: escreve o prompt no stdin, lê a resposta do stdout. Não
 * suporta tool-calling estruturado — cada CLI já tem suas próprias
 * ferramentas internas, não as deste app.
 */
export function createCliProvider(config: CliProviderConfig): AiProvider {
  const timeoutMs = config.timeoutMs ?? 120_000;

  return {
    id: config.id,
    supportsTools: false,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const prompt = renderPrompt(req.messages);
      const output = await runCli(config.command, config.args, prompt, timeoutMs);
      return { message: { role: "assistant", content: output.trim() }, raw: output };
    },
    async health(): Promise<ProviderHealth> {
      try {
        await runCli(config.command, ["--version"], "", 8000);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
