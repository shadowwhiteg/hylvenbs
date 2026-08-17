import { prisma } from "./db.ts";

/** Grava um evento sensível. Nunca inclua segredo em `metadata` (RQ-SEC-09). */
export async function audit(entry: {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: JSON.stringify(entry.metadata ?? {}),
      ip: entry.ip ?? null,
    },
  });
}

export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
