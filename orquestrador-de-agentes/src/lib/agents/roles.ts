/** Vocabulário de papéis de agente (design 008) — fonte única de comparação com `role`. */

export const AGENT_ROLES = ["orchestrator", "agent", "subagent"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Recebe tools delegate_to_* e faz a travessia do grafo descer para os filhos. */
export function canDelegate(role: string): boolean {
  return role === "orchestrator" || role === "agent";
}

/** Pode ser raiz de um Flow versionável — dono único do snapshot (RQ-HIER-03). */
export function canBeRoot(role: string): boolean {
  return role === "orchestrator";
}

/** Pode ser filho de outro agente — o contrapositivo de canBeRoot (RQ-HIER-03). */
export function canBeChild(role: string): boolean {
  return role !== "orchestrator";
}

export const ROLE_LABEL: Record<AgentRole, string> = {
  orchestrator: "Orquestrador",
  agent: "Agente",
  subagent: "Subagente",
};

/** Substantivo do papel em minúsculo, para compor texto (ex.: descrição de tool de delegação). */
export function roleNoun(role: string): string {
  return role === "agent" ? "agente" : "subagente";
}
