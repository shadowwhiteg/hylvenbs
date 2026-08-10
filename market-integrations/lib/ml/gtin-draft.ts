/** Helpers de GTIN/EAN seguros para o browser (sem imports de Node/fs). */

type DraftAttribute = {
  id?: string;
  name: string;
  value_name: string;
};

const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

function normalizeKey(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GTIN_READ_KEYS = new Set([
  "gtin",
  "ean",
  "upc",
  "codigo de barras",
  "codigo ean",
  "codigo universal",
]);

function parseDraftAttributes(json: string): DraftAttribute[] {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(json || "[]");
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? row.id ?? "").trim();
      if (!name) return null;
      const id = typeof row.id === "string" ? row.id : undefined;
      const value_name = String(row.value_name ?? row.value ?? "").trim();
      return { ...(id ? { id } : {}), name, value_name } satisfies DraftAttribute;
    })
    .filter((attr): attr is DraftAttribute => attr !== null);
}

function isGtinAttribute(name: string, id?: string): boolean {
  const nameKey = normalizeKey(name);
  const idKey = normalizeKey(id ?? "");
  return idKey === "gtin" || idKey === "ean" || GTIN_READ_KEYS.has(nameKey);
}

/** Algoritmo GS1 de dígito verificador (EAN-8/12/13/14). */
export function isValidGtinCheckDigit(gtin: string): boolean {
  if (!/^\d+$/.test(gtin) || !VALID_GTIN_LENGTHS.has(gtin.length)) return false;
  const digits = gtin.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += digits[i]! * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  return check === expected;
}

export function extractGtinDigits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Retorna GTIN normalizado ou null se tamanho/check digit inválidos. */
export function normalizeGtinValue(value: string | null | undefined): string | null {
  const digits = extractGtinDigits(value);
  if (!VALID_GTIN_LENGTHS.has(digits.length)) return null;
  if (!isValidGtinCheckDigit(digits)) return null;
  return digits;
}

/** Mensagem de erro amigável para o campo GTIN (ou null se ok/vazio). */
export function getGtinFormatError(value: string | null | undefined): string | null {
  const digits = extractGtinDigits(value);
  if (!digits) return null;
  if (!VALID_GTIN_LENGTHS.has(digits.length)) {
    return "GTIN/EAN deve ter 8, 12, 13 ou 14 dígitos (código real da embalagem).";
  }
  if (!isValidGtinCheckDigit(digits)) {
    return "Dígito verificador inválido — confira o código de barras na embalagem (não use número inventado).";
  }
  return null;
}

/** Lê dígitos do GTIN/EAN no JSON, sem validar check digit (para exibir no input). */
export function readGtinFromAttributesJson(json: string): string {
  for (const attr of parseDraftAttributes(json)) {
    if (!isGtinAttribute(attr.name, attr.id)) continue;
    return extractGtinDigits(attr.value_name) || attr.value_name.trim();
  }
  return "";
}

/** GTIN validado para envio ao ML (vazio se ausente ou inválido). */
export function readValidGtinFromAttributesJson(json: string): string {
  return normalizeGtinValue(readGtinFromAttributesJson(json)) ?? "";
}

/** Atualiza ou remove GTIN/EAN no JSON de características (formato `{name,value}`). */
export function upsertGtinInAttributesJson(json: string, rawGtin: string): string {
  const kept = parseDraftAttributes(json).filter(
    (attr) => !isGtinAttribute(attr.name, attr.id)
  );

  const digits = extractGtinDigits(rawGtin);
  if (digits) {
    const normalized = normalizeGtinValue(digits);
    kept.unshift({
      name: "Código EAN",
      value_name: normalized ?? digits,
    });
  }

  const stored = kept.map((attr) => ({
    ...(attr.id ? { id: attr.id } : {}),
    name: attr.name,
    value: attr.value_name,
  }));

  return JSON.stringify(stored, null, 2);
}
