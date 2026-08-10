import {
  extractGtinDigits,
  readGtinFromAttributesJson,
} from "@/lib/ml/gtin-draft";

export type ProductGtinSource = {
  attributesJson?: string | null;
  draft?: { attributes?: string | null } | null;
};

/** Prefer draft attributes when they already have GTIN digits; else product attributesJson. */
export function gtinFromProduct(p: ProductGtinSource): string {
  const fromDraft = readGtinFromAttributesJson(p.draft?.attributes ?? "");
  if (extractGtinDigits(fromDraft)) return fromDraft;
  return readGtinFromAttributesJson(p.attributesJson ?? "");
}

/** GTIN-8/12/13/14 com dígito verificador GS1 correto. */
export function isValidGtin(raw: string): boolean {
  const gtin = (raw || "").replace(/\D+/g, "");
  if (![8, 12, 13, 14].includes(gtin.length)) return false;
  let sum = 0;
  let shouldDouble = true;
  for (let i = gtin.length - 2; i >= 0; i--) {
    const d = parseInt(gtin.charAt(i), 10);
    sum += shouldDouble ? d * 3 : d;
    shouldDouble = !shouldDouble;
  }
  return (10 - (sum % 10)) % 10 === parseInt(gtin.charAt(gtin.length - 1), 10);
}

/**
 * O ML rejeita o anúncio inteiro ("Product Identifier [GTIN] contains values
 * with invalid format") quando o EAN do catálogo é lixo — placeholders como
 * 7891234567890 são comuns no Meu Drop. Publicar sem GTIN é melhor que não
 * publicar, então o valor inválido é descartado em vez de derrubar o item.
 */
export function sanitizeGtinForPublish(raw: string | null | undefined): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  return isValidGtin(value) ? value : null;
}
