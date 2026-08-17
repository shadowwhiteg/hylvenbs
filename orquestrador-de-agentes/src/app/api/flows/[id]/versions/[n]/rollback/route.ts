import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { applyFlowSnapshot } from "@/lib/flows/rollback";
import { resolveFlowGraph, snapshotContentHash, type FlowSnapshot } from "@/lib/flows/snapshot";
import { fail, handleError, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string; n: string }> };

/** Rollback publica versão nova — histórico append-only, nada é apagado (RQ-VER-08). */
export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.rollback");
  if (!guard.ok) return guard.response;

  const { id, n } = await params;
  const version = Number(n);
  if (!Number.isInteger(version)) return fail("Versão inválida", 400);

  const flow = await prisma.flow.findUnique({ where: { id } });
  if (!flow) return fail("Fluxo não encontrado", 404);

  const target = await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId: id, version } } });
  if (!target) return fail("Versão não encontrada", 404);

  try {
    const targetSnapshot = JSON.parse(target.snapshot) as FlowSnapshot;
    await applyFlowSnapshot(id, flow.rootAgentId, targetSnapshot, guard.user.id);

    const liveSnapshot = await resolveFlowGraph(flow.rootAgentId);
    if (!liveSnapshot) return fail("Falha ao reconstruir o grafo após o rollback", 500);
    const contentHash = snapshotContentHash(liveSnapshot);

    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.flowVersion.findFirst({ where: { flowId: id }, orderBy: { version: "desc" } });
      const nextVersion = (last?.version ?? 0) + 1;
      const newVersion = await tx.flowVersion.create({
        data: {
          flowId: id,
          version: nextVersion,
          snapshot: JSON.stringify(liveSnapshot),
          contentHash,
          message: `rollback para v${version}`,
          createdById: guard.user.id,
        },
      });
      await tx.flow.update({ where: { id }, data: { currentVersionId: newVersion.id, status: "published" } });
      return newVersion;
    });

    await audit({
      actorId: guard.user.id,
      action: "flow.rolledback",
      targetType: "flow",
      targetId: id,
      metadata: { fromVersion: version, toVersion: created.version },
    });
    return ok({ id: created.id, flowId: id, version: created.version, message: created.message, createdAt: created.createdAt }, 201);
  } catch (err) {
    return handleError(err);
  }
}
