import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { encrypt } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { serializeProvider } from "@/lib/serialize";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  kind: z.enum(["anthropic", "openai", "openai-compatible"]).optional(),
  baseUrl: z.string().nullish(),
  /** String vazia mantém a chave atual; use null para apagar. */
  apiKey: z.string().nullish(),
  models: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser(request, "secret.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await parseBody(request, updateSchema);
  if (error) return error;

  const patch: Record<string, unknown> = { updatedById: guard.user.id };
  if (data.name !== undefined) patch.name = data.name;
  if (data.kind !== undefined) patch.kind = data.kind;
  if (data.baseUrl !== undefined) patch.baseUrl = data.baseUrl || null;
  if (data.apiKey) patch.apiKeyEnc = encrypt(data.apiKey, `Provider:${id}:apiKey`);
  else if (data.apiKey === null) patch.apiKeyEnc = null;
  // string vazia (data.apiKey === "") mantém a chave atual — nenhum campo entra no patch
  if (data.models !== undefined) patch.models = JSON.stringify(data.models);
  if (data.enabled !== undefined) patch.enabled = data.enabled;

  const existing = await prisma.provider.findUnique({ where: { id, deletedAt: null } });
  if (!existing) return fail("Provedor não encontrado", 404);

  try {
    const row = await prisma.provider.update({ where: { id }, data: patch });
    await audit({ actorId: guard.user.id, action: "provider.updated", targetType: "provider", targetId: id });
    return ok(serializeProvider(row));
  } catch {
    return fail("Provedor não encontrado", 404);
  }
}

/** Exclusão lógica (RQ-VER-11) — versões de fluxo que referenciam este provedor continuam íntegras. */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await requireUser(request, "secret.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.provider.update({ where: { id }, data: { deletedAt: new Date(), updatedById: guard.user.id } });
    await audit({ actorId: guard.user.id, action: "provider.deleted", targetType: "provider", targetId: id });
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
