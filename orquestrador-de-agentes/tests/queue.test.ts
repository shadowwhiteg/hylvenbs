import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const { transition, waitForTerminal } = await import("../src/lib/queue/state.ts");
const { claimNext, WORKER_ID } = await import("../src/lib/queue/worker.ts");
const { backoffMs, maxAttemptsFor } = await import("../src/lib/queue/retry.ts");
const { enqueueRun } = await import("../src/lib/orchestrator.ts");
const { emitRunEvent } = await import("../src/lib/queue/events.ts");

await prisma.agent.create({ data: { id: "agt", name: "Agente teste" } });

test("transition() só aplica com o estado de origem correto", async () => {
  const run = await prisma.run.create({ data: { agentId: "agt", input: "x", status: "queued" } });

  const invalid = await transition(run.id, ["running"], "succeeded");
  assert.equal(invalid, false);
  const stillQueued = await prisma.run.findUnique({ where: { id: run.id } });
  assert.equal(stillQueued!.status, "queued");

  const valid = await transition(run.id, ["queued"], "running", { lockedBy: "w" });
  assert.equal(valid, true);
  const nowRunning = await prisma.run.findUnique({ where: { id: run.id } });
  assert.equal(nowRunning!.status, "running");
  assert.equal(nowRunning!.lockedBy, "w");
});

test("claimNext respeita prioridade e ordem de chegada, e não reclama duas vezes", async () => {
  const low = await prisma.run.create({ data: { agentId: "agt", input: "low", status: "queued", priority: 0 } });
  await new Promise((r) => setTimeout(r, 5));
  const high = await prisma.run.create({ data: { agentId: "agt", input: "high", status: "queued", priority: 5 } });

  const first = await claimNext();
  assert.equal(first?.id, high.id, "prioridade maior deve ser reclamada primeiro");

  const second = await claimNext();
  assert.equal(second?.id, low.id);

  const third = await claimNext();
  assert.equal(third, null, "nada mais na fila");

  const rows = await prisma.run.findMany({ where: { id: { in: [low.id, high.id] } } });
  for (const row of rows) {
    assert.equal(row.status, "running");
    assert.equal(row.attempt, 1);
    assert.equal(row.lockedBy, WORKER_ID);
    assert.ok(row.startedAt);
  }
});

test("claimNext respeita nextAttemptAt no futuro", async () => {
  await prisma.run.create({
    data: { agentId: "agt", input: "adiada", status: "queued", nextAttemptAt: new Date(Date.now() + 60_000) },
  });
  const claimed = await claimNext();
  assert.equal(claimed, null);
});

test("backoffMs cresce exponencialmente e satura em 60s; maxAttemptsFor distingue transitório", () => {
  assert.ok(backoffMs(1) <= 1000);
  assert.ok(backoffMs(2) <= 2000);
  assert.ok(backoffMs(10) <= 60_000);
  assert.equal(maxAttemptsFor("provider_rate_limit"), 3);
  assert.equal(maxAttemptsFor("mcp_connection_error"), 3);
  assert.equal(maxAttemptsFor("validation_error"), 1);
  assert.equal(maxAttemptsFor("tool_error"), 1);
});

test("enqueueRun com Idempotency-Key repetida devolve a mesma run", async () => {
  const key = `idem-${randomBytes(4).toString("hex")}`;
  const { run: first, deduped: firstDeduped } = await enqueueRun("agt", "tarefa", { idempotencyKey: key });
  assert.equal(firstDeduped, false);

  const { run: second, deduped: secondDeduped } = await enqueueRun("agt", "tarefa outra", { idempotencyKey: key });
  assert.equal(secondDeduped, true);
  assert.equal(second.id, first.id);

  const count = await prisma.run.count({ where: { idempotencyKey: key } });
  assert.equal(count, 1);
});

test("waitForTerminal devolve assim que a run chega num estado terminal", async () => {
  const run = await prisma.run.create({ data: { agentId: "agt", input: "x", status: "queued" } });
  const waiter = waitForTerminal(run.id, 5000);

  setTimeout(async () => {
    await transition(run.id, ["queued"], "running");
    await transition(run.id, ["running"], "succeeded", { output: "ok", endedAt: new Date() });
  }, 20);

  const result = await waiter;
  assert.equal(result?.status, "succeeded");
  assert.equal(result?.output, "ok");
});

test("waitForTerminal expira e devolve o estado corrente se a run não termina a tempo", async () => {
  const run = await prisma.run.create({ data: { agentId: "agt", input: "x", status: "queued" } });
  const result = await waitForTerminal(run.id, 50);
  assert.equal(result?.status, "queued");
});

test("emitRunEvent não lança quando não há assinantes", () => {
  assert.doesNotThrow(() => emitRunEvent("run-sem-assinante"));
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
