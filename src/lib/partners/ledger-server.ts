import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invoiceNoFor, overCredit, type LedgerLine } from "./ledger-math";

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

type OfferCost = { id: string; serial: string; partner_company_id: string | null; partner_cost: number | string | null; currency: string | null };

async function offerCost(service: SupabaseClient, offerId: string): Promise<OfferCost | null> {
  const { data } = await service
    .from("offers")
    .select("id, serial, partner_company_id, partner_cost, currency")
    .eq("id", offerId)
    .maybeSingle();
  return data as OfferCost | null;
}

/**
 * «العميل أكّد» from a partner: refused when this file would take its account
 * past its credit limit. Null = go ahead (no limit, no cost on the offer, or room).
 */
export async function creditRefusal(service: SupabaseClient, offerId: string): Promise<string | null> {
  const offer = await offerCost(service, offerId);
  if (!offer?.partner_company_id || offer.partner_cost == null) return null;
  const { lines, limit } = await readLedger(service, offer.partner_company_id);
  const next = { amount: Number(offer.partner_cost), currency: offer.currency || "SAR" };
  return overCredit(lines, next, limit)
    ? `تجاوز الحد الائتماني لشركتكم (${limit.amount?.toLocaleString("en-US")} ${limit.currency}). سدّدوا المستحق أو تواصلوا معنا لتأكيد هذا الملف.`
    : null;
}

/**
 * The invoice a confirmed partner file raises — once (unique offer_id), at the
 * cost fixed when it was issued. Our own offers raise none; an offer issued
 * before partner_cost existed raises none either and shows in the company's page
 * as confirmed without an invoice, for someone to price by hand.
 */
export async function raisePartnerInvoice(service: SupabaseClient, offerId: string): Promise<boolean> {
  const offer = await offerCost(service, offerId);
  if (!offer?.partner_company_id || offer.partner_cost == null) return false;
  const { error } = await service.from("partner_invoices").upsert(
    {
      partner_id: offer.partner_company_id,
      offer_id: offer.id,
      invoice_no: invoiceNoFor(offer.serial),
      amount: Number(offer.partner_cost),
      currency: offer.currency || "SAR",
    },
    { onConflict: "offer_id", ignoreDuplicates: true },
  );
  return !error;
}
