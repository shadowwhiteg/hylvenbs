import { SALE_FORMAT_ATTR_ID, UNITS_PER_PACK_ATTR_ID } from "@/lib/ml/attributes";

/**
 * Todo kit precisa do atributo "Formato de venda" = Kit; quando esse valor é
 * Kit, o ML exige também "Unidades por kit" (UNITS_PER_PACK) — sem isso a
 * publicação é rejeitada. Já preenchemos os dois na criação porque sabemos a
 * quantidade real de unidades do kit.
 */
export function buildKitAttributesJson(unitsPerKit: number): string {
  const units = Math.max(1, Math.floor(unitsPerKit) || 1);
  return JSON.stringify([
    { id: SALE_FORMAT_ATTR_ID, name: "Formato de venda", value_name: "Kit" },
    { id: UNITS_PER_PACK_ATTR_ID, name: "Unidades por kit", value_name: String(units) },
  ]);
}
