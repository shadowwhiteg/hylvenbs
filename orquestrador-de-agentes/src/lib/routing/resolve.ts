/**
 * Resolução da cadeia de modelos (design 007, T7.2). Função pura sobre linhas já
 * carregadas — sem I/O, para ser testável isoladamente e reutilizável tanto na
 * publicação de um snapshot quanto na execução.
 */

export const DEFAULT_TASK_TYPE = "default";

/** Candidato como vem do banco (ou de um snapshot já resolvido). */
export type CandidateRow = {
  id: string;
  taskType: string;
  rank: number;
  providerId: string;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  enabled: boolean;
};

export type ResolvedCandidate = {
  /** Id do `ModelCandidate` de origem, ou `null` quando veio do provider/model do agente. */
  candidateId: string | null;
  providerId: string;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  /** Posição na ordem deliberada, 0-based — antes de qualquer reordenação por saúde. */
  rank: number;
};

export type ChainInput = {
  /** Candidatos próprios do agente — prevalecem sobre os da política (RQ-ROT-03). */
  agentCandidates: CandidateRow[];
  /** Candidatos da política à qual o agente adere. */
  policyCandidates: CandidateRow[];
  /** Modelo único do agente — sempre entra como último recurso (RQ-ROT-12). */
  fallbackProviderId: string | null;
  fallbackModel: string;
};

/**
 * Escolhe a cadeia para `taskType`, na ordem: candidatos do agente para o tipo →
 * candidatos do agente para "default" → candidatos da política para o tipo →
 * candidatos da política para "default". Níveis não se misturam: se o agente
 * respondeu, a política não é consultada para aquele tipo (sobrescrita é
 * sobrescrita, não união — D2 do design 007).
 *
 * O `provider`/`model` do próprio agente é sempre anexado ao fim, se ainda não
 * estiver presente — um agente sem nada configurado continua executando como antes.
 */
export function resolveChain(input: ChainInput, taskType: string | null | undefined): ResolvedCandidate[] {
  const wanted = taskType?.trim() || DEFAULT_TASK_TYPE;

  const picked =
    pickForTaskType(input.agentCandidates, wanted) ??
    pickForTaskType(input.agentCandidates, DEFAULT_TASK_TYPE) ??
    pickForTaskType(input.policyCandidates, wanted) ??
    pickForTaskType(input.policyCandidates, DEFAULT_TASK_TYPE) ??
    [];

  const chain: ResolvedCandidate[] = picked.map((row, index) => ({
    candidateId: row.id,
    providerId: row.providerId,
    model: row.model,
    maxTokens: row.maxTokens,
    temperature: row.temperature,
    rank: index,
  }));

  if (input.fallbackProviderId && input.fallbackModel) {
    const already = chain.some(
      (c) => c.providerId === input.fallbackProviderId && c.model === input.fallbackModel,
    );
    if (!already) {
      chain.push({
        candidateId: null,
        providerId: input.fallbackProviderId,
        model: input.fallbackModel,
        maxTokens: null,
        temperature: null,
        rank: chain.length,
      });
    }
  }

  return chain;
}

/**
 * Candidatos habilitados daquele tipo, ordenados por `rank` e, no empate, pelo id —
 * determinístico entre processos, nunca dependente da ordem que o banco devolveu
 * (RQ-ROT-05). Devolve `null` (e não `[]`) quando o nível não tem resposta, para o
 * chamador distinguir "não configurado" de "configurado vazio".
 */
function pickForTaskType(rows: CandidateRow[], taskType: string): CandidateRow[] | null {
  const matching = rows.filter((r) => r.enabled && r.taskType === taskType);
  if (matching.length === 0) return null;
  return [...matching].sort((a, b) => (a.rank === b.rank ? a.id.localeCompare(b.id) : a.rank - b.rank));
}

/** Tipos de tarefa distintos declarados numa lista de candidatos — alimenta a UI. */
export function taskTypesOf(rows: CandidateRow[]): string[] {
  return [...new Set(rows.map((r) => r.taskType))].sort();
}
