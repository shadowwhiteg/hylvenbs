import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { listModels, SUGGESTED_MODELS } from "@/lib/providers";
import type { ProviderKind } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request, "provider.read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = await prisma.provider.findUnique({ where: { id } });
  if (!row) return fail("Provedor não encontrado", 404);

  const kind = row.kind as ProviderKind;
  try {
    const models = await listModels({ id: row.id, kind, baseUrl: row.baseUrl, apiKeyEnc: row.apiKeyEnc });
    await prisma.provider.update({ where: { id }, data: { models: JSON.stringify(models) } });
    return ok({ models, source: "provider" });
  } catch (err) {
    // Sem chave ou provedor offline: devolve sugestões para não travar a UI.
    return ok({
      models: SUGGESTED_MODELS[kind] ?? [],
      source: "fallback",
      warning: (err as Error).message,
    });
  }
}
