import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/guard";
import { encrypt } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { computeConfigHash } from "@/lib/mcp";
import { serializeMcpServer } from "@/lib/serialize";

const createSchema = z
  .object({
    name: z.string().min(1),
    transport: z.enum(["stdio", "http"]).default("stdio"),
    command: z.string().nullish(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    url: z.string().nullish(),
    headers: z.record(z.string()).default({}),
    enabled: z.boolean().default(true),
  })
  .refine((v) => (v.transport === "stdio" ? Boolean(v.command) : Boolean(v.url)), {
    message: "stdio exige 'command'; http exige 'url'",
  });

export async function GET(request: Request) {
  const guard = await requireUser(request, "mcp.read");
  if (!guard.ok) return guard.response;

  const rows = await prisma.mcpServer.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  return ok(rows.map(serializeMcpServer));
}

export async function POST(request: Request) {
  const guard = await requireUser(request, "mcp.write");
  if (!guard.ok) return guard.response;

  const { data, error } = await parseBody(request, createSchema);
  if (error) return error;

  // Um editor pode declarar os NOMES das variáveis, mas não os valores — RQ-SEC-07.
  const hasValues = Object.values(data.env).some(Boolean) || Object.values(data.headers).some(Boolean);
  if (hasValues && guard.user.role !== "admin") {
    return fail(
      "Só administradores podem definir valores de env/headers. Declare os nomes e peça a um admin para preencher em PUT /api/mcp/:id/secrets.",
      403,
      "forbidden",
    );
  }

  try {
    const id = randomUUID();
    const envKeys = Object.keys(data.env);
    const headerKeys = Object.keys(data.headers);
    const row = await prisma.mcpServer.create({
      data: {
        id,
        name: data.name,
        transport: data.transport,
        command: data.command ?? null,
        args: JSON.stringify(data.args),
        envEnc: hasValues ? encrypt(JSON.stringify(data.env), `McpServer:${id}:env`) : null,
        envKeys: JSON.stringify(envKeys),
        url: data.url ?? null,
        headersEnc: hasValues
          ? encrypt(JSON.stringify(data.headers), `McpServer:${id}:headers`)
          : null,
        headerKeys: JSON.stringify(headerKeys),
        enabled: data.enabled,
        createdById: guard.user.id,
        updatedById: guard.user.id,
        configHash: computeConfigHash({
          transport: data.transport,
          command: data.command,
          args: data.args,
          url: data.url,
          envKeys,
          headerKeys,
        }),
      },
    });
    await audit({ actorId: guard.user.id, action: "mcp.created", targetType: "mcpServer", targetId: row.id });
    return ok(serializeMcpServer(row), 201);
  } catch (err) {
    return handleError(err);
  }
}
