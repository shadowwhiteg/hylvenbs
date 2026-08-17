import { z } from "zod";
import { AGENT_ROLES, canBeChild } from "@/lib/agents/roles";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { AGENT_INCLUDE } from "@/lib/queries";
import { assertProvidersExist, candidateCreateData, candidateInputSchema } from "@/lib/routing/policies";
import { serializeAgent } from "@/lib/serialize";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  role: z.enum(AGENT_ROLES).optional(),
  systemPrompt: z.string().optional(),
  providerId: z.string().nullish(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(0).max(500).optional(),
  stopSequences: z.array(z.string()).optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
  childIds: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  /** Roteamento de modelos (design 007). `candidates` substitui a lista inteira. */
  modelPolicyId: z.string().nullish(),
  taskType: z.string().min(1).optional(),
  candidates: z.array(candidateInputSchema).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "agent.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = await prisma.agent.findUnique({ where: { id, deletedAt: null }, include: AGENT_INCLUDE });
  if (!row) return fail("Agente não encontrado", 404);
  return ok(serializeAgent(row));
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser(request, "agent.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await parseBody(request, updateSchema);
  if (error) return error;

  const patch: Record<string, unknown> = { updatedById: guard.user.id };
  for (const key of ["name", "description", "role", "systemPrompt", "model", "temperature", "maxTokens", "topP", "topK", "maxSteps", "enabled", "taskType"] as const) {
    if (data[key] !== undefined) patch[key] = data[key];
  }
  if (data.providerId !== undefined) patch.providerId = data.providerId || null;
  if (data.modelPolicyId !== undefined) patch.modelPolicyId = data.modelPolicyId || null;
  if (data.stopSequences !== undefined) patch.stopSequences = JSON.stringify(data.stopSequences);
  if (data.candidates) {
    patch.candidates = { deleteMany: {}, create: candidateCreateData(data.candidates) };
  }

  // Um agente não pode delegar para si mesmo.
  const childIds = data.childIds?.filter((childId) => childId !== id);
  if (childIds) {
    patch.children = { deleteMany: {}, create: childIds.map((childId) => ({ childId })) };
  }
  if (data.mcpServerIds) {
    patch.mcpServers = {
      deleteMany: {},
      create: data.mcpServerIds.map((mcpServerId) => ({ mcpServerId })),
    };
  }

  const existing = await prisma.agent.findUnique({ where: { id, deletedAt: null } });
  if (!existing) return fail("Agente não encontrado", 404);

  if (data.candidates && !(await assertProvidersExist(data.candidates))) {
    return fail("Algum provedor informado não existe", 422);
  }

  if (childIds && childIds.length > 0) {
    const children = await prisma.agent.findMany({ where: { id: { in: childIds } }, select: { id: true, role: true } });
    if (children.some((c) => !canBeChild(c.role))) {
      return fail("Um agente com role \"orchestrator\" não pode ser filho de outro agente.", 422, "invalid_child_role");
    }
  }

  try {
    const row = await prisma.agent.update({ where: { id }, data: patch, include: AGENT_INCLUDE });
    await audit({ actorId: guard.user.id, action: "agent.updated", targetType: "agent", targetId: id });
    return ok(serializeAgent(row));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Exclusão lógica (RQ-VER-11): versões de fluxo publicadas que referenciam este
 * agente continuam consultáveis e executáveis. `enabled: false` já tira o agente de
 * novos snapshots publicados a partir daqui.
 */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await requireUser(request, "agent.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.agent.update({ where: { id }, data: { deletedAt: new Date(), updatedById: guard.user.id } });
    await audit({ actorId: guard.user.id, action: "agent.deleted", targetType: "agent", targetId: id });
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
