import { getAppSettings, resolveAiApiKey, type AppSettingsView } from "@/lib/settings";
import { activeProviderNeedsApiKey, buildProvider, describeActiveModel, providerLabel } from "@/lib/agent/providers";
import type { ChatMessage, ChatToolDef, ChatResponse } from "@/lib/agent/providers/types";

/** Only touches AppSettings.aiApiKey when the active provider actually needs one. */
async function resolveApiKeyIfNeeded(settings: AppSettingsView): Promise<string | null> {
  if (!activeProviderNeedsApiKey(settings)) return null;
  return resolveAiApiKey();
}

export type { ChatMessage, ChatToolDef, ChatToolCall, ChatRole } from "@/lib/agent/providers/types";
export { describeActiveModel, providerLabel } from "@/lib/agent/providers";

export type ChatWithAiInput = {
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  think?: boolean;
  fetchImpl?: typeof fetch;
};

export type ChatWithAiResult = ChatResponse & {
  model: string;
  /** CLI providers (Cursor, Claude Code) can't be wired into structured tool-calling. */
  supportsTools: boolean;
};

/** Resolves the active AI provider from Settings and runs a single chat turn. */
export async function chatWithAi(input: ChatWithAiInput): Promise<ChatWithAiResult> {
  const settings = await getAppSettings();
  return chatWithAiUsingSettings(settings, input);
}

/** Same as {@link chatWithAi} but reuses settings already fetched by the caller. */
export async function chatWithAiUsingSettings(
  settings: AppSettingsView,
  input: ChatWithAiInput
): Promise<ChatWithAiResult> {
  const apiKey = await resolveApiKeyIfNeeded(settings);
  const provider = buildProvider(settings, apiKey);
  const { message, raw } = await provider.chat({
    messages: input.messages,
    tools: provider.supportsTools ? input.tools : undefined,
    think: input.think,
    maxTokens: settings.aiMaxTokens,
    fetchImpl: input.fetchImpl,
  });
  return { message, raw, model: describeActiveModel(settings), supportsTools: provider.supportsTools };
}

export async function checkAiHealth(fetchImpl?: typeof fetch) {
  const settings = await getAppSettings();
  const apiKey = await resolveApiKeyIfNeeded(settings);
  const provider = buildProvider(settings, apiKey);
  const health = await provider.health(fetchImpl);
  return {
    ...health,
    provider: settings.aiProvider,
    providerLabel: providerLabel(settings),
    model: describeActiveModel(settings),
    supportsTools: provider.supportsTools,
  };
}
