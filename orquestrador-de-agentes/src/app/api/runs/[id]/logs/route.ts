import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

const LEVELS = new Set(["debug", "info", "warn", "error"]);

/** Log estruturado filtrado por nível, em ordem estável (RQ-OBS-04). */
export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "run.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const url = new URL(request.url);
  const level = url.searchParams.get("level");
  if (level && !LEVELS.has(level)) return fail("level deve ser debug, info, warn ou error", 422);

  const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0) || 0;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 1000);

  const logs = await prisma.logEntry.findMany({
    where: { runId: id, ...(level ? { level } : {}), seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
    take: limit,
  });
  return ok(logs);
}
