import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Formato: "scrypt$N=<n>,r=<r>,p=<p>$<sal-b64url>$<hash-b64url>" — RQ-AUTH-13. */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
// node:crypto exige maxmem >= ~128*N*r; N=32768,r=8 fica bem em cima do default de 32 MiB.
const MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$N=${N},r=${R},p=${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Verifica em tempo constante. Nunca lança — retorna false para formato inválido. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const params = Object.fromEntries(
    parts[1].split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const n = Number.parseInt(params.N, 10);
  const r = Number.parseInt(params.r, 10);
  const p = Number.parseInt(params.p, 10);
  if (![n, r, p].every(Number.isFinite)) return false;

  const salt = Buffer.from(parts[2], "base64url");
  const expected = Buffer.from(parts[3], "base64url");
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Faz um scrypt "fantasma" com o mesmo custo — usado quando o e-mail não existe,
 * para o tempo de resposta não vazar se a conta existe (RQ-AUTH-12).
 */
export function simulatePasswordCheck(password: string): void {
  scryptSync(password, randomBytes(16), KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
}

/** Senha temporária legível, gerada no cadastro/reset — mostrada uma única vez. */
export function generateTempPassword(): string {
  return randomBytes(9).toString("base64url");
}
