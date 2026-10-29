import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettlementRule } from "@/lib/data/app-settings";
import { mintReceipt } from "@/lib/data/payment-receipt";
import type { PaymentKind, PaymentMethod } from "@/lib/data/operations";
import { expectedSettlement, isBnpl } from "@/lib/payments/methods";
import { isIsoDate, riyadhDate } from "./payments";

/**
 * The ONE insert of a payment row — the employee's «سجّل دفعة» (recordPayment,
 * after its gate, through their own client) and a paid payment link (the
 * 10-minute job, service role). The caller audits and runs syncOperation.
 *
 * `provider_ref` is unique: a second insert of the same paid link answers
 * {duplicate} instead of a second row.
 */
export type NewPayment = {
  operation_id: string;
  amount: number;
  currency?: string;
  kind?: PaymentKind;
  method?: PaymentMethod | null;
  reference?: string | null;
  paid_at?: string;
  note?: string | null;
  recorded_by: string | null;
  provider_ref?: string | null;
};

export async function insertPayment(supabase: SupabaseClient, input: NewPayment): Promise<{ id: string } | { duplicate: true } | { error: true }> {
  const kind = input.kind ?? "deposit";
  // the office's day, not UTC's — a payment taken at 1am Riyadh is today's
  const paidAt = isIsoDate(input.paid_at) ? input.paid_at : riyadhDate();
  const row = {
    operation_id: input.operation_id,
    amount: Math.round(input.amount * 100) / 100,
    currency: input.currency ?? "SAR",
    kind,
    method: input.method ?? null,
    reference: input.reference?.trim() || null,
    paid_at: paidAt,
    // Tabby/Tamara pay us out on their weekly day — the daily run reminds the seller then
    expected_settlement_on: isBnpl(input.method) ? expectedSettlement(paidAt, await getSettlementRule()) : null,
    recorded_by: input.recorded_by,
    note: input.note?.trim() || null,
    provider_ref: input.provider_ref ?? null,
  };
  // the receipt number is a Riyadh day + 4 random characters: a clash is rare, not impossible
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("operation_payments")
      // a refund is money going out — it gets no «سند قبض»
      .insert({ ...row, ...(kind === "refund" ? {} : mintReceipt()) })
      .select("id")
      .single();
    if (data) return { id: (data as { id: string }).id };
    if (error?.code !== "23505") return { error: true };
    if (row.provider_ref) {
      const { data: had } = await supabase.from("operation_payments").select("id").eq("provider_ref", row.provider_ref).maybeSingle();
      if (had) return { duplicate: true };
    }
  }
  return { error: true };
}
