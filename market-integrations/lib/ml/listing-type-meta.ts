/**
 * Constantes de tipo de anúncio sem dependência de servidor.
 *
 * Separado de `lib/ml/listing-type.ts` de propósito: aquele importa Prisma e o
 * cliente do ML (que puxa `fs`/`child_process` pela cadeia de settings), então
 * importá-lo de um componente `"use client"` quebra o bundle do navegador.
 */

export const ML_LISTING_TYPES = ["gold_special", "gold_pro"] as const;
export type MlListingType = (typeof ML_LISTING_TYPES)[number];

export const ML_LISTING_TYPE_LABELS: Record<MlListingType, string> = {
  gold_special: "Clássico",
  gold_pro: "Premium",
};

export function parseMlListingType(value: unknown): MlListingType | undefined {
  return ML_LISTING_TYPES.includes(value as MlListingType) ? (value as MlListingType) : undefined;
}
