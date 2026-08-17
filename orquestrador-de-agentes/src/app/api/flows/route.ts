import { z } from "zod";
import { canBeRoot } from "@/lib/agents/roles";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { uniqueFlowSlug } from "@/lib/flows/slug";
import { fail, handleError, ok, parseBody } from "@/lib/http";

const createSchema = z.object({
  rootAgentId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().default(""),
});

export async function GET(request: Request) {
  const guard = await requireUser(request, "flow.read");
  if (!guard.ok) return guard.response;

  const rows = await prisma.flow.findMany({
    include: {
      currentVersion: { select: { id: true, version: true, tag: true, createdAt: true } },
      _count: { select: { versions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      rootAgentId: row.rootAgentId,
      status: row.status,
      currentVersion: row.currentVersion,
      versionCount: row._count.versions,
      createdAt: row.createdAt,
    })),
  );
}

export async function POST(request: Request) {
  const guard = await requireUser(request, "flow.write");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, createSchema);
  if (error) return error;

  const agent = await prisma.agent.findUnique({ where: { id: data.rootAgentId, deletedAt: null } });
  if (!agent) return fail("Agente não encontrado", 404);
  if (!canBeRoot(agent.role)) return fail("Só um agente orchestrator pode ser raiz de fluxo", 422);
  if (agent.flowId) return fail("Este agente já pertence a um fluxo", 409, "already_in_flow");

  try {
    const name = data.name || agent.name;
    const slug = await uniqueFlowSlug(name);
    const flow = await prisma.$transaction(async (tx) => {
      const created = await tx.flow.create({
        data: { name, slug, description: data.description, rootAgentId: agent.id, createdById: guard.user.id },
      });
      await tx.agent.update({ where: { id: agent.id }, data: { flowId: created.id } });
      return created;
    });

    await audit({ actorId: guard.user.id, action: "flow.created", targetType: "flow", targetId: flow.id });
    return ok({ ...flow, isDirty: true }, 201);
  } catch (err) {
    return handleError(err);
  }
}
