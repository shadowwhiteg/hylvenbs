import { canDelegate, roleNoun } from "./agents/roles.ts";
import { parseJson, prisma } from "./db.ts";
import { computeDrift } from "./flows/drift.ts";
import { chainFor, resolveFlowGraph, type FlowSnapshot } from "./flows/snapshot.ts";
import { McpClient } from "./mcp.ts";
import { complete } from "./providers.ts";
import { backoffMs, maxAttemptsFor } from "./queue/retry.ts";
import { transition } from "./queue/state.ts";
import { httpStatusOf, isFailoverable } from "./routing/failover.ts";
import { healthKey, loadHealth, orderByAvailability, recordFailure, recordSuccess } from "./routing/health.ts";
import { forceFlush } from "./telemetry/buffer.ts";
import { estimateCost } from "./telemetry/cost.ts";
import { AbortedError, classifyError, type ErrorType } from "./telemetry/errors.ts";
import { log } from "./telemetry/log.ts";
import { createTraceContext, endSpan, startSpan, type SpanHandle, type TraceContext } from "./telemetry/tracer.ts";
import type { CompletionResult, Message, McpServerConfig, ProviderKind, ToolDef } from "./types.ts";

const MAX_DEPTH = 3;
const DELEGATE_PREFIX = "delegate_to_";
const MCP_SEPARATOR = "__";
const DEFAULT_TIMEOUT_MS = 600_000;

/** Nomes de tool devem casar com ^[a-zA-Z0-9_-]{1,64}$ nos dois provedores. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

type LiveProvider = NonNullable<Awaited<ReturnType<typeof prisma.provider.findUnique>>>;
type LiveMcpServer = NonNullable<Awaited<ReturnType<typeof prisma.mcpServer.findUnique>>>;

/**
 * Agente resolvido a partir de um snapshot (design 002): topologia, prompts e
 * parâmetros vêm congelados; só provedor (segredo) e servidor MCP (processo/URL) são
 * resolvidos ao vivo, por id — RQ-VER-05.
 */
type PlanAgent = {
  id: string;
  name: string;
  description: string;
  role: string;
  systemPrompt: string;
  provider: LiveProvider | null;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  stopSequences: string;
  maxSteps: number;
  enabled: boolean;
  mcpServers: { mcpServer: LiveMcpServer }[];
  children: { child: { id: string; name: string; description: string; enabled: boolean; role: string } }[];
  /** Cadeia de roteamento congelada no snapshot, com o Provider vivo por id (RQ-ROT-10). */
  candidates: PlanCandidate[];
};

/** Candidato pronto para chamar: provedor vivo (segredo) + modelo e overrides congelados. */
type PlanCandidate = {
  provider: LiveProvider;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  rank: number;
};

/** Resolve provedores e servidores MCP ao vivo por id e monta o mapa de execução do snapshot. */
async function buildPlan(snapshot: FlowSnapshot, taskType: string | null): Promise<Map<string, PlanAgent>> {
  const providerIds = [
    ...new Set(
      snapshot.agents.flatMap((a) => [
        ...(a.provider ? [a.provider.id] : []),
        ...chainFor(a, taskType).map((c) => c.provider.id),
      ]),
    ),
  ];
  const providerRows = providerIds.length ? await prisma.provider.findMany({ where: { id: { in: providerIds } } }) : [];
  const providerById = new Map(providerRows.map((p) => [p.id, p]));

  const mcpIds = snapshot.mcpServers.map((m) => m.id);
  const mcpRows = mcpIds.length ? await prisma.mcpServer.findMany({ where: { id: { in: mcpIds } } }) : [];
  const mcpById = new Map(mcpRows.map((m) => [m.id, m]));

  const childrenByParent = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    const list = childrenByParent.get(edge.from) ?? [];
    list.push(edge.to);
    childrenByParent.set(edge.from, list);
  }
  const agentById = new Map(snapshot.agents.map((a) => [a.id, a]));

  const plan = new Map<string, PlanAgent>();
  for (const a of snapshot.agents) {
    // Candidatos cujo provedor sumiu do banco caem fora — a cadeia segue com o resto.
    const candidates: PlanCandidate[] = chainFor(a, taskType).flatMap((c, index) => {
      const provider = providerById.get(c.provider.id);
      if (!provider) return [];
      return [{ provider, model: c.model, maxTokens: c.maxTokens, temperature: c.temperature, rank: index }];
    });

    plan.set(a.id, {
      id: a.id,
      name: a.name,
      description: a.description,
      role: a.role,
      systemPrompt: a.systemPrompt,
      provider: a.provider ? (providerById.get(a.provider.id) ?? null) : null,
      model: a.model,
      temperature: a.params.temperature,
      maxTokens: a.params.maxTokens,
      topP: a.params.topP,
      topK: a.params.topK,
      stopSequences: JSON.stringify(a.params.stopSequences),
      maxSteps: a.params.maxSteps,
      enabled: a.enabled,
      mcpServers: a.mcpServerIds.filter((id) => mcpById.has(id)).map((id) => ({ mcpServer: mcpById.get(id)! })),
      children: (childrenByParent.get(a.id) ?? [])
        .filter((id) => agentById.has(id))
        .map((id) => {
          const child = agentById.get(id)!;
          return {
            child: { id: child.id, name: child.name, description: child.description, enabled: child.enabled, role: child.role },
          };
        }),
      candidates,
    });
  }
  return plan;
}

type RunContext = {
  runId: string;
  trace: TraceContext;
  plan: Map<string, PlanAgent>;
  clients: Map<string, McpClient>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costKnown: boolean;
  signal: AbortSignal;
  attempt: number;
  /** Alguma chamada caiu para um candidato seguinte nesta run (RQ-ROT-11). */
  modelFailover: boolean;
};

type ToolHandler = (args: Record<string, unknown>, parent: SpanHandle) => Promise<string>;

/** Fecham como "cancelled" (design 004) tanto cancelamento pedido quanto timeout de run. */
function spanStatusFor(errorType: ErrorType): "error" | "cancelled" {
  return errorType === "cancelled" || errorType === "timeout" ? "cancelled" : "error";
}

async function getClient(ctx: RunContext, server: McpServerConfig): Promise<McpClient> {
  const existing = ctx.clients.get(server.id);
  if (existing) return existing;
  const client = new McpClient(server);
  ctx.clients.set(server.id, client);
  return client;
}

/** Monta o catálogo de tools do agente: servidores MCP + delegação a subagentes. */
async function buildTools(agent: PlanAgent, ctx: RunContext, parent: SpanHandle, depth: number) {
  const tools: ToolDef[] = [];
  /** nome exposto ao modelo -> executor */
  const handlers = new Map<string, ToolHandler>();

  for (const binding of agent.mcpServers) {
    const row = binding.mcpServer;
    if (!row.enabled) continue;

    const envKeys = parseJson<string[]>(row.envKeys, []);
    const headerKeys = parseJson<string[]>(row.headerKeys, []);
    const awaitingSecret = (envKeys.length > 0 && !row.envEnc) || (headerKeys.length > 0 && !row.headersEnc);
    if (awaitingSecret) {
      log.warn(ctx.trace, `Servidor MCP "${row.name}" aguarda um admin preencher os segredos declarados.`, {
        spanId: parent.spanId,
        errorType: "validation_error",
        payload: { server: row.name, envKeys, headerKeys },
      });
      continue;
    }

    const server: McpServerConfig = {
      id: row.id,
      name: row.name,
      transport: row.transport === "http" ? "http" : "stdio",
      command: row.command,
      args: parseJson<string[]>(row.args, []),
      envEnc: row.envEnc,
      url: row.url,
      headersEnc: row.headersEnc,
    };

    const connectSpan = startSpan(ctx.trace, {
      kind: "mcp.connect",
      name: `mcp.connect:${row.name}`,
      parent,
      agentId: agent.id,
      attributes: { "orq.mcp.server": row.name },
    });

    let listed;
    try {
      const client = await getClient(ctx, server);
      listed = await client.listTools(ctx.signal);
      endSpan(connectSpan, { status: "ok" });
    } catch (err) {
      const { errorType, message } = classifyError(err);
      endSpan(connectSpan, { status: spanStatusFor(errorType), errorType, errorMessage: message });
      if (errorType === "cancelled" || errorType === "timeout") throw err;
      log.error(ctx.trace, `Falha ao conectar no servidor MCP "${row.name}"`, {
        spanId: connectSpan.spanId,
        errorType,
        payload: { server: row.name, message },
      });
      continue;
    }

    for (const tool of listed) {
      const exposed = `${slug(row.name)}${MCP_SEPARATOR}${slug(tool.name)}`;
      tools.push({
        name: exposed,
        description: tool.description || `Tool ${tool.name} do servidor ${row.name}`,
        parameters: tool.inputSchema,
      });
      handlers.set(exposed, async (args) => {
        const client = await getClient(ctx, server);
        const outcome = await client.callTool(tool.name, args, ctx.signal);
        return outcome.content;
      });
    }
  }

  if (canDelegate(agent.role) && depth < MAX_DEPTH) {
    for (const link of agent.children) {
      const child = link.child;
      if (!child.enabled) continue;
      const exposed = `${DELEGATE_PREFIX}${slug(child.name)}`;
      const childNoun = roleNoun(child.role);
      tools.push({
        name: exposed,
        description:
          `Delega uma tarefa ao ${childNoun} "${child.name}". ${child.description}`.trim() +
          ` Descreva a tarefa de forma autocontida — o ${childNoun} não vê esta conversa.`,
        parameters: {
          type: "object",
          properties: {
            task: { type: "string", description: "A tarefa completa para o subagente executar." },
          },
          required: ["task"],
        },
      });
      handlers.set(exposed, async (args, callSpan) => {
        const task = String(args.task ?? "");
        const loaded = ctx.plan.get(child.id);
        if (!loaded) return `Subagente ${child.name} não encontrado no snapshot.`;
        return executeAgent(loaded, task, ctx, callSpan, depth + 1);
      });
    }
  }

  return { tools, handlers };
}

/**
 * Chama o modelo percorrendo a cadeia de candidatos (design 007, T7.4).
 *
 * A ordem deliberada (rank) é reordenada pela saúde observada — quem está em
 * carência vai para o fim, mas continua na cadeia (RQ-ROT-08). Cada tentativa abre
 * seu próprio span, então o trace mostra o failover inteiro: um span em erro seguido
 * do span que serviu. Erro que não indica indisponibilidade interrompe na hora
 * (RQ-ROT-07); esgotada a cadeia, propaga o erro do último candidato (RQ-ROT-09).
 */
async function callModelWithFailover(
  agent: PlanAgent,
  ctx: RunContext,
  agentSpan: SpanHandle,
  messages: Message[],
  tools: ToolDef[],
  turn: number,
): Promise<CompletionResult> {
  const health = await loadHealth(
    agent.candidates.map((c) => ({
      candidateId: null,
      providerId: c.provider.id,
      model: c.model,
      maxTokens: c.maxTokens,
      temperature: c.temperature,
      rank: c.rank,
    })),
  );
  const ordered = orderByAvailability(
    agent.candidates.map((c) => ({
      candidateId: null,
      providerId: c.provider.id,
      model: c.model,
      maxTokens: c.maxTokens,
      temperature: c.temperature,
      rank: c.rank,
    })),
    health,
  );
  const byKey = new Map(agent.candidates.map((c) => [healthKey(c.provider.id, c.model), c]));

  let lastError: unknown = null;

  for (let attempt = 0; attempt < ordered.length; attempt++) {
    if (ctx.signal.aborted) throw new AbortedError(ctx.signal.reason);

    const candidate = byKey.get(healthKey(ordered[attempt]!.providerId, ordered[attempt]!.model))!;
    const params = {
      model: candidate.model,
      temperature: candidate.temperature ?? agent.temperature,
      maxTokens: candidate.maxTokens ?? agent.maxTokens,
      topP: agent.topP,
      topK: agent.topK,
      stopSequences: parseJson<string[]>(agent.stopSequences, []),
    };
    const providerCfg = {
      id: candidate.provider.id,
      kind: candidate.provider.kind as ProviderKind,
      baseUrl: candidate.provider.baseUrl,
      apiKeyEnc: candidate.provider.apiKeyEnc,
    };

    const modelSpan = startSpan(ctx.trace, {
      kind: "model",
      name: `model:${candidate.model}`,
      parent: agentSpan,
      agentId: agent.id,
      attributes: {
        "gen_ai.system": candidate.provider.kind,
        "gen_ai.request.model": params.model,
        "gen_ai.request.temperature": params.temperature,
        "gen_ai.request.top_p": params.topP,
        "gen_ai.request.top_k": params.topK,
        "gen_ai.request.max_tokens": params.maxTokens,
        "orq.turn": turn,
        "orq.tools_offered": tools.length,
        "orq.model.rank": candidate.rank,
        "orq.model.attempt": attempt,
        "orq.model.chain_size": ordered.length,
      },
    });

    try {
      const result = await complete(providerCfg, agent.systemPrompt, messages, tools, params, ctx.signal);

      ctx.inputTokens += result.usage.inputTokens;
      ctx.outputTokens += result.usage.outputTokens;
      const costUsd = await estimateCost(
        candidate.provider.kind,
        candidate.model,
        result.usage.inputTokens,
        result.usage.outputTokens,
      );
      if (costUsd !== null) {
        ctx.costKnown = true;
        ctx.costUsd += costUsd;
      }

      endSpan(modelSpan, {
        status: "ok",
        attributes: {
          "gen_ai.usage.input_tokens": result.usage.inputTokens,
          "gen_ai.usage.output_tokens": result.usage.outputTokens,
          "gen_ai.response.finish_reason": result.stopReason,
        },
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd,
      });

      // Telemetria de saúde não bloqueia a resposta; recordSuccess/Failure nunca rejeitam.
      void recordSuccess(candidate.provider.id, candidate.model);
      return result;
    } catch (err) {
      const { errorType, message } = classifyError(err);
      endSpan(modelSpan, { status: spanStatusFor(errorType), errorType, errorMessage: message });
      lastError = err;

      if (errorType === "cancelled" || errorType === "timeout") throw err;

      void recordFailure(candidate.provider.id, candidate.model, errorType, message);

      const canFailover = isFailoverable(errorType, httpStatusOf(err));
      const hasNext = attempt < ordered.length - 1;

      if (!canFailover || !hasNext) {
        log.error(ctx.trace, "Falha ao chamar o modelo", {
          spanId: modelSpan.spanId,
          errorType,
          payload: {
            model: candidate.model,
            provider: candidate.provider.name,
            turn,
            attempts: attempt + 1,
            chainSize: ordered.length,
            message,
          },
        });
        throw err;
      }

      // Marca aqui, e não no sucesso: uma run que percorreu a cadeia e mesmo assim
      // falhou também exercitou o failover — esconder isso faria parecer que a
      // cadeia nunca foi tentada (RQ-ROT-11).
      ctx.modelFailover = true;
      log.warn(ctx.trace, `Modelo "${candidate.model}" indisponível — tentando o próximo candidato`, {
        spanId: modelSpan.spanId,
        errorType,
        payload: { model: candidate.model, provider: candidate.provider.name, turn, attempt, message },
      });
    }
  }

  throw lastError ?? new Error("Cadeia de modelos vazia");
}

async function executeAgent(
  agent: PlanAgent,
  input: string,
  ctx: RunContext,
  parent: SpanHandle | null,
  depth: number,
): Promise<string> {
  const agentSpan = startSpan(ctx.trace, {
    kind: "agent",
    name: `agent:${agent.name}`,
    parent,
    agentId: agent.id,
    attributes: { "orq.agent.role": agent.role, "orq.delegate.depth": depth, "orq.attempt": ctx.attempt },
  });

  try {
    if (ctx.signal.aborted) throw new AbortedError(ctx.signal.reason);
    if (agent.candidates.length === 0) {
      throw new Error(`Agente "${agent.name}" não tem provedor/modelo configurado.`);
    }

    const { tools, handlers } = await buildTools(agent, ctx, agentSpan, depth);

    const messages: Message[] = [{ role: "user", content: input }];
    let lastText = "";
    let finalOutput: string | null = null;

    for (let turn = 0; turn < agent.maxSteps && finalOutput === null; turn++) {
      if (ctx.signal.aborted) throw new AbortedError(ctx.signal.reason);

      const result = await callModelWithFailover(agent, ctx, agentSpan, messages, tools, turn);

      lastText = result.text || lastText;
      if (result.toolCalls.length === 0) {
        finalOutput = lastText;
        break;
      }

      messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        if (ctx.signal.aborted) throw new AbortedError(ctx.signal.reason);

        const isDelegate = call.name.startsWith(DELEGATE_PREFIX);
        const handler = handlers.get(call.name);
        const callSpan = startSpan(ctx.trace, {
          kind: isDelegate ? "delegate" : "tool",
          name: call.name,
          parent: agentSpan,
          agentId: agent.id,
          attributes: isDelegate
            ? { "orq.delegate.child_agent_id": call.name }
            : { "orq.tool.name": call.name, "orq.tool.args_size": JSON.stringify(call.args ?? {}).length },
        });

        let output: string;
        let status: "ok" | "error" | "cancelled" = "ok";
        let errorType: ErrorType | undefined;

        if (!handler) {
          output = `Tool desconhecida: ${call.name}`;
          status = "error";
          errorType = "validation_error";
        } else {
          try {
            output = await handler(call.args, callSpan);
          } catch (err) {
            const classified = classifyError(err);
            output = `Erro ao executar ${call.name}: ${classified.message}`;
            status = spanStatusFor(classified.errorType);
            errorType = classified.errorType;
          }
        }

        endSpan(callSpan, {
          status,
          errorType,
          errorMessage: status !== "ok" ? output : undefined,
          attributes: isDelegate ? {} : { "orq.tool.result_size": output.length, "orq.tool.is_error": status !== "ok" },
        });

        if (errorType === "cancelled" || errorType === "timeout") throw new AbortedError(ctx.signal.reason);

        if (status === "error") {
          log.error(ctx.trace, `Falha ao executar ${call.name}`, {
            spanId: callSpan.spanId,
            errorType,
            payload: { name: call.name, args: call.args },
          });
        }

        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: output });
      }
    }

    if (finalOutput === null) {
      finalOutput = lastText || `Limite de ${agent.maxSteps} passos atingido sem resposta final.`;
      endSpan(agentSpan, { status: "error", errorType: "max_steps_exceeded", errorMessage: finalOutput });
      log.warn(ctx.trace, finalOutput, { spanId: agentSpan.spanId, errorType: "max_steps_exceeded" });
      return finalOutput;
    }

    endSpan(agentSpan, { status: "ok" });
    return finalOutput;
  } catch (err) {
    const { errorType, message } = classifyError(err);
    endSpan(agentSpan, { status: spanStatusFor(errorType), errorType, errorMessage: message });
    throw err;
  }
}

/**
 * Insere a run em `queued`; a execução de fato é feita pelo worker (RQ-ASY-01). O
 * snapshot a executar é resolvido AGORA — fixado (versão publicada) ou ao vivo
 * (rascunho, RQ-VER-06) — para que o trace mostre sempre a configuração exata que o
 * usuário viu ao disparar, mesmo que o rascunho mude antes do worker pegar a run.
 */
export async function enqueueRun(
  agentId: string,
  input: string,
  opts?: {
    triggeredById?: string;
    idempotencyKey?: string;
    priority?: number;
    timeoutMs?: number;
    /** Fixa a execução numa versão publicada do fluxo do qual agentId é a raiz (RQ-VER-05). */
    flowVersion?: number | "current";
    /** Seleciona a cadeia de modelos do tipo de tarefa pedido (RQ-ROT-04). */
    taskType?: string;
    /** Canal de origem da execução — "ui" | "api" | "openai" (RQ-OAI-11). */
    source?: string;
  },
): Promise<{ run: Awaited<ReturnType<typeof prisma.run.create>>; deduped: boolean }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId, deletedAt: null }, select: { id: true } });
  if (!agent) throw new Error("Agente não encontrado");

  if (opts?.idempotencyKey) {
    const existing = await prisma.run.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return { run: existing, deduped: true };
  }

  let flowId: string | null = null;
  let flowVersionId: string | null = null;
  let sourceKind: "draft" | "version" = "draft";
  let draftSnapshot: string | null = null;

  if (opts?.flowVersion !== undefined) {
    const flow = await prisma.flow.findFirst({ where: { rootAgentId: agentId } });
    if (!flow) throw new Error("Este agente não é a raiz de um fluxo — publique um fluxo antes de fixar uma versão.");
    const versionRow =
      opts.flowVersion === "current"
        ? flow.currentVersionId
          ? await prisma.flowVersion.findUnique({ where: { id: flow.currentVersionId } })
          : null
        : await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId: flow.id, version: opts.flowVersion } } });
    if (!versionRow) throw new Error("Versão do fluxo não encontrada ou nunca publicada.");
    flowId = flow.id;
    flowVersionId = versionRow.id;
    sourceKind = "version";
  } else {
    const snapshot = await resolveFlowGraph(agentId);
    if (snapshot) draftSnapshot = JSON.stringify(snapshot);
    const flow = await prisma.flow.findFirst({ where: { rootAgentId: agentId }, select: { id: true } });
    flowId = flow?.id ?? null;
  }

  try {
    const run = await prisma.run.create({
      data: {
        agentId,
        input,
        status: "queued",
        flowId,
        flowVersionId,
        sourceKind,
        draftSnapshot,
        source: opts?.source ?? "ui",
        taskType: opts?.taskType?.trim() || null,
        triggeredById: opts?.triggeredById ?? null,
        idempotencyKey: opts?.idempotencyKey ?? null,
        priority: opts?.priority ?? 0,
        timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
    });
    return { run, deduped: false };
  } catch (err) {
    // Corrida entre dois POSTs com a mesma Idempotency-Key — a constraint @unique pegou primeiro.
    if (opts?.idempotencyKey && isUniqueConstraintError(err)) {
      const existing = await prisma.run.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
      if (existing) return { run: existing, deduped: true };
    }
    throw err;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Executa uma run já reivindicada pelo worker (`status = "running"`), persistindo
 * spans e logs, e decide a transição final: sucesso, cancelamento, timeout, ou
 * falha — com re-enfileiramento automático se o erro for transitório (RQ-ASY-09).
 * A topologia executada vem do snapshot fixado no enfileiramento — nunca da tabela
 * `Agent` ao vivo (RQ-VER-05).
 */
export async function executeQueuedRun(runId: string, signal: AbortSignal): Promise<void> {
  const run = await prisma.run.findUnique({ where: { id: runId }, include: { flowVersion: true } });
  if (!run) return;

  const snapshotJson = run.sourceKind === "version" ? run.flowVersion?.snapshot : run.draftSnapshot;
  if (!snapshotJson) {
    await transition(runId, ["running"], "failed", {
      error: "Snapshot de execução ausente — o agente pode ter sido excluído antes da execução.",
      errorType: "internal_error",
      endedAt: new Date(),
    });
    await forceFlush();
    return;
  }
  const snapshot = JSON.parse(snapshotJson) as FlowSnapshot;

  if (run.sourceKind === "version") {
    const drift = await computeDrift(snapshot);
    if (drift.configDrift) {
      await prisma.run.update({ where: { id: runId }, data: drift });
      log.warn(createTraceContext(runId), `Configuração divergiu do snapshot fixado: ${drift.driftDetail}`, {
        errorType: "validation_error",
      });
    }
  }

  const plan = await buildPlan(snapshot, run.taskType);
  const ctx: RunContext = {
    runId,
    trace: createTraceContext(runId),
    plan,
    clients: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costKnown: false,
    signal,
    attempt: run.attempt,
    modelFailover: false,
  };

  try {
    const rootAgent = plan.get(run.agentId);
    if (!rootAgent) throw new Error("Agente não encontrado no snapshot resolvido.");

    const output = await executeAgent(rootAgent, run.input, ctx, null, 0);
    const ok = await transition(runId, ["running"], "succeeded", {
      output,
      endedAt: new Date(),
      inputTokens: ctx.inputTokens,
      outputTokens: ctx.outputTokens,
      costUsd: ctx.costKnown ? ctx.costUsd : null,
      modelFailover: ctx.modelFailover,
    });
    if (!ok) console.warn(`[queue] transição succeeded ignorada — run ${runId} não estava mais running`);
  } catch (err) {
    const { errorType, message } = classifyError(err);
    const base = {
      error: message,
      errorType,
      inputTokens: ctx.inputTokens,
      outputTokens: ctx.outputTokens,
      costUsd: ctx.costKnown ? ctx.costUsd : null,
      modelFailover: ctx.modelFailover,
    };

    let ok: boolean;
    if (errorType === "cancelled") {
      ok = await transition(runId, ["running"], "cancelled", { ...base, endedAt: new Date() });
    } else if (errorType === "timeout") {
      ok = await transition(runId, ["running"], "timed_out", { ...base, endedAt: new Date() });
    } else {
      const cap = maxAttemptsFor(errorType);
      if (run.attempt < cap) {
        ok = await transition(runId, ["running"], "queued", {
          ...base,
          maxAttempts: cap,
          nextAttemptAt: new Date(Date.now() + backoffMs(run.attempt)),
        });
      } else {
        ok = await transition(runId, ["running"], "failed", { ...base, maxAttempts: cap, endedAt: new Date() });
      }
    }
    if (!ok) console.warn(`[queue] transição de erro ignorada — run ${runId} não estava mais running`);
  } finally {
    for (const client of ctx.clients.values()) client.close();
    await forceFlush();
  }
}
