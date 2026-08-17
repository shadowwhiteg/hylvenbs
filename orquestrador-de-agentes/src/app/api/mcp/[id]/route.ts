import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { computeConfigHash } from "@/lib/mcp";
import { serializeMcpServer } from "@/lib/serialize";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  transport: z.enum(["stdio", "http"]).optional(),
  command: z.string().nullish(),
  args: z.array(z.string()).optional(),
  /** Só os nomes mudam aqui; valores são geridos por PUT /api/mcp/:id/secrets (admin). */
  envKeys: z.array(z.string()).optional(),
  url: z.string().nullish(),
  headerKeys: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireUser(request, "mcp.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await parseBody(request, updateSchema);
  if (error) return error;

  const existing = await prisma.mcpServer.findUnique({ where: { id, deletedAt: null } });
  if (!existing) return fail("Servidor MCP não encontrado", 404);

  const patch: Record<string, unknown> = { updatedById: guard.user.id };
  if (data.name !== undefined) patch.name = data.name;
  if (data.transport !== undefined) patch.transport = data.transport;
  if (data.command !== undefined) patch.command = data.command || null;
  if (data.args !== undefined) patch.args = JSON.stringify(data.args);
  if (data.url !== undefined) patch.url = data.url || null;
  if (data.enabled !== undefined) patch.enabled = data.enabled;

  // Renomear/remover uma chave sem admin preencher de novo perderia o valor cifrado
  // correspondente — então mudar a lista de nomes aqui também limpa os valores.
  let envKeys = JSON.parse(existing.envKeys) as string[];
  if (data.envKeys !== undefined) {
    envKeys = data.envKeys;
    patch.envKeys = JSON.stringify(envKeys);
    patch.envEnc = null;
  }

  let headerKeys = JSON.parse(existing.headerKeys) as string[];
  if (data.headerKeys !== undefined) {
    headerKeys = data.headerKeys;
    patch.headerKeys = JSON.stringify(headerKeys);
    patch.headersEnc = null;
  }

  patch.configHash = computeConfigHash({
    transport: (patch.transport as string) ?? existing.transport,
    command: (patch.command as string | null) ?? existing.command,
    args: data.args ?? (JSON.parse(existing.args) as string[]),
    url: (patch.url as string | null) ?? existing.url,
    envKeys,
    headerKeys,
  });

  try {
    const row = await prisma.mcpServer.update({ where: { id }, data: patch });
    await audit({ actorId: guard.user.id, action: "mcp.updated", targetType: "mcpServer", targetId: id });
    return ok(serializeMcpServer(row));
  } catch {
    return fail("Servidor MCP não encontrado", 404);
  }
}

/** Exclusão lógica (RQ-VER-11) — versões de fluxo que referenciam este servidor continuam íntegras. */
export async function DELETE(request: Request, { params }: Params) {
  const guard = await requireUser(request, "mcp.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    await prisma.mcpServer.update({ where: { id }, data: { deletedAt: new Date(), updatedById: guard.user.id } });
    await audit({ actorId: guard.user.id, action: "mcp.deleted", targetType: "mcpServer", targetId: id });
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
