import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { resolveFlowGraph, snapshotContentHash } from "@/lib/flows/snapshot";
import { fail, handleError, ok, parseBody } from "@/lib/http";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const flow = await prisma.flow.findUnique({
    where: { id },
    include: { currentVersion: { select: { id: true, version: true, tag: true, contentHash: true, createdAt: true } } },
  });
  if (!flow) return fail("Fluxo não encontrado", 404);

  const snapshot = await resolveFlowGraph(flow.rootAgentId);
  const draftHash = snapshot ? snapshotContentHash(snapshot) : null;
  const isDirty = draftHash !== null && draftHash !== (flow.currentVersion?.contentHash ?? null);

  return ok({
    id: flow.id,
    name: flow.name,
    slug: flow.slug,
    description: flow.description,
    rootAgentId: flow.rootAgentId,
    status: flow.status,
    currentVersion: flow.currentVersion,
    isDirty: flow.currentVersion ? isDirty : snapshot !== null,
    draft: snapshot,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await parseBody(request, updateSchema);
  if (error) return error;

  try {
    const row = await prisma.flow.update({ where: { id }, data });
    await audit({ actorId: guard.user.id, action: "flow.updated", targetType: "flow", targetId: id });
    return ok(row);
  } catch (err) {
    return handleError(err);
  }
}
