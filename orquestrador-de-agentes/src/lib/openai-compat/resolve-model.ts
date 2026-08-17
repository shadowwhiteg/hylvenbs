import { canBeRoot } from "../agents/roles.ts";
import { prisma } from "../db.ts";

export type ModelResolution = { agentId: string; flowVersion?: number | "current" };

/** Separa "<slug|id>@<versão|current>" em base + sufixo (D2). Sem "@", sufixo é undefined. */
export function splitModelParam(modelParam: string): { base: string; suffix: string | undefined } {
  const at = modelParam.lastIndexOf("@");
  if (at === -1) return { base: modelParam, suffix: undefined };
  return { base: modelParam.slice(0, at), suffix: modelParam.slice(at + 1) };
}

/** "current" | "<n>" -> flowVersion aceito por enqueueRun; sufixo inválido é ignorado (cai no rascunho). */
export function parseVersionSuffix(suffix: string | undefined): number | "current" | undefined {
  if (suffix === undefined) return undefined;
  if (suffix === "current") return "current";
  const n = Number(suffix);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Resolve o campo `model` do dialeto (D2/D3): slug do fluxo primeiro (legível,
 * estável), id do agente raiz como escape. O sufixo do model tem precedência sobre
 * `orq_flow_version` do corpo — é o caminho universal, funciona em qualquer cliente.
 */
export async function resolveModel(
  modelParam: string,
  bodyFlowVersion: number | "current" | undefined,
): Promise<ModelResolution | null> {
  const { base, suffix } = splitModelParam(modelParam);
  const flowVersion = suffix !== undefined ? parseVersionSuffix(suffix) : bodyFlowVersion;

  const flow = await prisma.flow.findUnique({ where: { slug: base }, select: { rootAgentId: true } });
  if (flow) return { agentId: flow.rootAgentId, flowVersion };

  const agent = await prisma.agent.findUnique({
    where: { id: base, deletedAt: null },
    select: { id: true, role: true },
  });
  if (agent && canBeRoot(agent.role)) return { agentId: agent.id, flowVersion };

  return null;
}

export type ModelListEntry = {
  id: string;
  agentId: string;
  flowId: string | null;
  name: string;
  publishedVersion: number | null;
};

/** Catálogo para GET /api/v1/models (RQ-OAI-03) — um item por orquestrador não excluído. */
export async function listModels(): Promise<ModelListEntry[]> {
  const orchestrators = await prisma.agent.findMany({
    where: { role: "orchestrator", deletedAt: null },
    select: {
      id: true,
      name: true,
      flow: { select: { id: true, slug: true, currentVersion: { select: { version: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  return orchestrators.map((a) => ({
    id: a.flow?.slug ?? a.id,
    agentId: a.id,
    flowId: a.flow?.id ?? null,
    name: a.name,
    publishedVersion: a.flow?.currentVersion?.version ?? null,
  }));
}
