"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CustomerType, MarkupRule, MarkupScope, MarkupType, RoundingRule } from "@/lib/pricing/markup";
import type { MarkupRuleRow } from "@/lib/types";

/** Map an admin-managed DB row to the pure-engine MarkupRule. */
function toMarkupRule(row: MarkupRuleRow): MarkupRule {
  const step = row.rounding_step == null ? null : Number(row.rounding_step);
  const rounding: RoundingRule =
    row.rounding_mode && step != null && step > 0
      ? { mode: row.rounding_mode as "up" | "nearest" | "down", step }
      : null;
  return {
    id: row.id,
    scope: (row.scope as MarkupScope) || "per_hotel_line",
    markup_type: (row.markup_type as MarkupType) || "percentage",
    value: Number(row.markup_value) || 0,
    country: row.country,
    city: row.city,
    supplier_id: row.supplier_id,
    star_rating: row.star_rating,
    season_start: row.season_start,
    season_end: row.season_end,
    customer_type: (row.customer_type as CustomerType | null) ?? null,
    is_default: row.is_default === true,
    min_margin_pct: row.min_margin_pct == null ? null : Number(row.min_margin_pct),
    rounding,
    priority: Number.isFinite(row.priority) ? row.priority : 0,
  };
}

/** Active markup rules as pure-engine rules (empty on any failure). */
export async function getActiveMarkupRules(): Promise<MarkupRule[]> {
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase.from("markup_rules").select("*").eq("status", "Active");
    return ((data ?? []) as MarkupRuleRow[]).map(toMarkupRule);
  } catch {
    return [];
  }
}
