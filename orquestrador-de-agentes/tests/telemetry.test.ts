import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setupTestDb } from "./helpers/testdb.ts";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64url");
const { cleanup } = setupTestDb();

const { prisma } = await import("../src/lib/db.ts");
const { classifyError, ProviderError, McpError } = await import("../src/lib/telemetry/errors.ts");
const { createTraceContext, startSpan, endSpan } = await import("../src/lib/telemetry/tracer.ts");
const { log } = await import("../src/lib/telemetry/log.ts");
const { forceFlush } = await import("../src/lib/telemetry/buffer.ts");
const { redact } = await import("../src/lib/telemetry/redact.ts");

await prisma.agent.create({ data: { id: "agt", name: "Agente teste" } });

test("classifyError distingue provider, mcp e erro genérico", () => {
  assert.equal(classifyError(new ProviderError("boom", { httpStatus: 500 })).errorType, "provider_error");
  assert.equal(classifyError(new ProviderError("boom", { httpStatus: 429 })).errorType, "provider_rate_limit");
  assert.equal(classifyError(new McpError("processo morto")).errorType, "mcp_connection_error");
  assert.equal(classifyError(new Error("qualquer coisa")).errorType, "internal_error");
});

test("redact mascara chaves sensíveis e trunca strings grandes", () => {
  const out = redact({ apiKey: "sk-abcdefghij", note: "a".repeat(20) }, 10) as Record<string, unknown>;
  assert.equal(out.apiKey, "sk-a••••ghij");
  assert.match(out.note as string, /…\[truncado\]$/);
});

test("invariante da árvore: span filho abre depois e fecha antes do pai", async () => {
  const run = await prisma.run.create({ data: { agentId: "agt", input: "x", status: "running" } });

  const ctx = createTraceContext(run.id);
  const parent = startSpan(ctx, { kind: "agent", name: "agent:Coordenador", parent: null });
  await new Promise((r) => setTimeout(r, 5));
  const child = startSpan(ctx, { kind: "model", name: "model:x", parent });
  await new Promise((r) => setTimeout(r, 5));
  endSpan(child, { status: "ok" });
  endSpan(parent, { status: "ok" });
  await forceFlush();

  const spans = await prisma.span.findMany({ where: { runId: run.id }, orderBy: { seq: "asc" } });
  assert.equal(spans.length, 2);
  const [parentRow, childRow] = spans;
  assert.equal(childRow.parentSpanId, parentRow.spanId);
  assert.ok(childRow.startedAt.getTime() >= parentRow.startedAt.getTime());
  assert.ok(childRow.endedAt!.getTime() <= parentRow.endedAt!.getTime());
  assert.equal(parentRow.status, "ok");
});

test("log estruturado correlacionado é gravado e filtrável por nível", async () => {
  const run = await prisma.run.create({ data: { agentId: "agt", input: "y", status: "running" } });
  const ctx = createTraceContext(run.id);
  const span = startSpan(ctx, { kind: "tool", name: "tool:x", parent: null });
  log.error(ctx, "Falha ao executar tool", { spanId: span.spanId, errorType: "tool_error", payload: { a: 1 } });
  log.info(ctx, "marco qualquer", { spanId: span.spanId });
  endSpan(span, { status: "error", errorType: "tool_error", errorMessage: "falhou" });
  await forceFlush();

  const errorLogs = await prisma.logEntry.findMany({ where: { runId: run.id, level: "error" } });
  assert.equal(errorLogs.length, 1);
  assert.equal(errorLogs[0].errorType, "tool_error");
});

test("buffer aguenta escrita concorrente de várias runs sem lançar", async () => {
  const runs = await Promise.all(
    Array.from({ length: 4 }, (_, i) => prisma.run.create({ data: { agentId: "agt", input: `r${i}`, status: "running" } })),
  );

  await Promise.all(
    runs.map(async (run) => {
      const ctx = createTraceContext(run.id);
      for (let i = 0; i < 20; i++) {
        const span = startSpan(ctx, { kind: "tool", name: `tool:${i}`, parent: null });
        endSpan(span, { status: "ok" });
      }
    }),
  );
  await forceFlush();

  for (const run of runs) {
    const count = await prisma.span.count({ where: { runId: run.id } });
    assert.equal(count, 20);
  }
});

test.after(async () => {
  await prisma.$disconnect();
  cleanup();
});
