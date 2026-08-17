import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const {
  flattenMessages,
  UnsupportedContentError,
  openAiError,
  findUnsupportedParam,
  listIgnoredParams,
  mapRunTermination,
} = await import("../src/lib/openai-compat/translate.ts");
const { splitModelParam, parseVersionSuffix, resolveModel, listModels } = await import(
  "../src/lib/openai-compat/resolve-model.ts"
);

// --- translate.ts ---------------------------------------------------------

test("flattenMessages: uma única mensagem user vira texto puro, sem rótulo (D5)", () => {
  assert.equal(flattenMessages([{ role: "user", content: "Qual a garantia do Pulse?" }]), "Qual a garantia do Pulse?");
});

test("flattenMessages: conversa de vários turnos rotula cada papel, na ordem (RQ-OAI-06)", () => {
  const flattened = flattenMessages([
    { role: "system", content: "Você é um atendente." },
    { role: "user", content: "Qual a garantia do Pulse?" },
    { role: "assistant", content: "São 3 anos." },
    { role: "user", content: "E do Argo?" },
  ]);
  assert.equal(
    flattened,
    "[system] Você é um atendente.\n[user] Qual a garantia do Pulse?\n[assistant] São 3 anos.\n[user] E do Argo?",
  );
});

test("flattenMessages: partes de texto são concatenadas", () => {
  const flattened = flattenMessages([
    { role: "user", content: "oi" },
    { role: "assistant", content: [{ type: "text", text: "ol" }, { type: "text", text: "á" }] },
  ]);
  assert.equal(flattened, "[user] oi\n[assistant] olá");
});

test("flattenMessages: parte de conteúdo não-texto lança UnsupportedContentError", () => {
  assert.throws(
    () => flattenMessages([{ role: "user", content: [{ type: "image_url", image_url: { url: "http://x" } }] }]),
    UnsupportedContentError,
  );
});

test("openAiError: envelope {error:{message,type,code}} (D9)", () => {
  assert.deepEqual(openAiError("msg", "invalid_request_error", "missing_model"), {
    error: { message: "msg", type: "invalid_request_error", code: "missing_model" },
  });
});

test("findUnsupportedParam: tools/functions/tool_choice/logprobs e n>1 são recusados (D8/RQ-OAI-10)", () => {
  assert.equal(findUnsupportedParam({ tools: [] }), "tools");
  assert.equal(findUnsupportedParam({ functions: [] }), "functions");
  assert.equal(findUnsupportedParam({ n: 2 }), "n");
  assert.equal(findUnsupportedParam({ n: 1 }), null);
  assert.equal(findUnsupportedParam({ temperature: 0.5 }), null);
});

test("listIgnoredParams: só os parâmetros de amostragem presentes no corpo", () => {
  assert.deepEqual(listIgnoredParams({ temperature: 0, seed: 1, model: "x" }), ["temperature", "seed"]);
  assert.deepEqual(listIgnoredParams({ model: "x" }), []);
});

test("mapRunTermination: succeeded -> 200 stop; com span raiz max_steps_exceeded -> 200 length", () => {
  const run = { id: "r1", status: "succeeded", error: null, errorType: null };
  assert.deepEqual(mapRunTermination(run, null), { ok: true, httpStatus: 200, finishReason: "stop" });
  assert.deepEqual(mapRunTermination(run, "max_steps_exceeded"), { ok: true, httpStatus: 200, finishReason: "length" });
});

test("mapRunTermination: failed -> 502 upstream_error com run_id", () => {
  const run = { id: "r1", status: "failed", error: "boom", errorType: "provider_error" };
  const outcome = mapRunTermination(run, null);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.httpStatus, 502);
    assert.equal(outcome.runId, "r1");
    assert.equal(outcome.error.type, "upstream_error");
    assert.equal(outcome.error.code, "provider_error");
  }
});

test("mapRunTermination: cancelled -> 409; timed_out -> 504; queued/running -> 504 run_pending", () => {
  const cancelled = mapRunTermination({ id: "r1", status: "cancelled", error: null, errorType: null }, null);
  const timedOut = mapRunTermination({ id: "r1", status: "timed_out", error: null, errorType: null }, null);
  const pending = mapRunTermination({ id: "r1", status: "queued", error: null, errorType: null }, null);
  assert.equal(cancelled.httpStatus, 409);
  assert.equal(timedOut.httpStatus, 504);
  assert.equal(pending.httpStatus, 504);
  if (!pending.ok) assert.equal(pending.error.code, "run_pending");
});

// --- resolve-model.ts -------------------------------------------------------

test("splitModelParam / parseVersionSuffix", () => {
  assert.deepEqual(splitModelParam("atendimento-fiat"), { base: "atendimento-fiat", suffix: undefined });
  assert.deepEqual(splitModelParam("atendimento-fiat@3"), { base: "atendimento-fiat", suffix: "3" });
  assert.deepEqual(splitModelParam("atendimento-fiat@current"), { base: "atendimento-fiat", suffix: "current" });
  assert.equal(parseVersionSuffix(undefined), undefined);
  assert.equal(parseVersionSuffix("current"), "current");
  assert.equal(parseVersionSuffix("3"), 3);
  assert.equal(parseVersionSuffix("abc"), undefined);
});

const provider = await prisma.provider.create({ data: { name: "Anthropic", kind: "anthropic" } });

async function makeOrchestrator(name: string) {
  return prisma.agent.create({
    data: { name, role: "orchestrator", providerId: provider.id, model: "claude-opus-4-8" },
  });
}

test("resolveModel: resolve pelo slug do fluxo (D2)", async () => {
  const agent = await makeOrchestrator("Atendimento Fiat");
  const flow = await prisma.flow.create({ data: { name: agent.name, slug: "atendimento-fiat", rootAgentId: agent.id } });
  await prisma.agent.update({ where: { id: agent.id }, data: { flowId: flow.id } });

  const resolution = await resolveModel("atendimento-fiat@3", undefined);
  assert.deepEqual(resolution, { agentId: agent.id, flowVersion: 3 });
});

test("resolveModel: resolve pelo id do agente quando não há fluxo ainda (RQ-OAI-02)", async () => {
  const agent = await makeOrchestrator("Sem fluxo");
  const resolution = await resolveModel(agent.id, undefined);
  assert.deepEqual(resolution, { agentId: agent.id, flowVersion: undefined });
});

test("resolveModel: sufixo do model tem precedência sobre orq_flow_version do corpo (D3)", async () => {
  const agent = await makeOrchestrator("Precedência");
  const flow = await prisma.flow.create({ data: { name: agent.name, slug: "precedencia", rootAgentId: agent.id } });
  await prisma.agent.update({ where: { id: agent.id }, data: { flowId: flow.id } });

  const resolution = await resolveModel("precedencia@current", 7);
  assert.deepEqual(resolution, { agentId: agent.id, flowVersion: "current" });
});

test("resolveModel: model desconhecido devolve null (404 model_not_found)", async () => {
  assert.equal(await resolveModel("nao-existe", undefined), null);
});

test("resolveModel: id de um subagente não resolve (só orchestrator pode ser model)", async () => {
  const sub = await prisma.agent.create({
    data: { name: "Sub", role: "subagent", providerId: provider.id, model: "claude-opus-4-8" },
  });
  assert.equal(await resolveModel(sub.id, undefined), null);
});

test("listModels: um item por orquestrador não excluído; id é o slug quando há fluxo", async () => {
  const withFlow = await makeOrchestrator("Com fluxo");
  const flow = await prisma.flow.create({ data: { name: withFlow.name, slug: "com-fluxo", rootAgentId: withFlow.id } });
  await prisma.agent.update({ where: { id: withFlow.id }, data: { flowId: flow.id } });

  const withoutFlow = await makeOrchestrator("Sem fluxo ainda");

  const deletedOne = await makeOrchestrator("Excluído");
  await prisma.agent.update({ where: { id: deletedOne.id }, data: { deletedAt: new Date() } });

  const models = await listModels();
  const ids = models.map((m) => m.id);
  assert.ok(ids.includes("com-fluxo"));
  assert.ok(ids.includes(withoutFlow.id));
  assert.ok(!ids.some((id) => id === deletedOne.id));
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
