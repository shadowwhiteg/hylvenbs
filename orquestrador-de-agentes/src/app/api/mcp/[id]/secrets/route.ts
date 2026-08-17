import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { encrypt } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { computeConfigHash } from "@/lib/mcp";
import { serializeMcpServer } from "@/lib/serialize";

const schema = z.object({
  env: z.record(z.string()).default({}),
  headers: z.record(z.string()).default({}),
});

type Params = { params: Promise<{ id: string }> };

/**
 * Único caminho que grava VALORES de env/headers — reservado a admin (secret.write).
 * Um editor já pode ter declarado os nomes via POST/PATCH /api/mcp; aqui é onde eles
 * ganham valor. Ver RQ-SEC-07 e design 001 (D notas de fronteira).
 */
export async function PUT(request: Request, { params }: Params) {
  const guard = await requireUser(request, "secret.write");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const existing = await prisma.mcpServer.findUnique({ where: { id } });
  if (!existing) return fail("Servidor MCP não encontrado", 404);

  const { data, error } = await parseBody(request, schema);
  if (error) return error;

  const envKeys = Object.keys(data.env);
  const headerKeys = Object.keys(data.headers);

  try {
    const row = await prisma.mcpServer.update({
      where: { id },
      data: {
        envEnc: envKeys.length ? encrypt(JSON.stringify(data.env), `McpServer:${id}:env`) : null,
        envKeys: JSON.stringify(envKeys),
        headersEnc: headerKeys.length
          ? encrypt(JSON.stringify(data.headers), `McpServer:${id}:headers`)
          : null,
        headerKeys: JSON.stringify(headerKeys),
        updatedById: guard.user.id,
        configHash: computeConfigHash({
          transport: existing.transport,
          command: existing.command,
          args: JSON.parse(existing.args) as string[],
          url: existing.url,
          envKeys,
          headerKeys,
        }),
      },
    });
    await audit({ actorId: guard.user.id, action: "secret.updated", targetType: "mcpServer", targetId: id });
    return ok(serializeMcpServer(row));
  } catch (err) {
    return handleError(err);
  }
}
