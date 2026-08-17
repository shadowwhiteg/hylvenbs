import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/http";
import { resolveTutorialProgress } from "@/lib/tutorial/progress";

/**
 * Progresso do tutorial derivado do estado real do banco (RQ-TUT-03). Existe por
 * paridade de contrato (T4 — tudo que a UI faz é possível por HTTP) e para o
 * atalho contextual client-side (RQ-TUT-06).
 */
export async function GET(request: Request) {
  const guard = await requireUser(request, "authenticated");
  if (!guard.ok) return guard.response;

  const checks = await resolveTutorialProgress();
  return ok({ checks });
}
