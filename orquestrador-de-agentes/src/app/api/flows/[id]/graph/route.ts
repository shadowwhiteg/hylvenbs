import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { snapshotToGraph } from "@/lib/graph/build";
import { resolveFlowGraph, type FlowSnapshot } from "@/lib/flows/snapshot";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** Resolve "draft" | "current" | número de versão | etiqueta para um snapshot concreto. */
async function resolveSnapshot(flowId: string, rootAgentId: string, token: string): Promise<FlowSnapshot | null> {
  if (token === "draft") return resolveFlowGraph(rootAgentId);

  if (token === "current") {
    const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { currentVersionId: true } });
    if (!flow?.currentVersionId) return null;
    const row = await prisma.flowVersion.findUnique({ where: { id: flow.currentVersionId } });
    return row ? (JSON.parse(row.snapshot) as FlowSnapshot) : null;
  }

  const asNumber = Number(token);
  const row = Number.isInteger(asNumber)
    ? await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId, version: asNumber } } })
    : await prisma.flowVersion.findUnique({ where: { flowId_tag: { flowId, tag: token } } });
  return row ? (JSON.parse(row.snapshot) as FlowSnapshot) : null;
}

/** Topologia do fluxo para a visualização gráfica (RQ-VIS-01). Sem agregados de execução. */
export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const flow = await prisma.flow.findUnique({ where: { id } });
  if (!flow) return fail("Fluxo não encontrado", 404);

  const url = new URL(request.url);
  const version = url.searchParams.get("version") ?? "draft";

  const snapshot = await resolveSnapshot(id, flow.rootAgentId, version);
  if (!snapshot) return fail(`"version=${version}" não encontrado`, 404);

  return ok(snapshotToGraph(snapshot));
}
