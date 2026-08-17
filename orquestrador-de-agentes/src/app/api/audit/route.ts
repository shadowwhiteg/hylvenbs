import { requireUser } from "@/lib/auth/guard";
import { parseJson, prisma } from "@/lib/db";
import { ok } from "@/lib/http";

export async function GET(request: Request) {
  const guard = await requireUser(request, "audit.read");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const actorId = url.searchParams.get("actorId") || undefined;
  const action = url.searchParams.get("action") || undefined;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

  const rows = await prisma.auditLog.findMany({
    where: { actorId, action },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return ok(
    rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
      ip: r.ip,
      createdAt: r.createdAt,
    })),
  );
}
