import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DueWhen, FinanceTerm } from "@/lib/offer/finance-terms";

const KIND_ORDER = { bank: 0, payment: 1, instalment: 2 } as const;

/**
 * Every «الشروط المالية» row (bank / payment / instalment), in the data
 * team's order. Its own query: before 20261029160100 is applied the milestone
 * columns do not exist, and the lists that share the terms query must not fail
 * with it — then the bank and payment lines come back without milestones.
 */
export async function loadFinanceTerms(supabase: SupabaseClient): Promise<FinanceTerm[]> {
  const base = "kind, arabic_text, country_id, checked, sort";
  const full = await supabase.from("terms").select(`${base}, due_when, due_days, due_percent, due_amount`).in("kind", ["bank", "payment", "instalment"]).order("sort", { ascending: true });
  const res = full.error ? await supabase.from("terms").select(base).in("kind", ["bank", "payment"]).order("sort", { ascending: true }) : full;
  if (res.error) return [];
  type Row = { kind: FinanceTerm["kind"]; arabic_text: string | null; country_id: string | null; checked: boolean | null; due_when?: DueWhen | null; due_days?: number | null; due_percent?: number | string | null; due_amount?: number | string | null };
  return ((res.data ?? []) as unknown as Row[])
    .filter((r) => r.arabic_text?.trim() || r.kind === "payment")
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    .map((r) => ({
      kind: r.kind,
      text: (r.arabic_text ?? "").trim(),
      country_id: r.country_id ?? null,
      checked: r.checked !== false,
      due_when: r.due_when ?? null,
      due_days: r.due_days ?? null,
      due_percent: r.due_percent == null ? null : Number(r.due_percent),
      due_amount: r.due_amount == null ? null : Number(r.due_amount),
    }));
}
