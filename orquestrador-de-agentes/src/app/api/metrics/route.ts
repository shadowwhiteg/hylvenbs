import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

const WINDOWS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** RQ-OBS-07: percentis por consulta ordenada — o volume atual não justifica pré-agregação. */
export async function GET(request: Request) {
  const guard = await requireUser(request, "run.read");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId") || undefined;
  const window = url.searchParams.get("window") ?? "24h";
  const windowMs = WINDOWS[window];
  if (!windowMs) return fail("window deve ser 1h, 24h, 7d ou 30d", 422);

  const since = new Date(Date.now() - windowMs);
  const runWhere = { queuedAt: { gte: since }, ...(agentId ? { agentId } : {}) };

  const runs = await prisma.run.findMany({
    where: runWhere,
    select: { status: true, errorType: true, startedAt: true, endedAt: true, inputTokens: true, outputTokens: true, costUsd: true },
  });

  const byStatus: Record<string, number> = {};
  const byErrorType: Record<string, number> = {};
  const durations: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let costKnown = false;

  for (const run of runs) {
    byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
    if (run.errorType) byErrorType[run.errorType] = (byErrorType[run.errorType] ?? 0) + 1;
    if (run.endedAt && run.startedAt) durations.push(run.endedAt.getTime() - run.startedAt.getTime());
    inputTokens += run.inputTokens;
    outputTokens += run.outputTokens;
    if (run.costUsd != null) {
      costKnown = true;
      costUsd += run.costUsd;
    }
  }
  durations.sort((a, b) => a - b);

  const spanWhere = {
    startedAt: { gte: since },
    kind: "tool" as const,
    ...(agentId ? { run: { agentId } } : {}),
  };
  const toolSpans = await prisma.span.findMany({
    where: spanWhere,
    select: { name: true, status: true },
  });
  const toolStats = new Map<string, { calls: number; errors: number }>();
  for (const span of toolSpans) {
    const entry = toolStats.get(span.name) ?? { calls: 0, errors: 0 };
    entry.calls++;
    if (span.status === "error") entry.errors++;
    toolStats.set(span.name, entry);
  }
  const topTools = [...toolStats.entries()]
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  return ok({
    window,
    since,
    totalRuns: runs.length,
    byStatus,
    errorRateByType: byErrorType,
    latencyMs: { p50: percentile(durations, 50), p95: percentile(durations, 95) },
    tokens: { input: inputTokens, output: outputTokens },
    costUsd: costKnown ? costUsd : null,
    topTools,
  });
}
