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
  uniquePolicySlug,
} from "@/lib/routing/policies";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  enabled: z.boolean().default(true),
  candidates: z.array(candidateInputSchema).default([]),
});

export async function GET(request: Request) {
  const guard = await requireUser(request, "policy.read");
  if (!guard.ok) return guard.response;

  const rows = await prisma.modelPolicy.findMany({
    where: { deletedAt: null },
    include: {
      candidates: { include: { provider: { select: { id: true, name: true, kind: true } } } },
      _count: { select: { agents: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return ok(rows.map(serializePolicy));
}

export async function POST(request: Request) {
  const guard = await requireUser(request, "policy.write");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, createSchema);
  if (error) return error;

  if (!(await assertProvidersExist(data.candidates))) return fail("Algum provedor informado não existe", 422);

  try {
    const slug = await uniquePolicySlug(data.name);
    const policy = await prisma.modelPolicy.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        enabled: data.enabled,
        createdById: guard.user.id,
        candidates: { create: candidateCreateData(data.candidates) },
      },
      include: {
        candidates: { include: { provider: { select: { id: true, name: true, kind: true } } } },
        _count: { select: { agents: true } },
      },
    });

    await audit({ actorId: guard.user.id, action: "policy.created", targetType: "modelPolicy", targetId: policy.id });
    return ok(serializePolicy(policy), 201);
  } catch (err) {
    return handleError(err);
  }
}
