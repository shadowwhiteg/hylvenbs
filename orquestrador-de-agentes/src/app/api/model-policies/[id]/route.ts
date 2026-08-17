import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import {
  assertProvidersExist,
  candidateCreateData,
  candidateInputSchema,
  serializePolicy,
} from "@/lib/routing/policies";

type Params = { params: Promise<{ id: string }> };

const include = {
  candidates: { include: { provider: { select: { id: true, name: true, kind: true } } } },
  _count: { select: { agents: true } },
} as const;

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  /** Substitui a lista inteira quando presente — a ordem enviada é a preferência. */
  candidates: z.array(candidateInputSchema).optional(),
});

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "policy.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = await prisma.modelPolicy.findUnique({ where: { id, deletedAt: null }, include });
  if (!row) return fail("Política não encontrada", 404);
  return ok(serializePolicy(row));
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser(request, "policy.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const existing = await prisma.modelPolicy.findUnique({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) return fail("Política não encontrada", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return error;

  if (data.candidates && !(await assertProvidersExist(data.candidates))) {
    return fail("Algum provedor informado não existe", 422);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.modelPolicy.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          updatedById: guard.user.id,
        },
      });

      if (data.candidates) {
        await tx.modelCandidate.deleteMany({ where: { policyId: id } });
        if (data.candidates.length) {
          await tx.modelCandidate.createMany({
            data: candidateCreateData(data.candidates).map((c) => ({ ...c, policyId: id })),
          });
        }
      }

      return tx.modelPolicy.findUniqueOrThrow({ where: { id }, include });
    });

    await audit({ actorId: guard.user.id, action: "policy.updated", targetType: "modelPolicy", targetId: id });
    return ok(serializePolicy(updated));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await requireUser(request, "policy.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const existing = await prisma.modelPolicy.findUnique({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) return fail("Política não encontrada", 404);

  // Exclusão lógica: versões publicadas congelaram a cadeia resolvida (RQ-ROT-10),
  // então continuam íntegras; agentes vivos apenas perdem a referência.
  await prisma.$transaction(async (tx) => {
    await tx.modelPolicy.update({ where: { id }, data: { deletedAt: new Date(), updatedById: guard.user.id } });
    await tx.agent.updateMany({ where: { modelPolicyId: id }, data: { modelPolicyId: null } });
  });

  await audit({ actorId: guard.user.id, action: "policy.deleted", targetType: "modelPolicy", targetId: id });
  return ok({ id });
}
