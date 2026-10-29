"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";
import { gateOperation } from "@/lib/operations/access";
import { createInvoiceLink } from "@/lib/providers/myfatoorah";
import { createCheckout } from "@/lib/providers/tamara";

/**
 * A payment link for one case: PREPARED here (the provider creates the link,
 * nothing reaches the client), then SENT only by the employee's press, after
 * they reviewed the message. The amount is the final price the employee chose,
 * method fee included — no fee is computed here.
 */

type Fail = { ok: false; error: TranslationKey };
export type PaymentProvider = "myfatoorah" | "tamara";
export type PreparedLink = { ok: true; url: string; provider: PaymentProvider; mock: boolean; amount: number; currency: string };

const MAX_AMOUNT = 1_000_000;

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type CaseRow = { serial: string; currency: string; name: string; phone: string | null; partner: boolean };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** The client and serial from the case itself — never from the browser. */
async function loadCase(operationId: string): Promise<CaseRow | null> {
  type Offer = { serial: string | null; currency: string | null; partner_company_id: string | null; customers: { arabic_name: string | null; mobile: string | null } | { arabic_name: string | null; mobile: string | null }[] | null };
  const { data } = await (await db())
    .from("operations")
    .select("id, offers(serial, currency, partner_company_id, customers(arabic_name, mobile))")
    .eq("id", operationId)
    .maybeSingle();
  const offer = one((data as { offers: Offer | Offer[] | null } | null)?.offers);
  if (!offer?.serial) return null;
  const customer = one(offer.customers);
  return { serial: offer.serial, currency: offer.currency || "SAR", name: customer?.arabic_name?.trim() || "", phone: customer?.mobile || null, partner: Boolean(offer.partner_company_id) };
}

const site = () => (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");

export async function preparePaymentLink(operationId: string, input: { provider: PaymentProvider; amount: number }): Promise<PreparedLink | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { ok: false, error: "pay.err.amount" };
  if (input.provider !== "myfatoorah" && input.provider !== "tamara") return { ok: false, error: "pay.err.rejected" };

  try {
    const c = await loadCase(operationId);
    if (!c) return { ok: false, error: "ops.err.notYours" };
    // a partner's client hears from the partner, never from us (the rule ClientSend keeps)
    if (c.partner) return { ok: false, error: "pay.err.partner" };

    let outcome;
    if (input.provider === "myfatoorah") {
      outcome = await createInvoiceLink({ amount, currency: c.currency, customerName: c.name, customerMobile: c.phone, reference: c.serial, language: "ar" });
    } else {
      // Tamara sells in riyals only, and identifies the buyer by phone
      if (c.currency !== "SAR") return { ok: false, error: "pay.err.tamaraSar" };
      if (!c.phone) return { ok: false, error: "pay.err.noPhone" };
      const [firstName = "", ...rest] = c.name.split(/\s+/);
      // ponytail: the client lands on the site root after paying; a thank-you page and a webhook come with the status sync
      outcome = await createCheckout({
        amount,
        currency: "SAR",
        reference: c.serial,
        customer: { firstName: firstName || "—", lastName: rest.join(" "), phone: c.phone },
        description: `رحلة ${c.serial}`,
        successUrl: site(),
        failureUrl: site(),
        cancelUrl: site(),
      });
    }
    if (outcome.kind !== "ok") return { ok: false, error: outcome.kind === "rejected" ? "pay.err.rejected" : "pay.err.unreachable" };

    // kept so the 10-minute job can record it once paid (payment-links-poll.ts) — service role: the table has no policy
    const invoiceId = "invoiceId" in outcome.data ? outcome.data.invoiceId : (outcome.data.orderId ?? outcome.data.checkoutId);
    const { error: kept } = await (createSupabaseServiceClient() as unknown as SupabaseClient).from("payment_links").insert({
      operation_id: operationId,
      provider: input.provider,
      invoice_id: invoiceId,
      amount,
      currency: c.currency,
      url: outcome.data.url,
      mock: outcome.data.mock,
      created_by: await getCurrentEmployeeId(),
    });
    // a link nobody would ever record must not reach the client
    if (kept && kept.code !== "23505") return { ok: false, error: "err.db" };

    await logAudit({
      action: "payment_link.prepared",
      entity: "operations",
      entity_id: operationId,
      meta: { provider: input.provider, amount, currency: c.currency, mock: outcome.data.mock },
    });
    return { ok: true, url: outcome.data.url, provider: input.provider, mock: outcome.data.mock, amount, currency: c.currency };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * The employee's press. `body` comes from the browser on purpose — it is what
 * they reviewed and maybe edited, and what is stored must be what went out.
 */
export async function sendPaymentLink(operationId: string, input: { url: string; body: string }): Promise<{ ok: true } | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  if (!input.body.trim()) return { ok: false, error: "ops.err.emptyMessage" };

  try {
    const c = await loadCase(operationId);
    if (!c) return { ok: false, error: "ops.err.notYours" };
    // a partner's client hears from the partner, never from us (the rule ClientSend keeps)
    if (c.partner) return { ok: false, error: "pay.err.partner" };
    const conversationId = c.phone ? await conversationForPhone(c.phone) : null;
    if (!conversationId) return { ok: false, error: "ops.err.noConversation" };
    const sent = await sendTeletelMessage(conversationId, input.body);
    if (sent === null) return { ok: false, error: "ops.err.sendFailed" };

    await (await db()).from("operation_dispatches").insert({
      operation_id: operationId,
      channel: "whatsapp",
      audience: "client",
      template: "payment_link",
      to_label: c.name,
      to_address: c.phone,
      body: input.body,
      status: "sent",
      provider_message_id: String(sent),
      approved_by: await getCurrentEmployeeId(),
      sent_at: new Date().toISOString(),
    });
    await (createSupabaseServiceClient() as unknown as SupabaseClient).from("payment_links").update({ sent_at: new Date().toISOString() }).eq("operation_id", operationId).eq("url", input.url);
    await logAudit({ action: "payment_link.sent", entity: "operations", entity_id: operationId, meta: { url: input.url } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
