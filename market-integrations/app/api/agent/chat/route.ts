import { NextRequest, NextResponse } from "next/server";
import { runAgentChat, type AgentChatTurn } from "@/lib/agent/runner";
import { checkAiHealth } from "@/lib/agent/chat";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = String(body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "message obrigatório" }, { status: 400 });
  }

  const history = (Array.isArray(body.history) ? body.history : []) as AgentChatTurn[];
  const health = await checkAiHealth();
  if (!health.ok) {
    return NextResponse.json(
      {
        error: `${health.providerLabel} indisponível: ${health.error}`,
        hint:
          health.provider === "ollama"
            ? `Rode \`ollama serve\` e \`ollama pull ${health.model}\``
            : "Confira as credenciais/comando do provedor de IA em Configurações.",
      },
      { status: 503 }
    );
  }

  try {
    const result = await runAgentChat(history, message);
    return NextResponse.json({
      reply: result.reply,
      toolTrace: result.toolTrace,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
