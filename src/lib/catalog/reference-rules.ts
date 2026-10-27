import type { TranslationKey } from "@/lib/i18n";
import type { DataRow } from "@/lib/data/types";

/** Shared by the full catalogue editor and its inline «other» forms. */
export function referenceRuleError(table: string, values: DataRow, creating: boolean): TranslationKey | null {
  if (table !== "cities" && table !== "countries") return null;
  if ((creating || "arabic_name" in values) && !String(values.arabic_name ?? "").trim()) return "data.form.nameRequired";
  if (table === "cities" && (creating || "country_id" in values) && !values.country_id) return "pg.err.countryFirst";
  for (const [key, bound] of [["lat", 90], ["lng", 180]] as const) {
    const value = values[key];
    if (value !== null && value !== undefined && (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > bound)) return "data.form.invalidCoordinates";
  }
  return null;
}
