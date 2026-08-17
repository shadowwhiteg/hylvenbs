import { requireUser } from "@/lib/auth/guard";
import { parseJson, prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { probeServer } from "@/lib/mcp";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser(request, "mcp.probe");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = await prisma.mcpServer.findUnique({ where: { id } });
  if (!row) return fail("Servidor MCP não encontrado", 404);

  try {
    const tools = await probeServer({
      id: row.id,
      name: row.name,
      transport: row.transport === "http" ? "http" : "stdio",
      command: row.command,
      args: parseJson<string[]>(row.args, []),
      envEnc: row.envEnc,
      url: row.url,
      headersEnc: row.headersEnc,
    });

    await prisma.mcpServer.update({
      where: { id },
      data: {
        toolsCache: JSON.stringify(tools),
        lastStatus: "ok",
        lastError: null,
        lastCheckedAt: new Date(),
      },
    });
    return ok({ status: "ok", tools });
  } catch (err) {
    const message = (err as Error).message;
    await prisma.mcpServer.update({
      where: { id },
      data: { lastStatus: "error", lastError: message, lastCheckedAt: new Date() },
    });
    return ok({ status: "error", error: message, tools: [] });
  }
}
