import { mask } from "../crypto/secrets.ts";

const SECRET_KEY_RE = /token|key|secret|password|senha|authorization|apikey/i;

/** Mascara valores de chaves com nome sensível e trunca strings grandes antes de gravar (RQ-SEC-08). */
export function redact(value: unknown, maxStringLen: number, depth = 0): unknown {
  if (depth > 6) return "…[profundidade máxima]";
  if (typeof value === "string") {
    return value.length > maxStringLen ? `${value.slice(0, maxStringLen)}…[truncado]` : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, maxStringLen, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key) && typeof val === "string") {
        out[key] = mask(val);
      } else {
        out[key] = redact(val, maxStringLen, depth + 1);
      }
    }
    return out;
  }
  return value;
}

/** Serializa mascarando e truncando; nunca lança — falha vira uma string de aviso. */
export function redactedJson(value: unknown, maxStringLen: number): string {
  try {
    return JSON.stringify(redact(value, maxStringLen) ?? null);
  } catch {
    return JSON.stringify({ _error: "não foi possível serializar" });
  }
}
