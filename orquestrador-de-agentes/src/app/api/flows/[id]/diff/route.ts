import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { diffSnapshots } from "@/lib/flows/diff";
import { resolveFlowGraph, type FlowSnapshot } from "@/lib/flows/snapshot";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** Resolve "1" | "producao" | "draft" para um snapshot concreto. */
async function resolveToken(flowId: string, rootAgentId: string, token: string): Promise<FlowSnapshot | null> {
  if (token === "draft") return resolveFlowGraph(rootAgentId);

  const asNumber = Number(token);
  const row = Number.isInteger(asNumber)
    ? await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId, version: asNumber } } })
    : await prisma.flowVersion.findUnique({ where: { flowId_tag: { flowId, tag: token } } });
  return row ? (JSON.parse(row.snapshot) as FlowSnapshot) : null;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const flow = await prisma.flow.findUnique({ where: { id } });
  if (!flow) return fail("Fluxo não encontrado", 404);

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return fail("Informe from e to (número de versão, etiqueta ou \"draft\")", 400);

  const [fromSnapshot, toSnapshot] = await Promise.all([
    resolveToken(id, flow.rootAgentId, from),
    resolveToken(id, flow.rootAgentId, to),
  ]);
  if (!fromSnapshot) return fail(`"from=${from}" não encontrado`, 404);
  if (!toSnapshot) return fail(`"to=${to}" não encontrado`, 404);

  return ok({ from, to, entries: diffSnapshots(fromSnapshot, toSnapshot) });
}
