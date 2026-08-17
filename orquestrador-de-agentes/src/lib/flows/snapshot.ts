import { createHash } from "node:crypto";
import { canBeRoot, canDelegate } from "../agents/roles.ts";
import { parseJson, prisma } from "../db.ts";
import { computeConfigHash } from "../mcp.ts";
import { DEFAULT_TASK_TYPE, resolveChain, type CandidateRow } from "../routing/resolve.ts";

/**
 * Candidato de roteamento congelado no snapshot (RQ-ROT-10). A cadeia é resolvida na
 * publicação, então editar a política depois não altera o que a versão executa.
 * Provedor entra por id/kind/name — nunca segredo (RQ-VER-09).
 */
export type FlowSnapshotCandidate = {
  provider: { id: string; kind: string; name: string };
  model: string;
  maxTokens: number | null;
  temperature: number | null;
};

export type FlowSnapshotAgent = {
  id: string;
  name: string;
  description: string;
  role: string;
  systemPrompt: string;
  provider: { id: string; kind: string; name: string } | null;
  model: string;
  params: {
    temperature: number;
    maxTokens: number;
    topP: number;
    topK: number;
    stopSequences: string[];
    maxSteps: number;
  };
  enabled: boolean;
  mcpServerIds: string[];
  /** Tipo de tarefa padrão do agente, usado quando a run não pede outro (RQ-ROT-04). */
  taskType: string;
  /**
   * Cadeias resolvidas por tipo de tarefa, cada uma na ordem deliberada (RQ-ROT-10).
   * Guardamos **todas** as declaradas — não só a do tipo padrão — para que uma run
   * pedindo outro tipo continue funcionando contra uma versão já publicada.
   * A chave "default" existe sempre.
   */
  chains: Record<string, FlowSnapshotCandidate[]>;
};

export type FlowSnapshotEdge = { from: string; to: string; kind: "delegate" };

export type FlowSnapshotMcpServer = {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  /// Nomes das variáveis, nunca os valores — RQ-VER-09.
  envKeys: string[];
  headerKeys: string[];
  configHash: string;
};

export type FlowSnapshot = {
  schemaVersion: 1;
  rootAgentId: string;
  agents: FlowSnapshotAgent[];
  edges: FlowSnapshotEdge[];
  mcpServers: FlowSnapshotMcpServer[];
};

/**
 * Resolve o grafo ao vivo a partir de `rootAgentId` por travessia em largura sobre
 * `AgentLink`, ignorando agentes/servidores excluídos logicamente (RQ-VER-11). Ciclos
 * são cortados — um agente aparece uma vez; a aresta repetida é preservada em `edges`.
 */
export async function resolveFlowGraph(rootAgentId: string): Promise<FlowSnapshot | null> {
  const visited = new Map<
    string,
    Awaited<ReturnType<typeof fetchAgent>> extends infer T ? NonNullable<T> : never
  >();
  const edges: FlowSnapshotEdge[] = [];
  const mcpServerIds = new Set<string>();
  const queue = [rootAgentId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    const row = await fetchAgent(id);
    if (!row) {
      if (id === rootAgentId) return null;
      continue;
    }
    visited.set(id, row);

    for (const binding of row.mcpServers) {
      if (binding.mcpServer.deletedAt) continue;
      mcpServerIds.add(binding.mcpServer.id);
    }

    if (canDelegate(row.role)) {
      for (const link of row.children) {
        if (link.child.deletedAt) continue;
        edges.push({ from: id, to: link.childId, kind: "delegate" });
        if (!visited.has(link.childId)) queue.push(link.childId);
      }
    }
  }

  const mcpRows = mcpServerIds.size
    ? await prisma.mcpServer.findMany({ where: { id: { in: [...mcpServerIds] } } })
    : [];

  // Provedores citados pelos candidatos de roteamento — precisam de kind/name no snapshot.
  const candidateProviderIds = new Set<string>();
  for (const row of visited.values()) {
    for (const c of row.candidates) candidateProviderIds.add(c.providerId);
    for (const c of row.modelPolicy?.candidates ?? []) candidateProviderIds.add(c.providerId);
  }
  const candidateProviders = candidateProviderIds.size
    ? await prisma.provider.findMany({
        where: { id: { in: [...candidateProviderIds] } },
        select: { id: true, kind: true, name: true, deletedAt: true },
      })
    : [];
  const providerById = new Map(candidateProviders.map((p) => [p.id, p]));

  const agents: FlowSnapshotAgent[] = [...visited.values()].map((row) => {
    const chainInput = {
      agentCandidates: row.candidates as CandidateRow[],
      policyCandidates: (row.modelPolicy?.candidates ?? []) as CandidateRow[],
      fallbackProviderId: row.providerId,
      fallbackModel: row.model,
    };

    const toSnapshotCandidates = (chain: ReturnType<typeof resolveChain>): FlowSnapshotCandidate[] =>
      chain.flatMap((c) => {
        // Provedor do candidato pode ser o próprio do agente (fallback) ou um citado
        // pela cadeia; excluído logicamente, o candidato sai do snapshot (RQ-VER-11).
        const provider = providerById.get(c.providerId) ?? (row.provider?.id === c.providerId ? row.provider : null);
        if (!provider || provider.deletedAt) return [];
        return [
          {
            provider: { id: provider.id, kind: provider.kind, name: provider.name },
            model: c.model,
            maxTokens: c.maxTokens,
            temperature: c.temperature,
          },
        ];
      });

    const declaredTypes = new Set<string>([
      DEFAULT_TASK_TYPE,
      row.taskType,
      ...chainInput.agentCandidates.map((c) => c.taskType),
      ...chainInput.policyCandidates.map((c) => c.taskType),
    ]);
    const chains: Record<string, FlowSnapshotCandidate[]> = {};
    for (const taskType of [...declaredTypes].sort()) {
      chains[taskType] = toSnapshotCandidates(resolveChain(chainInput, taskType));
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      role: row.role,
      systemPrompt: row.systemPrompt,
      provider: row.provider ? { id: row.provider.id, kind: row.provider.kind, name: row.provider.name } : null,
      model: row.model,
      params: {
        temperature: row.temperature,
        maxTokens: row.maxTokens,
        topP: row.topP,
        topK: row.topK,
        stopSequences: parseJson<string[]>(row.stopSequences, []),
        maxSteps: row.maxSteps,
      },
      enabled: row.enabled,
      mcpServerIds: row.mcpServers.filter((b) => !b.mcpServer.deletedAt).map((b) => b.mcpServer.id),
      taskType: row.taskType,
      chains,
    };
  });

  const mcpServers: FlowSnapshotMcpServer[] = mcpRows.map((row) => {
    const envKeys = parseJson<string[]>(row.envKeys, []);
    const headerKeys = parseJson<string[]>(row.headerKeys, []);
    const args = parseJson<string[]>(row.args, []);
    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      command: row.command,
      args,
      url: row.url,
      envKeys,
      headerKeys,
      configHash: computeConfigHash({ transport: row.transport, command: row.command, args, url: row.url, envKeys, headerKeys }),
    };
  });

  return { schemaVersion: 1, rootAgentId, agents, edges, mcpServers };
}

function fetchAgent(id: string) {
  return prisma.agent.findUnique({
    where: { id, deletedAt: null },
    include: {
      provider: true,
      mcpServers: { include: { mcpServer: true } },
      children: { include: { child: true } },
      candidates: true,
      modelPolicy: { include: { candidates: true } },
    },
  });
}

/** Serialização canônica (chaves ordenadas, arrays de ids ordenados) — base do content hash. */
export function canonicalizeSnapshot(snapshot: FlowSnapshot): string {
  const canonical = {
    schemaVersion: snapshot.schemaVersion,
    rootAgentId: snapshot.rootAgentId,
    agents: [...snapshot.agents]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        role: a.role,
        systemPrompt: a.systemPrompt,
        provider: a.provider,
        model: a.model,
        params: a.params,
        enabled: a.enabled,
        mcpServerIds: [...a.mcpServerIds].sort(),
        taskType: a.taskType,
        // Chaves ordenadas; a ordem *dentro* de cada cadeia é significativa (é a
        // preferência declarada), então não é ordenada.
        chains: Object.fromEntries(Object.entries(a.chains ?? {}).sort(([x], [y]) => x.localeCompare(y))),
      })),
    edges: [...snapshot.edges].sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from))),
    mcpServers: [...snapshot.mcpServers].sort((a, b) => a.id.localeCompare(b.id)),
  };
  return JSON.stringify(canonical);
}

export function snapshotContentHash(snapshot: FlowSnapshot): string {
  return `sha256:${createHash("sha256").update(canonicalizeSnapshot(snapshot)).digest("hex")}`;
}

/**
 * Cadeia efetiva de um agente do snapshot para um tipo de tarefa: a do tipo pedido,
 * senão a de "default" (RQ-ROT-04). Snapshots anteriores à fase 7 não têm `chains` —
 * nesse caso a cadeia é o provedor/modelo único, preservando execuções antigas.
 */
export function chainFor(agent: FlowSnapshotAgent, taskType: string | null | undefined): FlowSnapshotCandidate[] {
  const wanted = taskType?.trim() || agent.taskType || DEFAULT_TASK_TYPE;
  const chains = agent.chains;
  if (!chains) {
    return agent.provider ? [{ provider: agent.provider, model: agent.model, maxTokens: null, temperature: null }] : [];
  }
  return chains[wanted] ?? chains[agent.taskType] ?? chains[DEFAULT_TASK_TYPE] ?? [];
}

export type SnapshotValidationError = { agentId: string; message: string };

/** Regras mínimas para uma publicação (design 002): raiz é orchestrator; todo agente tem provedor/modelo. */
export function validateSnapshot(snapshot: FlowSnapshot): SnapshotValidationError[] {
  const errors: SnapshotValidationError[] = [];
  const root = snapshot.agents.find((a) => a.id === snapshot.rootAgentId);
  if (!root) {
    errors.push({ agentId: snapshot.rootAgentId, message: "Agente raiz não encontrado." });
    return errors;
  }
  if (!canBeRoot(root.role)) {
    errors.push({ agentId: root.id, message: "O agente raiz precisa ter role \"orchestrator\"." });
  }
  for (const agent of snapshot.agents) {
    if (!agent.provider) errors.push({ agentId: agent.id, message: `Agente "${agent.name}" sem provedor configurado.` });
    if (!agent.model) errors.push({ agentId: agent.id, message: `Agente "${agent.name}" sem modelo selecionado.` });
  }
  // Nenhuma aresta pode apontar para um agente que pode ser raiz — um orquestrador
  // nunca é filho, senão pertenceria a dois fluxos versionados ao mesmo tempo (RQ-HIER-03).
  const byId = new Map(snapshot.agents.map((a) => [a.id, a]));
  for (const edge of snapshot.edges) {
    const target = byId.get(edge.to);
    if (target && canBeRoot(target.role)) {
      errors.push({ agentId: target.id, message: `Agente "${target.name}" não pode ser filho de outro agente.` });
    }
  }
  return errors;
}
