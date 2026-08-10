import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleProvider } from "@/lib/agent/providers/openai-compatible";

describe("createOpenAiCompatibleProvider", () => {
  it("posts messages/tools with the bearer token and maps the reply back", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
    });
    const provider = createOpenAiCompatibleProvider({
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });

    const result = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      })
    );
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(result.message.content).toBe("hello");
  });

  it("maps tool_calls from the response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "call_1", type: "function", function: { name: "foo", arguments: '{"a":1}' } }],
            },
          },
        ],
      }),
    });
    const provider = createOpenAiCompatibleProvider({
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "x",
      model: "m",
    });

    const result = await provider.chat({ messages: [], fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.message.tool_calls).toEqual([{ id: "call_1", function: { name: "foo", arguments: '{"a":1}' } }]);
  });

  it("throws a labeled error on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "bad key" } }),
    });
    const provider = createOpenAiCompatibleProvider({
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "x",
      model: "m",
    });

    await expect(
      provider.chat({ messages: [], fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow("OpenAI: bad key");
  });

  it("throws when the model is not configured", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "openai-compatible",
      label: "Custom",
      baseUrl: "http://localhost:1234/v1",
      model: "",
    });
    await expect(provider.chat({ messages: [] })).rejects.toThrow("modelo não configurado");
  });

  it("health() reports ok with the model list", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "gpt-4o-mini" }] }) });
    const provider = createOpenAiCompatibleProvider({
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "x",
      model: "m",
    });

    const health = await provider.health(fetchImpl as unknown as typeof fetch);
    expect(health).toEqual({ ok: true, models: ["gpt-4o-mini"] });
  });

  it("health() fails fast without an API key (except openai-compatible)", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "m",
    });
    const health = await provider.health();
    expect(health.ok).toBe(false);
  });

  it("health() allows a missing API key for openai-compatible (self-hosted servers)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    const provider = createOpenAiCompatibleProvider({
      id: "openai-compatible",
      label: "Custom",
      baseUrl: "http://localhost:1234/v1",
      model: "m",
    });
    const health = await provider.health(fetchImpl as unknown as typeof fetch);
    expect(health.ok).toBe(true);
  });
});

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("child_process", () => ({ spawn: spawnMock }));

type FakeChildOpts = { stdout?: string; stderr?: string; exitCode?: number; emitError?: Error };

function fakeChild(opts: FakeChildOpts) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (v: string) => void; end: () => void };
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  queueMicrotask(() => {
    if (opts.emitError) {
      child.emit("error", opts.emitError);
      return;
    }
    if (opts.stdout) child.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
    child.emit("close", opts.exitCode ?? 0);
  });
  return child;
}

describe("createCliProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the flattened prompt to stdin and resolves with trimmed stdout", async () => {
    const { createCliProvider } = await import("@/lib/agent/providers/cli");
    spawnMock.mockImplementation(() => fakeChild({ stdout: "Título Legal\n" }));

    const provider = createCliProvider({ id: "claude-code", label: "Claude Code", command: "claude", args: ["-p"] });
    const result = await provider.chat({ messages: [{ role: "user", content: "gere um título" }] });

    expect(spawnMock).toHaveBeenCalledWith("claude", ["-p"], expect.any(Object));
    expect(result.message.content).toBe("Título Legal");
    expect(result.message.role).toBe("assistant");
  });

  it("supportsTools is false", async () => {
    const { createCliProvider } = await import("@/lib/agent/providers/cli");
    const provider = createCliProvider({ id: "cursor", label: "Cursor", command: "cursor-agent", args: ["-p"] });
    expect(provider.supportsTools).toBe(false);
  });

  it("rejects with stderr detail on a non-zero exit code", async () => {
    const { createCliProvider } = await import("@/lib/agent/providers/cli");
    spawnMock.mockImplementation(() => fakeChild({ stderr: "boom", exitCode: 1 }));

    const provider = createCliProvider({ id: "cursor", label: "Cursor", command: "cursor-agent", args: ["-p"] });
    await expect(provider.chat({ messages: [] })).rejects.toThrow(/código 1/);
  });

  it("rejects with a clear hint when the binary can't be executed", async () => {
    const { createCliProvider } = await import("@/lib/agent/providers/cli");
    spawnMock.mockImplementation(() => fakeChild({ emitError: new Error("ENOENT") }));

    const provider = createCliProvider({ id: "cursor", label: "Cursor", command: "nope", args: [] });
    await expect(provider.chat({ messages: [] })).rejects.toThrow(/Não foi possível executar/);
  });

  it("health() runs --version and reports ok on success", async () => {
    const { createCliProvider } = await import("@/lib/agent/providers/cli");
    spawnMock.mockImplementation(() => fakeChild({ stdout: "1.0.0" }));

    const provider = createCliProvider({ id: "claude-code", label: "Claude Code", command: "claude", args: ["-p"] });
    const health = await provider.health();
    expect(health.ok).toBe(true);
  });

  it("health() reports the error when the binary is missing", async () => {
    const { createCliProvider } = await import("@/lib/agent/providers/cli");
    spawnMock.mockImplementation(() => fakeChild({ emitError: new Error("ENOENT") }));

    const provider = createCliProvider({ id: "cursor", label: "Cursor", command: "nope", args: [] });
    const health = await provider.health();
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/Não foi possível executar/);
  });
});

describe("providers/index (buildProvider, describeActiveModel, providerLabel, activeProviderNeedsApiKey)", () => {
  const base = {
    id: "default",
    marginPercent: 30,
    autoSyncMode: "always" as const,
    autoPauseWhenUnavailable: true,
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "qwen3.5:4b",
    aiBaseUrl: null,
    aiModel: null,
    aiCliCommand: null,
    aiCliArgs: "[]",
    aiMaxTokens: 2048,
    defaultListingTypeId: "gold_pro" as const,
    defaultFreeShipping: true,
    defaultLocalPickUp: false,
    defaultShippingMode: "me2" as const,
    defaultWarrantyType: "Garantia de fábrica",
    defaultWarrantyTime: "90 dias",
    catalogStockPercent: 100,
    shopeeDefaultWeightKg: 0.3,
    shopeeDefaultDaysToShip: 2,
  };

  it("defaults to ollama and needs no API key", async () => {
    const { buildProvider, describeActiveModel, providerLabel, activeProviderNeedsApiKey } = await import(
      "@/lib/agent/providers"
    );
    const settings = { ...base, aiProvider: "unknown-provider" };
    expect(buildProvider(settings, null).id).toBe("ollama");
    expect(describeActiveModel(settings)).toBe("qwen3.5:4b");
    expect(providerLabel(settings)).toBe("Ollama");
    expect(activeProviderNeedsApiKey(settings)).toBe(false);
  });

  it("builds an openai provider that needs an API key", async () => {
    const { buildProvider, activeProviderNeedsApiKey, describeActiveModel } = await import(
      "@/lib/agent/providers"
    );
    const settings = { ...base, aiProvider: "openai", aiModel: "gpt-4o-mini" };
    const provider = buildProvider(settings, "sk-x");
    expect(provider.id).toBe("openai");
    expect(provider.supportsTools).toBe(true);
    expect(activeProviderNeedsApiKey(settings)).toBe(true);
    expect(describeActiveModel(settings)).toBe("gpt-4o-mini");
  });

  it("builds a claude-code CLI provider that doesn't support tools", async () => {
    const { buildProvider, activeProviderNeedsApiKey, describeActiveModel } = await import(
      "@/lib/agent/providers"
    );
    const settings = { ...base, aiProvider: "claude-code", aiCliCommand: null };
    const provider = buildProvider(settings, null);
    expect(provider.id).toBe("claude-code");
    expect(provider.supportsTools).toBe(false);
    expect(activeProviderNeedsApiKey(settings)).toBe(false);
    expect(describeActiveModel(settings)).toBe("claude (CLI)");
  });
});
