import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { resolveFlowGraph, snapshotContentHash, validateSnapshot } from "@/lib/flows/snapshot";
import { fail, handleError, ok, parseBody } from "@/lib/http";

const publishSchema = z.object({
  message: z.string().default(""),
  tag: z.string().min(1).nullish(),
});

type Params = { params: Promise<{ id: string }> };

/**
 * Publicação transacional: resolve o grafo ao vivo, valida, canonicaliza, e recusa
 * com 409 se o hash não mudou desde a última versão (RQ-VER-02, RQ-VER-04).
 */
export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser(request, "flow.publish");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await parseBody(request, publishSchema);
  if (error) return error;

  const flow = await prisma.flow.findUnique({ where: { id }, include: { currentVersion: true } });
  if (!flow) return fail("Fluxo não encontrado", 404);

  const snapshot = await resolveFlowGraph(flow.rootAgentId);
  if (!snapshot) return fail("Agente raiz do fluxo não existe mais", 422);

  const validationErrors = validateSnapshot(snapshot);
  if (validationErrors.length > 0) {
    return fail(validationErrors.map((e) => e.message).join(" "), 422, "invalid_graph");
  }

  const contentHash = snapshotContentHash(snapshot);
  if (flow.currentVersion && flow.currentVersion.contentHash === contentHash) {
    return fail("O rascunho é idêntico à última versão publicada.", 409, "no_changes");
  }

  try {
    const version = await prisma.$transaction(async (tx) => {
      const last = await tx.flowVersion.findFirst({ where: { flowId: id }, orderBy: { version: "desc" } });
      const nextVersion = (last?.version ?? 0) + 1;

      if (data.tag) {
        // Etiqueta única por fluxo: mover a etiqueta significa limpá-la da versão anterior primeiro.
        await tx.flowVersion.updateMany({ where: { flowId: id, tag: data.tag }, data: { tag: null } });
      }

      const created = await tx.flowVersion.create({
        data: {
          flowId: id,
          version: nextVersion,
          snapshot: JSON.stringify(snapshot),
          contentHash,
          message: data.message,
          tag: data.tag ?? null,
          createdById: guard.user.id,
        },
      });
      await tx.flow.update({ where: { id }, data: { currentVersionId: created.id, status: "published" } });
      return created;
    });

    await audit({
      actorId: guard.user.id,
      action: "flow.published",
      targetType: "flow",
      targetId: id,
      metadata: { version: version.version, message: data.message, tag: data.tag ?? null },
    });
    return ok(
      { id: version.id, flowId: id, version: version.version, contentHash, message: version.message, tag: version.tag, createdAt: version.createdAt },
      201,
    );
  } catch (err) {
    // Corrida entre duas publicações simultâneas — @@unique([flowId, version]) protege; repete com o número seguinte.
    if (isUniqueConstraintError(err)) return fail("Publicação concorrente detectada — tente novamente.", 409, "publish_race");
    return handleError(err);
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
