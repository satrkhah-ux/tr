import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import type { LedgerLine } from "./ledger-math";

/**
 * The ledger's writes that ride on a confirmation — called from operations.ts
 * with the SERVICE client, after that action has decided who may confirm.
 * Not a server action: nothing here is callable from a browser.
 */

/** The account's lines and limit, for any reader the caller has already authorised. */
export async function readLedger(
  supabase: SupabaseClient,
  partnerId: string,
): Promise<{ lines: LedgerLine[]; limit: { amount: number | null; currency: string } }> {
  const [inv, pay, partner] = await Promise.all([
    supabase.from("partner_invoices").select("invoice_no, amount, currency, issued_at, offers(serial)").eq("partner_id", partnerId),
    supabase.from("partner_payments").select("receipt_no, amount, currency, paid_at, method").eq("partner_id", partnerId),
    supabase.from("booking_partners").select("credit_limit, credit_currency").eq("id", partnerId).maybeSingle(),
  ]);
  type Inv = { invoice_no: string; amount: number | string; currency: string; issued_at: string; offers: { serial: string } | { serial: string }[] | null };
  type Pay = { receipt_no: string; amount: number | string; currency: string; paid_at: string; method: string };
  const lines: LedgerLine[] = [
    ...((inv.data ?? []) as Inv[]).map((r) => ({
      kind: "invoice" as const,
      at: r.issued_at,
      ref: r.invoice_no,
      amount: Number(r.amount) || 0,
      currency: r.currency,
      serial: (Array.isArray(r.offers) ? r.offers[0]?.serial : r.offers?.serial) ?? null,
    })),
    ...((pay.data ?? []) as Pay[]).map((r) => ({
      kind: "payment" as const,
      at: r.paid_at,
      ref: r.receipt_no,
      amount: Number(r.amount) || 0,
      currency: r.currency,
      method: r.method,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const p = partner.data as { credit_limit: number | string | null; credit_currency: string } | null;
  return { lines, limit: { amount: p?.credit_limit != null ? Number(p.credit_limit) : null, currency: p?.credit_currency || "SAR" } };
}

/** What raise_partner_invoice (0074) raises, as the partner reads it. */
const REFUSALS: Record<string, TranslationKey> = {
  partner_credit_limit: "ops.err.creditLimit",
  partner_credit_currency: "ops.err.creditCurrency",
  partner_cost_missing: "ops.err.noPartnerCost",
};

/**
 * The invoice a confirmed partner file raises — once (unique offer_id), at the
 * cost fixed when it was issued — in ONE database call that holds a lock on the
 * partner, so the credit check and the invoice that uses the credit cannot be
 * split by a parallel confirmation (raise_partner_invoice, 0074).
 *
 * `enforceLimit`: the partner's own «العميل أكّد» — refused past its credit
 * limit, or in a currency other than the limit's. We confirm without it, from
 * operations. Our own offers raise nothing; neither does an offer issued with no
 * partner_cost (it shows on the company page as confirmed without an invoice,
 * for someone to price by hand).
 *
 * `created` is the invoice THIS call wrote — null when there was nothing to
 * raise or it already existed — so a caller whose confirmation then fails can
 * take back exactly that one.
 */
export async function raisePartnerInvoice(
  service: SupabaseClient,
  offerId: string,
  enforceLimit: boolean,
): Promise<{ ok: true; created: string | null } | { ok: false; error: TranslationKey }> {
  const { data, error } = await service.rpc("raise_partner_invoice", { p_offer_id: offerId, p_enforce_limit: enforceLimit });
  if (error) return { ok: false, error: REFUSALS[error.message] ?? "err.db" };
  return { ok: true, created: (data as string | null) ?? null };
}
