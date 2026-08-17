import { prisma } from "../db.ts";
import type { ErrorType } from "../telemetry/errors.ts";
import type { ResolvedCandidate } from "./resolve.ts";

/**
 * Saúde observada por par (provedor, modelo) e ordenação por disponibilidade
 * (design 007, T7.3, RQ-ROT-08).
 *
 * Disjuntor deliberadamente frouxo: a carência **reordena** a cadeia, nunca remove
 * um candidato. Bloquear seria transformar indisponibilidade parcial em falha total
 * quando todos os candidatos estivessem em carência ao mesmo tempo.
 */

export const FAILURE_THRESHOLD = 2;
export const COOLDOWN_MS = 60_000;
export const MAX_COOLDOWN_MS = 15 * 60_000;

export type HealthRow = {
  providerId: string;
  model: string;
  consecutiveFailures: number;
  cooldownUntil: Date | null;
};

/**
 * Chave do índice de saúde. Exportada porque o orquestrador monta o mesmo índice —
 * duas definições do formato acabariam divergindo em silêncio.
 */
export function healthKey(providerId: string, model: string): string {
  return `${providerId}\u0000${model}`;
}

/** Índice consultável de saúde para os pares que a cadeia usa. */
export async function loadHealth(candidates: ResolvedCandidate[]): Promise<Map<string, HealthRow>> {
  if (candidates.length === 0) return new Map();
  const rows = await prisma.modelHealth.findMany({
    where: { OR: candidates.map((c) => ({ providerId: c.providerId, model: c.model })) },
    select: { providerId: true, model: true, consecutiveFailures: true, cooldownUntil: true },
  });
  return new Map(rows.map((r) => [healthKey(r.providerId, r.model), r]));
}

/**
 * Ordenação estável em dois grupos: primeiro quem não está em carência, depois quem
 * está — cada grupo preservando a ordem deliberada (`rank`). Nunca descarta ninguém.
 */
export function orderByAvailability(
  chain: ResolvedCandidate[],
  health: Map<string, HealthRow>,
  now: Date = new Date(),
): ResolvedCandidate[] {
  const healthy: ResolvedCandidate[] = [];
  const cooling: ResolvedCandidate[] = [];

  for (const candidate of chain) {
    const row = health.get(healthKey(candidate.providerId, candidate.model));
    const inCooldown = !!row?.cooldownUntil && row.cooldownUntil.getTime() > now.getTime();
    (inCooldown ? cooling : healthy).push(candidate);
  }

  return [...healthy, ...cooling];
}

/**
 * Saúde é telemetria: registrar não pode derrubar nem falhar a execução. Duas runs
 * simultâneas contra o mesmo par (provedor, modelo) disputam o mesmo `upsert` e uma
 * delas leva P2002 — engolimos, porque perder uma amostra é irrelevante perto de
 * quebrar a run (ou o processo, já que estas chamadas são disparadas sem `await`).
 */
async function safely(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(`[routing] falha ao registrar saúde (${what}):`, err instanceof Error ? err.message : err);
  }
}

/** Sucesso zera o contador e fecha a carência na hora. */
export async function recordSuccess(providerId: string, model: string): Promise<void> {
  const now = new Date();
  await safely("success", () =>
    prisma.modelHealth.upsert({
      where: { providerId_model: { providerId, model } },
      create: { providerId, model, consecutiveFailures: 0, lastOkAt: now },
      update: { consecutiveFailures: 0, cooldownUntil: null, lastOkAt: now },
    }),
  );
}

/**
 * Falha incrementa o contador; a partir de `FAILURE_THRESHOLD` abre carência com
 * espera exponencial no número de falhas, capada em `MAX_COOLDOWN_MS`.
 */
export async function recordFailure(
  providerId: string,
  model: string,
  errorType: ErrorType,
  errorMessage: string,
): Promise<void> {
  await safely("failure", async () => {
    const now = new Date();
    const existing = await prisma.modelHealth.findUnique({
      where: { providerId_model: { providerId, model } },
      select: { consecutiveFailures: true },
    });

    const failures = (existing?.consecutiveFailures ?? 0) + 1;
    const cooldownUntil =
      failures >= FAILURE_THRESHOLD
        ? new Date(now.getTime() + Math.min(COOLDOWN_MS * 2 ** (failures - FAILURE_THRESHOLD), MAX_COOLDOWN_MS))
        : null;

    const data = {
      consecutiveFailures: failures,
      lastErrorType: errorType,
      lastErrorMessage: errorMessage.slice(0, 500),
      lastErrorAt: now,
      cooldownUntil,
    };

    return prisma.modelHealth.upsert({
      where: { providerId_model: { providerId, model } },
      create: { providerId, model, ...data },
      update: data,
    });
  });
}
