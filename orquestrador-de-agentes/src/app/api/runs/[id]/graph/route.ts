import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { snapshotToGraph } from "@/lib/graph/build";
import { buildRuntime } from "@/lib/graph/runtime";
import type { FlowSnapshot } from "@/lib/flows/snapshot";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/**
 * Topologia + agregados de execução (RQ-VIS-01/07/08). A topologia vem sempre do
 * snapshot que rodou — nunca da configuração atual (RQ-VIS-08): abrir uma run
 * antiga desenha o fluxo daquela época, mesmo que agentes tenham mudado desde então.
 */
export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "run.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const run = await prisma.run.findUnique({
    where: { id },
    select: { id: true, sourceKind: true, draftSnapshot: true, flowVersion: { select: { snapshot: true } } },
  });
  if (!run) return fail("Execução não encontrada", 404);

  const snapshotJson = run.sourceKind === "version" ? run.flowVersion?.snapshot : run.draftSnapshot;
  if (!snapshotJson) return fail("Execução sem snapshot de fluxo associado", 404);

  const snapshot = JSON.parse(snapshotJson) as FlowSnapshot;
  const graph = snapshotToGraph(snapshot);

  const spans = await prisma.span.findMany({ where: { runId: id }, orderBy: { seq: "asc" } });
  graph.runtime = buildRuntime(snapshot, graph.edges, spans);

  return ok(graph);
}
