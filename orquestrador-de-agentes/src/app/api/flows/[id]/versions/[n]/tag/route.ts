import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";

const tagSchema = z.object({ tag: z.string().min(1) });

type Params = { params: Promise<{ id: string; n: string }> };

/** Etiqueta única por fluxo (RQ-VER-12) — reutilizar move a etiqueta para a versão nova. */
export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.publish");
  if (!guard.ok) return guard.response;

  const { id, n } = await params;
  const version = Number(n);
  if (!Number.isInteger(version)) return fail("Versão inválida", 400);

  const { data, error } = await parseBody(request, tagSchema);
  if (error) return error;

  const target = await prisma.flowVersion.findUnique({ where: { flowId_version: { flowId: id, version } } });
  if (!target) return fail("Versão não encontrada", 404);

  try {
    await prisma.$transaction([
      prisma.flowVersion.updateMany({ where: { flowId: id, tag: data.tag }, data: { tag: null } }),
      prisma.flowVersion.update({ where: { id: target.id }, data: { tag: data.tag } }),
    ]);
    await audit({
      actorId: guard.user.id,
      action: "flow.tagged",
      targetType: "flow",
      targetId: id,
      metadata: { version, tag: data.tag },
    });
    return ok({ flowId: id, version, tag: data.tag });
  } catch (err) {
    return handleError(err);
  }
}
