import { parseJson, prisma } from "../db.ts";
import { computeConfigHash } from "../mcp.ts";
import type { FlowSnapshot } from "./snapshot.ts";

export type DriftResult = { configDrift: boolean; driftDetail: string | null };

/**
 * Recalcula o `configHash` ao vivo de cada servidor MCP do snapshot fixado e compara
 * com o gravado. Divergência não bloqueia a execução — só sinaliza (RQ-VER-10).
 */
export async function computeDrift(snapshot: FlowSnapshot): Promise<DriftResult> {
  const details: string[] = [];
  const ids = snapshot.mcpServers.map((m) => m.id);
  const liveRows = ids.length ? await prisma.mcpServer.findMany({ where: { id: { in: ids } } }) : [];
  const liveById = new Map(liveRows.map((r) => [r.id, r]));

  for (const mcp of snapshot.mcpServers) {
    const live = liveById.get(mcp.id);
    if (!live || live.deletedAt) {
      details.push(`${mcp.name}: servidor MCP removido desde a publicação`);
      continue;
    }
    const liveHash = computeConfigHash({
      transport: live.transport,
      command: live.command,
      args: parseJson<string[]>(live.args, []),
      url: live.url,
      envKeys: parseJson<string[]>(live.envKeys, []),
      headerKeys: parseJson<string[]>(live.headerKeys, []),
    });
    if (liveHash !== mcp.configHash) {
      details.push(`${mcp.name}: configuração mudou desde a publicação`);
    }
  }

  return details.length > 0 ? { configDrift: true, driftDetail: details.join("; ") } : { configDrift: false, driftDetail: null };
}
