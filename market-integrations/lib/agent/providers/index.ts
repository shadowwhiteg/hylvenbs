import type { AppSettingsView } from "@/lib/settings";
import type { AiProvider } from "@/lib/agent/providers/types";
import { createOllamaProvider } from "@/lib/agent/providers/ollama-adapter";
import { createOpenAiCompatibleProvider } from "@/lib/agent/providers/openai-compatible";
import { createCliProvider } from "@/lib/agent/providers/cli";
import {
  AI_PROVIDER_CLI_DEFAULTS,
  AI_PROVIDER_FIELDS,
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  isAiProviderId,
  type AiProviderId,
} from "@/lib/agent/providers/meta";

export type { AiProvider, ChatMessage, ChatRequest, ChatResponse, ChatToolDef, ProviderHealth } from "@/lib/agent/providers/types";
export {
  AI_PROVIDER_CLI_DEFAULTS,
  AI_PROVIDER_FIELDS,
  AI_PROVIDER_IDS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_MODEL_PLACEHOLDER,
  isAiProviderId,
  type AiProviderFieldSpec,
  type AiProviderId,
} from "@/lib/agent/providers/meta";

function parseCliArgs(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function resolvedAiProvider(settings: AppSettingsView): AiProviderId {
  return isAiProviderId(settings.aiProvider) ? settings.aiProvider : "ollama";
}

/** Whether the active provider needs an API key at all — lets callers skip resolving the secret otherwise. */
export function activeProviderNeedsApiKey(settings: AppSettingsView): boolean {
  return AI_PROVIDER_FIELDS[resolvedAiProvider(settings)].apiKey;
}

/**
 * `apiKey` comes in separately (not as part of `AppSettingsView`) because
 * it's a secret — same convention as `mlClientSecret`: never exposed in the
 * settings API response, only resolved server-side right before use.
 */
export function buildProvider(settings: AppSettingsView, apiKey: string | null): AiProvider {
  switch (resolvedAiProvider(settings)) {
    case "openai":
      return createOpenAiCompatibleProvider({
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        apiKey: apiKey || undefined,
        model: settings.aiModel || "gpt-4o-mini",
      });
    case "openai-compatible":
      return createOpenAiCompatibleProvider({
        id: "openai-compatible",
        label: "IA (endpoint compatível com OpenAI)",
        baseUrl: settings.aiBaseUrl || "",
        apiKey: apiKey || undefined,
        model: settings.aiModel || "",
      });
    case "openrouter":
      return createOpenAiCompatibleProvider({
        id: "openrouter",
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: apiKey || undefined,
        model: settings.aiModel || "",
      });
    case "google-ai-studio":
      return createOpenAiCompatibleProvider({
        id: "google-ai-studio",
        label: "Google AI Studio",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: apiKey || undefined,
        model: settings.aiModel || "gemini-2.0-flash",
      });
    case "cursor": {
      const args = parseCliArgs(settings.aiCliArgs);
      const defaults = AI_PROVIDER_CLI_DEFAULTS.cursor;
      return createCliProvider({
        id: "cursor",
        label: "Cursor",
        command: settings.aiCliCommand || defaults.command,
        args: args.length ? args : defaults.args,
      });
    }
    case "claude-code": {
      const args = parseCliArgs(settings.aiCliArgs);
      const defaults = AI_PROVIDER_CLI_DEFAULTS["claude-code"];
      return createCliProvider({
        id: "claude-code",
        label: "Claude Code",
        command: settings.aiCliCommand || defaults.command,
        args: args.length ? args : defaults.args,
      });
    }
    case "ollama":
    default:
      return createOllamaProvider({ baseUrl: settings.ollamaBaseUrl, model: settings.ollamaModel });
  }
}

/** Nome amigável do provedor ativo, usado em mensagens de erro/alerta. */
export function providerLabel(settings: AppSettingsView): string {
  const provider = resolvedAiProvider(settings);
  if (provider === "ollama") return "Ollama";
  return AI_PROVIDER_LABELS[provider];
}

/**
 * Identificador do "modelo" atualmente ativo, pra exibir na UI. Pro Ollama
 * devolve só o nome do modelo (mantém compatibilidade com o formato usado
 * antes de existir seleção de provedor); pros demais, o nome do modelo
 * configurado ou o comando do CLI.
 */
export function describeActiveModel(settings: AppSettingsView): string {
  switch (resolvedAiProvider(settings)) {
    case "openai":
      return settings.aiModel || "gpt-4o-mini";
    case "openai-compatible":
      return settings.aiModel || "(modelo não configurado)";
    case "openrouter":
      return settings.aiModel || "(modelo não configurado)";
    case "google-ai-studio":
      return settings.aiModel || "gemini-2.0-flash";
    case "cursor":
      return `${settings.aiCliCommand || AI_PROVIDER_CLI_DEFAULTS.cursor.command} (CLI)`;
    case "claude-code":
      return `${settings.aiCliCommand || AI_PROVIDER_CLI_DEFAULTS["claude-code"].command} (CLI)`;
    case "ollama":
    default:
      return settings.ollamaModel;
  }
}
