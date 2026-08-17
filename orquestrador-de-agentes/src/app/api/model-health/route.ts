import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { ok } from "@/lib/http";

/**
 * Saúde observada por par (provedor, modelo) — RQ-ROT-08. É o que explica por que um
 * candidato de prioridade alta está sendo pulado no momento.
 */
export async function GET(request: Request) {
  const guard = await requireUser(request, "policy.read");
  if (!guard.ok) return guard.response;

  const [rows, providers] = await Promise.all([
    prisma.modelHealth.findMany({ orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.provider.findMany({ select: { id: true, name: true } }),
  ]);
  const providerById = new Map(providers.map((p) => [p.id, p.name]));
  const now = Date.now();

  return ok(
    rows.map((row) => ({
      providerId: row.providerId,
      providerName: providerById.get(row.providerId) ?? null,
      model: row.model,
      consecutiveFailures: row.consecutiveFailures,
      lastErrorType: row.lastErrorType,
      lastErrorMessage: row.lastErrorMessage,
      lastErrorAt: row.lastErrorAt,
      lastOkAt: row.lastOkAt,
      cooldownUntil: row.cooldownUntil,
      inCooldown: !!row.cooldownUntil && row.cooldownUntil.getTime() > now,
    })),
  );
}
