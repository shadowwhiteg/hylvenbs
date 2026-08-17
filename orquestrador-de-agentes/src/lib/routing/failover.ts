import { ProviderError } from "../telemetry/errors.ts";
import type { ErrorType } from "../telemetry/errors.ts";

/**
 * Que falhas justificam tentar o próximo candidato (design 007, D5, RQ-ROT-06/07).
 *
 * A regra é "isto indica que **este** modelo/provedor não está servindo agora?".
 * Cancelamento e timeout da run são decisão do usuário/sistema — trocar de modelo
 * ignoraria o pedido. Um 400 é requisição malformada: vai falhar igual no próximo.
 * Já 401/403/404 dizem respeito àquele provedor ou àquele modelo especificamente
 * (credencial inválida, modelo inexistente), então outro candidato pode servir.
 */
export function isFailoverable(errorType: ErrorType, httpStatus?: number): boolean {
  if (errorType === "provider_rate_limit") return true;
  if (errorType !== "provider_error") return false;
  if (typeof httpStatus !== "number") return true; // resposta malformada/transporte
  if (httpStatus >= 500) return true;
  return httpStatus === 401 || httpStatus === 403 || httpStatus === 404;
}

/** Extrai o status HTTP quando o erro veio de um provedor — usado por isFailoverable. */
export function httpStatusOf(err: unknown): number | undefined {
  return err instanceof ProviderError ? err.httpStatus : undefined;
}
