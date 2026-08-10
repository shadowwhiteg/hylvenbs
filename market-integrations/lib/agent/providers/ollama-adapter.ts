import { ollamaChat, ollamaHealth, type OllamaMessage, type OllamaTool } from "@/lib/agent/ollama";
import type { AiProvider, ChatRequest, ChatResponse, ProviderHealth } from "@/lib/agent/providers/types";

export type OllamaProviderConfig = {
  baseUrl: string;
  model: string;
};

/** Thin wrapper so the existing (tested) Ollama client satisfies the generic AiProvider interface. */
export function createOllamaProvider(config: OllamaProviderConfig): AiProvider {
  return {
    id: "ollama",
    supportsTools: true,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const { message, raw } = await ollamaChat({
        baseUrl: config.baseUrl,
        model: config.model,
        messages: req.messages as OllamaMessage[],
        tools: req.tools as OllamaTool[] | undefined,
        think: req.think,
        maxTokens: req.maxTokens,
        fetchImpl: req.fetchImpl,
      });
      return { message, raw };
    },
    async health(fetchImpl?: typeof fetch): Promise<ProviderHealth> {
      return ollamaHealth(config.baseUrl, fetchImpl);
    },
  };
}
