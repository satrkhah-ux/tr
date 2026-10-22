import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/data/all-rows";
import type { FilterDef, FilterOption, FilterOptions } from "@/lib/data/types";

/**
 * A data page's «present» filters (the owner, 2026-10-22: «البيانات الموجودة
 * في النظام تحتاج إلى فلترة مناسبة»): only the values the table holds, each
 * with its count — «تركيا (125)», not the 57 countries of a table with five.
 * A city keeps its country, so the list follows the chosen country; a city
 * kept as text (transfers) finds its country by its name among the cities.
 * Read with the viewer's own session, a thousand rows at a time.
 */
export async function withPresentOptions(table: string, filters: FilterDef[], options: FilterOptions): Promise<FilterDef[]> {
  const present = filters.filter((f) => f.present);
  if (present.length === 0) return filters;
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const columns = [...new Set(present.map((f) => f.column ?? f.key))];
    const { data } = await allRows<Record<string, unknown>>((from, to) =>
      supabase.from(table).select(["id", ...columns].join(", ")).order("id").range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
    );
    const cityParent = new Map(options.cities.map((c) => [c.label.trim(), c.parent ?? null]));
    return filters.map((def) => {
      if (!def.present) return def;
      const counts = new Map<string, number>();
      for (const row of data) {
        const v = row[def.column ?? def.key];
        if (v != null && String(v).trim()) counts.set(String(v).trim(), (counts.get(String(v).trim()) ?? 0) + 1);
      }
      const known = def.source && def.source !== "static" ? options[def.source] : null;
      const list: FilterOption[] = known
        ? known.filter((o) => counts.has(o.value)).map((o) => ({ ...o, label: `${o.label} (${counts.get(o.value)})` }))
        : [...counts.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], "ar"))
            .map(([value, n]) => ({ value, label: `${value} (${n})`, ...(def.key.endsWith("city") ? { parent: cityParent.get(value) ?? null } : {}) }));
      return { ...def, source: undefined, options: list };
    });
  } catch {
    return filters;
  }
}
