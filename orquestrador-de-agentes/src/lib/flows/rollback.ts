import { prisma } from "../db.ts";
import { resolveFlowGraph, type FlowSnapshot } from "./snapshot.ts";

/**
 * Reaplica o snapshot alvo sobre as linhas ao vivo (RQ-VER-08): agentes ausentes do
 * snapshot são recriados com o mesmo id (estavam soft-deleted), agentes ao vivo
 * ausentes do snapshot são soft-deleted, e parâmetros/vínculos/arestas são sobrescritos.
 * Não publica — quem chama decide se/como publica a versão resultante.
 */
export async function applyFlowSnapshot(flowId: string, rootAgentId: string, target: FlowSnapshot, actorId: string | null): Promise<void> {
  const liveSnapshot = await resolveFlowGraph(rootAgentId);
  const liveAgentIds = new Set(liveSnapshot ? liveSnapshot.agents.map((a) => a.id) : []);
  const targetAgentIds = new Set(target.agents.map((a) => a.id));

  await prisma.$transaction(async (tx) => {
    for (const agent of target.agents) {
      const data = {
        name: agent.name,
        description: agent.description,
        role: agent.role,
        systemPrompt: agent.systemPrompt,
        providerId: agent.provider?.id ?? null,
        model: agent.model,
        temperature: agent.params.temperature,
        maxTokens: agent.params.maxTokens,
        topP: agent.params.topP,
        topK: agent.params.topK,
        stopSequences: JSON.stringify(agent.params.stopSequences),
        maxSteps: agent.params.maxSteps,
        enabled: agent.enabled,
        deletedAt: null,
        flowId,
        updatedById: actorId,
      };
      await tx.agent.upsert({
        where: { id: agent.id },
        update: data,
        create: { id: agent.id, ...data, createdById: actorId },
      });
    }

    for (const agent of target.agents) {
      await tx.agentMcpServer.deleteMany({ where: { agentId: agent.id } });
      if (agent.mcpServerIds.length > 0) {
        await tx.agentMcpServer.createMany({
          data: agent.mcpServerIds.map((mcpServerId) => ({ agentId: agent.id, mcpServerId })),
        });
      }

      const childIds = target.edges.filter((e) => e.from === agent.id).map((e) => e.to);
      await tx.agentLink.deleteMany({ where: { parentId: agent.id } });
      if (childIds.length > 0) {
        await tx.agentLink.createMany({ data: childIds.map((childId) => ({ parentId: agent.id, childId })) });
      }
    }

    const removedIds = [...liveAgentIds].filter((id) => !targetAgentIds.has(id));
    if (removedIds.length > 0) {
      await tx.agent.updateMany({ where: { id: { in: removedIds } }, data: { deletedAt: new Date() } });
    }
  });
}
