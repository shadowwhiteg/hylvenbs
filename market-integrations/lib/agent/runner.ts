import { getAppSettings } from "@/lib/settings";
import {
  AGENT_TOOLS,
  executeAgentTool,
  type AgentToolName,
} from "@/lib/agent/tools";
import { parseToolCallArgs, toOllamaTools } from "@/lib/agent/ollama";
import { chatWithAiUsingSettings, providerLabel, type ChatMessage } from "@/lib/agent/chat";

const SYSTEM_PROMPT = `Você é o assistente do ML Drop Publisher.
Ajuda a sincronizar o catálogo Meu Drop, ajustar margens, publicar e sincronizar anúncios em dois
marketplaces: Mercado Livre e Shopee. Tools com sufixo/prefixo "ml"/"mercado livre" operam no
Mercado Livre; tools com "shopee" operam na Shopee — são independentes, cada marketplace tem seu
próprio rascunho, categoria e características. Quando não estiver claro em qual marketplace o
usuário quer agir, pergunte ou infira pelo contexto da conversa (ex.: se ele mencionou "Shopee" ou
"Mercado Livre" antes).
Responda em português, de forma objetiva. Use as tools quando precisar de dados ou ações reais.
Não invente IDs de produtos — liste antes se necessário.
Ao montar kits: use suggest_ml_kits/suggest_shopee_kits antes de create_kit_from_ml_listing_ids/
create_kit_from_shopee_listing_ids e repasse o 'title' e a 'description' retornados por ela sem
reescrever nem omitir — eles já são elaborados a partir das descrições originais do fornecedor no
catálogo Meu Drop. Nunca crie um kit só com os nomes dos produtos concatenados.`;

export type AgentChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type AgentRunResult = {
  reply: string;
  toolTrace: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
  messages: ChatMessage[];
};

export async function runAgentChat(
  history: AgentChatTurn[],
  userMessage: string,
  options?: { maxToolRounds?: number; fetchImpl?: typeof fetch }
): Promise<AgentRunResult> {
  const settings = await getAppSettings();
  const maxToolRounds = options?.maxToolRounds ?? 4;
  const tools = toOllamaTools(AGENT_TOOLS);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    { role: "user", content: userMessage },
  ];

  const toolTrace: AgentRunResult["toolTrace"] = [];

  for (let round = 0; round < maxToolRounds; round++) {
    const { message, supportsTools } = await chatWithAiUsingSettings(settings, {
      messages,
      tools,
      fetchImpl: options?.fetchImpl,
    });

    messages.push(message);

    // CLI providers (Cursor, Claude Code) have no structured tool-calling — one plain reply and done.
    if (!supportsTools) {
      return {
        reply:
          (message.content || "(sem resposta)") +
          `\n\n(${providerLabel(settings)} não suporta as ferramentas deste app — respondeu só em texto.)`,
        toolTrace,
        messages,
      };
    }

    const calls = message.tool_calls || [];
    if (!calls.length) {
      return {
        reply: message.content || "(sem resposta)",
        toolTrace,
        messages,
      };
    }

    for (const call of calls) {
      const name = call.function.name as AgentToolName;
      const args = parseToolCallArgs(call.function.arguments);
      const result = await executeAgentTool(name, args);
      toolTrace.push({ name, args, result });
      messages.push({
        role: "tool",
        content: JSON.stringify(result),
        ...(call.id ? { tool_call_id: call.id } : {}),
      });
    }
  }

  return {
    reply:
      "Atingi o limite de rounds de tools. Veja o histórico de ferramentas para o resultado parcial.",
    toolTrace,
    messages,
  };
}
