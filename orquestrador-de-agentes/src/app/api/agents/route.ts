import { z } from "zod";
import { AGENT_ROLES, canBeChild, canBeRoot } from "@/lib/agents/roles";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { uniqueFlowSlug } from "@/lib/flows/slug";
import { AGENT_INCLUDE } from "@/lib/queries";
import { assertProvidersExist, candidateCreateData, candidateInputSchema } from "@/lib/routing/policies";
import { DEFAULT_TASK_TYPE } from "@/lib/routing/resolve";
import { serializeAgent } from "@/lib/serialize";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  role: z.enum(AGENT_ROLES).default("subagent"),
  systemPrompt: z.string().default(""),
  providerId: z.string().nullish(),
  model: z.string().default(""),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(200000).default(2048),
  topP: z.number().min(0).max(1).default(1),
  topK: z.number().int().min(0).max(500).default(0),
  stopSequences: z.array(z.string()).default([]),
  maxSteps: z.number().int().min(1).max(50).default(12),
  childIds: z.array(z.string()).default([]),
  mcpServerIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  /** Roteamento de modelos (design 007). */
  modelPolicyId: z.string().nullish(),
  taskType: z.string().min(1).default(DEFAULT_TASK_TYPE),
  candidates: z.array(candidateInputSchema).default([]),
});

export async function GET(request: Request) {
  const guard = await requireUser(request, "agent.read");
  if (!guard.ok) return guard.response;

  const rows = await prisma.agent.findMany({
    where: { deletedAt: null },
    include: AGENT_INCLUDE,
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return ok(rows.map(serializeAgent));
}

export async function POST(request: Request) {
  const guard = await requireUser(request, "agent.write");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, createSchema);
  if (error) return error;

  if (!(await assertProvidersExist(data.candidates))) return fail("Algum provedor informado não existe", 422);

  if (data.childIds.length > 0) {
    const children = await prisma.agent.findMany({ where: { id: { in: data.childIds } }, select: { id: true, role: true } });
    if (children.some((c) => !canBeChild(c.role))) {
      return fail("Um agente com role \"orchestrator\" não pode ser filho de outro agente.", 422, "invalid_child_role");
    }
  }

  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          name: data.name,
          description: data.description,
          role: data.role,
          systemPrompt: data.systemPrompt,
          providerId: data.providerId || null,
          model: data.model,
          temperature: data.temperature,
          maxTokens: data.maxTokens,
          topP: data.topP,
          topK: data.topK,
          stopSequences: JSON.stringify(data.stopSequences),
          maxSteps: data.maxSteps,
          enabled: data.enabled,
          modelPolicyId: data.modelPolicyId || null,
          taskType: data.taskType,
          candidates: { create: candidateCreateData(data.candidates) },
          children: { create: data.childIds.map((childId) => ({ childId })) },
          mcpServers: { create: data.mcpServerIds.map((mcpServerId) => ({ mcpServerId })) },
          createdById: guard.user.id,
          updatedById: guard.user.id,
        },
      });

      // Todo orquestrador é raiz de um fluxo (RQ-VER-01) — criado junto, sem passo manual.
      // Um "agent" intermediário também delega, mas não é raiz — não cria Flow (RQ-HIER-01).
      if (canBeRoot(created.role)) {
        const slug = await uniqueFlowSlug(created.name);
        const flow = await tx.flow.create({
          data: { name: created.name, slug, rootAgentId: created.id, createdById: guard.user.id },
        });
        await tx.agent.update({ where: { id: created.id }, data: { flowId: flow.id } });
      }

      return tx.agent.findUniqueOrThrow({ where: { id: created.id }, include: AGENT_INCLUDE });
    });
    await audit({ actorId: guard.user.id, action: "agent.created", targetType: "agent", targetId: row.id });
    return ok(serializeAgent(row), 201);
  } catch (err) {
    return handleError(err);
  }
}
