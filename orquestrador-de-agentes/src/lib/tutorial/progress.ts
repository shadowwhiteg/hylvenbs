import { prisma } from "../db.ts";
import type { ProgressCheck } from "./types.ts";

/**
 * Resolve cada `ProgressCheck` por contagem no banco — "concluído" significa
 * "existe o registro", nunca "alguém marcou" (design 009, D3). Um provedor
 * excluído reabre o passo 1 automaticamente, sem estado extra para divergir.
 */
export async function resolveTutorialProgress(): Promise<Record<ProgressCheck, boolean>> {
  const [
    providerCount,
    mcpServerCount,
    subagentCount,
    intermediateAgentCount,
    orchestratorCount,
    publishedFlowCount,
    routingChainCount,
    successfulRunCount,
    tokenCount,
  ] = await Promise.all([
    prisma.provider.count({ where: { deletedAt: null } }),
    prisma.mcpServer.count({ where: { deletedAt: null, lastStatus: "ok" } }),
    prisma.agent.count({ where: { deletedAt: null, role: "subagent" } }),
    prisma.agent.count({ where: { deletedAt: null, role: "agent", children: { some: {} } } }),
    prisma.agent.count({ where: { deletedAt: null, role: "orchestrator", children: { some: {} } } }),
    prisma.flow.count({ where: { currentVersionId: { not: null } } }),
    prisma.modelCandidate.count({ where: { enabled: true } }),
    prisma.run.count({ where: { status: "succeeded" } }),
    prisma.apiToken.count({ where: { revokedAt: null } }),
  ]);

  return {
    has_provider: providerCount > 0,
    has_mcp_server: mcpServerCount > 0,
    has_subagent: subagentCount > 0,
    has_intermediate_agent: intermediateAgentCount > 0,
    has_orchestrator: orchestratorCount > 0,
    has_published_flow: publishedFlowCount > 0,
    has_routing_chain: routingChainCount > 0,
    has_successful_run: successfulRunCount > 0,
    has_token: tokenCount > 0,
  };
}
