import { prisma } from "../db.ts";

/**
 * Custo estimado a partir de `ModelPrice` (RQ-OBS-06). Sem preço cadastrado, retorna
 * null e a UI mostra "—" em vez de zero — a ausência de preço não é o mesmo que
 * custo zero. Sempre rotulado como "estimado": cache de prompt e descontos não são
 * conhecidos aqui.
 */
export async function estimateCost(
  providerKind: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number | null> {
  const price = await prisma.modelPrice.findUnique({
    where: { providerKind_model: { providerKind, model } },
  });
  if (!price) return null;
  return (inputTokens / 1e6) * price.inputPerMTok + (outputTokens / 1e6) * price.outputPerMTok;
}
