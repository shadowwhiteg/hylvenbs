import type { ErrorType } from "../telemetry/errors.ts";
import { isRetryable } from "../telemetry/errors.ts";

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS_TRANSIENT = 3;
export const DEFAULT_MAX_ATTEMPTS_OTHER = 1;

/** RQ-ASY-09: espera exponencial com jitter, capada em 60s. `attempt` é 1-based. */
export function backoffMs(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(exp * (0.5 + Math.random() / 2));
}

export function maxAttemptsFor(errorType: ErrorType, httpStatus?: number): number {
  return isRetryable(errorType, httpStatus) ? DEFAULT_MAX_ATTEMPTS_TRANSIENT : DEFAULT_MAX_ATTEMPTS_OTHER;
}
