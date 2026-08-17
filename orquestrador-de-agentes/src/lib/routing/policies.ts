import { z } from "zod";
import { prisma } from "../db.ts";
import { DEFAULT_TASK_TYPE } from "./resolve.ts";

/**
 * Contrato compartilhado dos candidatos de roteamento (design 007). Candidatos são
 * gerenciados junto do dono — política ou agente — substituindo a lista inteira, que
 * é como a UI sempre os manipula.
 */
export const candidateInputSchema = z.object({
  taskType: z.string().min(1).default(DEFAULT_TASK_TYPE),
  /** Omitido, a posição no array vira o rank — a ordem enviada é a preferência. */
  rank: z.number().int().optional(),
  providerId: z.string().min(1),
  model: z.string().min(1),
  maxTokens: z.number().int().positive().nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  enabled: z.boolean().default(true),
});

export type CandidateInput = z.infer<typeof candidateInputSchema>;

type CandidateWithProvider = {
  id: string;
  taskType: string;
  rank: number;
  providerId: string;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  enabled: boolean;
  provider?: { id: string; name: string; kind: string } | null;
};

export function serializeCandidate(row: CandidateWithProvider) {
  return {
    id: row.id,
    taskType: row.taskType,
    rank: row.rank,
    providerId: row.providerId,
    provider: row.provider ?? null,
    model: row.model,
    maxTokens: row.maxTokens,
    temperature: row.temperature,
    enabled: row.enabled,
  };
}

export function serializePolicy(row: {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  createdAt: Date;
  candidates: CandidateWithProvider[];
  _count?: { agents: number };
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    enabled: row.enabled,
    createdAt: row.createdAt,
    agentCount: row._count?.agents ?? 0,
    candidates: [...row.candidates]
      .sort((a, b) => (a.taskType === b.taskType ? a.rank - b.rank : a.taskType.localeCompare(b.taskType)))
      .map(serializeCandidate),
  };
}

function baseSlug(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "politica";
}

export async function uniquePolicySlug(name: string): Promise<string> {
  const base = baseSlug(name);
  let candidate = base;
  let n = 2;
  while (await prisma.modelPolicy.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

/** Valida que todo provedor citado existe e não foi excluído logicamente. */
export async function assertProvidersExist(candidates: CandidateInput[]): Promise<boolean> {
  const ids = [...new Set(candidates.map((c) => c.providerId))];
  if (ids.length === 0) return true;
  const found = await prisma.provider.count({ where: { id: { in: ids }, deletedAt: null } });
  return found === ids.length;
}

/** Linhas prontas para `create` aninhado — a posição no array vira o rank quando omitido. */
export function candidateCreateData(candidates: CandidateInput[]) {
  return candidates.map((c, index) => ({
    taskType: c.taskType,
    rank: c.rank ?? index,
    providerId: c.providerId,
    model: c.model,
    maxTokens: c.maxTokens ?? null,
    temperature: c.temperature ?? null,
    enabled: c.enabled,
  }));
}
