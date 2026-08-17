import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { enqueueRun } from "@/lib/orchestrator";
import {
  findUnsupportedParam,
  flattenMessages,
  listIgnoredParams,
  mapRunTermination,
  openAiError,
  UnsupportedContentError,
  type ChatMessage,
} from "@/lib/openai-compat/translate";
import { resolveModel } from "@/lib/openai-compat/resolve-model";
import { isTerminal, waitForTerminal } from "@/lib/queue/state";
import { log } from "@/lib/telemetry/log";
import { createTraceContext } from "@/lib/telemetry/tracer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

const MAX_WAIT_SECONDS = 120;
const KEEPALIVE_MS = 15_000;

type CompletionsBody = {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
  orq_task_type?: unknown;
  orq_flow_version?: unknown;
  [key: string]: unknown;
};

type RunWithVersion = Awaited<ReturnType<typeof fetchRunWithVersion>>;

function fetchRunWithVersion(runId: string) {
  return prisma.run.findUnique({
    where: { id: runId },
    include: { flowVersion: { select: { version: true } } },
  });
}

async function rootSpanErrorType(runId: string): Promise<string | null> {
  const span = await prisma.span.findFirst({ where: { runId, parentSpanId: null }, select: { errorType: true } });
  return span?.errorType ?? null;
}

/**
 * `POST /api/v1/chat/completions` (design 010) — dialeto chat/completions da OpenAI
 * sobre o motor de runs. Uma requisição = uma run, sem estado entre chamadas (D4).
 */
export async function POST(request: Request) {
  const guard = await requireUser(request, "run.create");
  if (!guard.ok) return guard.response;

  let body: CompletionsBody;
  try {
    body = await request.json();
  } catch {
    return Response.json(openAiError("Corpo JSON inválido.", "invalid_request_error", "invalid_json"), { status: 400 });
  }

  if (typeof body.model !== "string" || !body.model.trim()) {
    return Response.json(
      openAiError('Campo "model" é obrigatório.', "invalid_request_error", "missing_model"),
      { status: 400 },
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json(
      openAiError('Campo "messages" é obrigatório e não pode ser vazio.', "invalid_request_error", "missing_messages"),
      { status: 400 },
    );
  }

  const unsupported = findUnsupportedParam(body);
  if (unsupported) {
    return Response.json(
      openAiError(
        `Parâmetro "${unsupported}" não é suportado — as tools deste orquestrador vêm do fluxo, não do cliente.`,
        "invalid_request_error",
        "unsupported_parameter",
      ),
      { status: 400 },
    );
  }

  let input: string;
  try {
    input = flattenMessages(body.messages as ChatMessage[]);
  } catch (err) {
    if (err instanceof UnsupportedContentError) {
      return Response.json(
        openAiError(`Parte de conteúdo "${err.partType}" não é suportada — só texto.`, "invalid_request_error", "unsupported_content"),
        { status: 400 },
      );
    }
    throw err;
  }
  if (!input.trim()) {
    return Response.json(
      openAiError('Nenhum texto encontrado em "messages".', "invalid_request_error", "empty_input"),
      { status: 400 },
    );
  }

  const bodyFlowVersion =
    typeof body.orq_flow_version === "number" || body.orq_flow_version === "current" ? body.orq_flow_version : undefined;
  const resolution = await resolveModel(body.model, bodyFlowVersion);
  if (!resolution) {
    return Response.json(
      openAiError(`Model "${body.model}" não encontrado.`, "invalid_request_error", "model_not_found"),
      { status: 404 },
    );
  }

  const taskType = typeof body.orq_task_type === "string" && body.orq_task_type.trim() ? body.orq_task_type : undefined;

  const { run } = await enqueueRun(resolution.agentId, input, {
    triggeredById: guard.user.id,
    flowVersion: resolution.flowVersion,
    taskType,
    source: "openai",
  });

  const ignored = listIgnoredParams(body);
  if (ignored.length > 0) {
    log.debug(createTraceContext(run.id), "Parâmetros de amostragem ignorados — não suportados pelo orquestrador", {
      payload: { ignored },
    });
  }

  const chatId = `chatcmpl-${run.id}`;
  const created = Math.floor(Date.now() / 1000);
  const modelEcho = body.model;

  if (body.stream === true) {
    return streamCompletion(run.id, chatId, created, modelEcho, request.signal);
  }

  const finalRun = await pollWithKeepAlive(run.id, MAX_WAIT_SECONDS * 1000, () => undefined);
  const full = (finalRun ? await fetchRunWithVersion(finalRun.id) : null) ?? (await fetchRunWithVersion(run.id));
  return Response.json(...(await buildResponseBody(full, chatId, created, modelEcho)));
}

/** Espera em fatias, chamando `onKeepAlive` a cada fatia sem run terminal (RQ-OAI-09). */
async function pollWithKeepAlive(runId: string, totalMs: number, onKeepAlive: () => void) {
  const deadline = Date.now() + totalMs;
  for (;;) {
    const slice = Math.max(0, Math.min(KEEPALIVE_MS, deadline - Date.now()));
    const run = await waitForTerminal(runId, slice);
    if (!run || isTerminal(run.status) || Date.now() >= deadline) return run;
    onKeepAlive();
  }
}

async function buildResponseBody(
  run: RunWithVersion,
  chatId: string,
  created: number,
  modelEcho: string,
): Promise<[unknown, { status: number }]> {
  if (!run) {
    return [openAiError("A execução não foi encontrada.", "internal_error", "run_missing"), { status: 500 }];
  }

  const outcome = mapRunTermination(run, run.status === "succeeded" ? await rootSpanErrorType(run.id) : null);

  if (!outcome.ok) {
    return [
      { ...openAiError(outcome.error.message, outcome.error.type, outcome.error.code), orq: { run_id: outcome.runId } },
      { status: outcome.httpStatus },
    ];
  }

  return [
    {
      id: chatId,
      object: "chat.completion",
      created,
      model: modelEcho,
      choices: [
        { index: 0, message: { role: "assistant", content: run.output ?? "" }, finish_reason: outcome.finishReason },
      ],
      usage: {
        prompt_tokens: run.inputTokens,
        completion_tokens: run.outputTokens,
        total_tokens: run.inputTokens + run.outputTokens,
      },
      orq: {
        run_id: run.id,
        flow_version: run.flowVersion?.version ?? null,
        model_failover: run.modelFailover,
        cost_usd: run.costUsd,
      },
    },
    { status: 200 },
  ];
}

/** `stream: true` (D7): role -> conteúdo final -> finish_reason, chunks reais mas não incrementais. */
function streamCompletion(
  runId: string,
  chatId: string,
  created: number,
  modelEcho: string,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function write(text: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      }
      function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
        write(
          `data: ${JSON.stringify({
            id: chatId,
            object: "chat.completion.chunk",
            created,
            model: modelEcho,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
          })}\n\n`,
        );
      }

      signal.addEventListener("abort", () => {
        closed = true;
      });

      // Sai assim que a run é enfileirada — o cliente confirma a conexão sem esperar o fluxo inteiro.
      chunk({ role: "assistant" });

      const finalRun = await pollWithKeepAlive(runId, MAX_WAIT_SECONDS * 1000, () => write(": keep-alive\n\n"));
      const full = (finalRun ? await fetchRunWithVersion(finalRun.id) : null) ?? (await fetchRunWithVersion(runId));

      if (!full) {
        write(
          `data: ${JSON.stringify({ id: chatId, object: "chat.completion.chunk", orq: { error: { message: "run sumiu", type: "internal_error", code: "run_missing" } } })}\n\n`,
        );
      } else {
        const outcome = mapRunTermination(full, full.status === "succeeded" ? await rootSpanErrorType(full.id) : null);
        if (outcome.ok) {
          chunk({ content: full.output ?? "" });
          chunk({}, outcome.finishReason);
        } else {
          // O status HTTP já foi enviado (200, SSE) — o erro vira um chunk (D7).
          write(
            `data: ${JSON.stringify({
              id: chatId,
              object: "chat.completion.chunk",
              orq: { error: outcome.error, run_id: outcome.runId },
            })}\n\n`,
          );
        }
      }

      write("data: [DONE]\n\n");
      try {
        controller.close();
      } catch {
        /* já fechado pelo consumidor */
      }
    },
    cancel() {
      // Cliente desconectou — a run continua até o fim (D4/D6), só o stream para.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
