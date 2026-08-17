import type { ApiEndpoint, Permission } from "../api-registry.ts";

/**
 * Identificador fechado de progresso (design 009, D3): união de literais, não
 * função — conteúdo é dado, e dado não executa consulta. Cada valor tem exatamente
 * um resolvedor em `progress.ts` (RQ-TUT-03), garantido pelo teste de anti-deriva.
 */
export type ProgressCheck =
  | "has_provider"
  | "has_mcp_server"
  | "has_subagent"
  | "has_intermediate_agent"
  | "has_orchestrator"
  | "has_published_flow"
  | "has_routing_chain"
  | "has_successful_run"
  | "has_token";

export type TutorialStep = {
  /** Estável — usado em âncora e deep link (RQ-TUT-06). Renomear exige editar o teste. */
  id: string;
  title: string;
  /** O que o usuário terá ao fim do passo. */
  goal: string;
  /** Parágrafos, texto puro. */
  body: string[];
  screen: { href: string; label: string };
  /** Permissão exigida para *executar* o passo (D5) — passo sem ela fica informativo, não escondido. */
  permission: Permission;
  /** Chaves do api-registry (D2) — o teste de anti-deriva confere método+caminho contra API_ENDPOINTS. */
  endpoints: { method: ApiEndpoint["method"]; path: string }[];
  /** Como saber que o passo foi concluído — resolvido no servidor por contagem Prisma. */
  checks: ProgressCheck[];
  /** O beco sem saída que este passo evita. */
  pitfalls?: string[];
};
