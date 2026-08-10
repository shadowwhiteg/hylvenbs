/**
 * Provider metadata only — no Node built-ins (child_process) and no fetch
 * clients here, so this file is safe to import from client components too
 * (unlike `./index`, which pulls in the CLI provider's `child_process`).
 */

export const AI_PROVIDER_IDS = [
  "ollama",
  "openai",
  "openai-compatible",
  "openrouter",
  "google-ai-studio",
  "cursor",
  "claude-code",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  ollama: "Ollama (local)",
  openai: "OpenAI",
  "openai-compatible": "Compatível com OpenAI (custom)",
  openrouter: "OpenRouter",
  "google-ai-studio": "Google AI Studio (Gemini)",
  cursor: "Cursor (CLI local)",
  "claude-code": "Claude Code (CLI local)",
};

export type AiProviderFieldSpec = {
  apiKey: boolean;
  baseUrl: boolean;
  model: boolean;
  cli: boolean;
};

/** Which Settings fields matter for each provider — drives both UI and validation. */
export const AI_PROVIDER_FIELDS: Record<AiProviderId, AiProviderFieldSpec> = {
  ollama: { apiKey: false, baseUrl: true, model: true, cli: false },
  openai: { apiKey: true, baseUrl: false, model: true, cli: false },
  "openai-compatible": { apiKey: true, baseUrl: true, model: true, cli: false },
  openrouter: { apiKey: true, baseUrl: false, model: true, cli: false },
  "google-ai-studio": { apiKey: true, baseUrl: false, model: true, cli: false },
  cursor: { apiKey: false, baseUrl: false, model: false, cli: true },
  "claude-code": { apiKey: false, baseUrl: false, model: false, cli: true },
};

export const AI_PROVIDER_MODEL_PLACEHOLDER: Record<AiProviderId, string> = {
  ollama: "qwen3.5:4b",
  openai: "gpt-4o-mini",
  "openai-compatible": "meu-modelo-local",
  openrouter: "openai/gpt-4o-mini",
  "google-ai-studio": "gemini-2.0-flash",
  cursor: "",
  "claude-code": "",
};

export const AI_PROVIDER_CLI_DEFAULTS: Record<"cursor" | "claude-code", { command: string; args: string[] }> = {
  cursor: { command: "cursor-agent", args: ["-p"] },
  "claude-code": { command: "claude", args: ["-p"] },
};
