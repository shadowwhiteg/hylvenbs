import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope: "v<versão>:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>".
 * A versão seleciona a chave mestra (ENCRYPTION_KEY para a corrente,
 * ENCRYPTION_KEY_V<N> para versões antigas durante rotação). Ver design 005.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

class MissingEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingEncryptionKeyError";
  }
}

function decodeKey(raw: string, source: string): Buffer {
  const key = Buffer.from(raw, "base64url");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${source} deve ter 32 bytes em base64url (recebido ${key.length}).`);
  }
  return key;
}

/** Versão da chave mestra corrente. Sobe manualmente durante rotação (design 005). */
function currentKeyVersion(): number {
  const raw = process.env.ENCRYPTION_KEY_VERSION;
  return raw ? Number.parseInt(raw, 10) : 1;
}

function keyForVersion(version: number): Buffer {
  const envVar = version === currentKeyVersion() ? "ENCRYPTION_KEY" : `ENCRYPTION_KEY_V${version}`;
  const raw = process.env[envVar];
  if (!raw) {
    throw new MissingEncryptionKeyError(
      `${envVar} ausente. Gere com "npm run generate-key" e defina no .env.`,
    );
  }
  return decodeKey(raw, envVar);
}

/** true se ENCRYPTION_KEY está definida e tem o formato esperado. */
export function hasEncryptionKey(): boolean {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return false;
  try {
    decodeKey(raw, "ENCRYPTION_KEY");
    return true;
  } catch {
    return false;
  }
}

function b64(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Cifra um valor em claro. `aad` amarra o ciphertext ao registro (ex.: "Provider:<id>:apiKey"). */
export function encrypt(plain: string, aad: string): string {
  const version = currentKeyVersion();
  const key = keyForVersion(version);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${b64(iv)}:${b64(tag)}:${b64(ciphertext)}`;
}

/** Decifra um envelope. Lança se a chave, o AAD ou o ciphertext não conferirem. */
export function decrypt(envelope: string, aad: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Envelope de segredo malformado.");
  }
  const [versionPart, ivPart, tagPart, ctPart] = parts;
  const version = Number.parseInt(versionPart.slice(1), 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Envelope de segredo com versão inválida.");
  }

  const key = keyForVersion(version);
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ctPart, "base64url");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

/** Distingue um envelope de um valor legado em claro — torna a migração idempotente. */
export function isEnvelope(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^v\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(value);
}

/** Máscara para exibição: preserva só as bordas ("sk-a…z9"). Nunca usar para armazenar. */
export function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/** Usado só no boot (instrumentation.ts) para validar a chave sem espalhar decrypt(). */
export function canDecrypt(envelope: string, aad: string): boolean {
  try {
    decrypt(envelope, aad);
    return true;
  } catch {
    return false;
  }
}

/** Extrai a versão do prefixo de um envelope, sem decifrar. */
export function envelopeVersion(envelope: string): number | null {
  const match = /^v(\d+):/.exec(envelope);
  return match ? Number.parseInt(match[1], 10) : null;
}

export { MissingEncryptionKeyError };
