import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { syncOperation } from "@/lib/data/operation-sync";
import { notifyEmployee } from "@/lib/notifications/notify";
import { getInvoiceStatus } from "@/lib/providers/myfatoorah";
import { getOrderStatus } from "@/lib/providers/tamara";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";
import { siteUrl } from "@/lib/telegram/ops-bot";
import { insertPayment } from "./record-payment";
import { riyadhDate } from "./payments";
import { linkNotice, pollLinks, type LinkRow, type LinkStatus } from "./payment-links-rules";

/**
 * «تسجيل روابط السداد تلقائياً» (the owner, 2026-10-29): every 10 minutes
 * (/api/ops/payments) each pending MyFatoorah / Tamara link of the last 14 days
 * is asked about. Paid → ONE payment row (insertPayment, provider_ref unique),
 * syncOperation moves the case as a manual payment would, and the case's
 * seller hears it in the bell and on «تنبيهاتي». Expired/failed → a staff
 * notice, nothing recorded. NEVER a client message from here.
 *
 * A link paid before the file is confirmed («ادفع الآن» from the PDF — no case yet) is kept on the link
 * (paid_amount, payment_id null); confirming the file carries it into the case (carryOfferPayments, from
 * recordConfirmation), and each run carries any a confirmation missed.
 */

const LOOKBACK_DAYS = 14;
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

/** The bell and «تنبيهاتي» together — a seller who is not at the screen still hears it. */
export async function tellEmployee(supabase: SupabaseClient, employeeId: string, title: string, href: string, dedupeKey: string): Promise<void> {
  await notifyEmployee({ employeeId, kind: "ops", title, href, source: "operations", dedupeKey });
  const { data } = await supabase.from("employees").select("telegram_chat_id").eq("id", employeeId).eq("status", "Active").maybeSingle();
  const chat = Number((data as { telegram_chat_id: number | string | null } | null)?.telegram_chat_id);
  if (chat) await staffSend(chat, `💳 ${escapeHtml(title)}`, [[{ text: "افتح الملف", url: `${siteUrl()}${href}` }]], {}, null);
}

async function pending(supabase: SupabaseClient): Promise<LinkRow[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data } = await supabase
    .from("payment_links")
    .select("id, offer_id, operation_id, provider, invoice_id, amount, currency, offers(serial, employee_id, partner_company_id, customers(arabic_name))")
    .eq("status", "pending")
    .eq("mock", false)
    .gte("created_at", since)
    .limit(200);
  type Raw = { id: string; offer_id: string; operation_id: string | null; provider: LinkRow["provider"]; invoice_id: string; amount: number | string; currency: string; offers: unknown };
  return ((data ?? []) as Raw[]).map((r) => {
    const offer = one(r.offers as { serial: string; employee_id: string | null; partner_company_id: string | null; customers: unknown } | null);
    return {
      id: r.id,
      offer_id: r.offer_id,
      operation_id: r.operation_id,
      serial: offer?.serial ?? "",
      provider: r.provider,
      invoice_id: r.invoice_id,
      amount: Number(r.amount),
      currency: r.currency,
      partner: Boolean(offer?.partner_company_id),
      employee_id: offer?.employee_id ?? null,
      client: one(offer?.customers as { arabic_name: string | null } | null)?.arabic_name ?? "",
    };
  });
}

async function status(link: LinkRow): Promise<LinkStatus> {
  const res = link.provider === "myfatoorah" ? await getInvoiceStatus(link.invoice_id) : await getOrderStatus(link.invoice_id);
  return res.kind === "ok" ? { status: res.data.status, paidAmount: res.data.paidAmount } : null;
}

const caseOf = async (supabase: SupabaseClient, offerId: string): Promise<string | null> =>
  ((await supabase.from("operations").select("id").eq("offer_id", offerId).maybeSingle()).data as { id: string } | null)?.id ?? null;

async function recordPaid(supabase: SupabaseClient, link: LinkRow, amount: number): Promise<"created" | "held" | "duplicate" | "error"> {
  const operationId = link.operation_id ?? (await caseOf(supabase, link.offer_id));
  if (!operationId) {
    // no case yet: the money is kept on the link until the file is confirmed (carryOfferPayments)
    const { data } = await supabase
      .from("payment_links")
      .update({ status: "paid", paid_amount: amount, paid_on: riyadhDate(), checked_at: new Date().toISOString() })
      .eq("id", link.id)
      .eq("status", "pending")
      .select("id");
    if (!data?.length) return "duplicate";
    await logAudit({
      action: "payment_link.paid_before_case",
      entity: "offers",
      entity_id: link.offer_id,
      meta: { amount, currency: link.currency, provider: link.provider, invoice_id: link.invoice_id },
      actor: { id: null, label: "payment-links" },
    });
    return "held";
  }
  return recordInto(supabase, link, operationId, amount);
}

/** The payment row for a paid link in its case — ONCE (provider_ref unique) — then the case moves as a manual payment would. */
async function recordInto(supabase: SupabaseClient, link: LinkRow, operationId: string, amount: number, paidOn?: string): Promise<"created" | "duplicate" | "error"> {
  const providerRef = `${link.provider}:${link.invoice_id}`;
  const { count } = await supabase.from("operation_payments").select("id", { count: "exact", head: true }).eq("operation_id", operationId).neq("kind", "refund");
  const res = await insertPayment(supabase, {
    operation_id: operationId,
    ...(paidOn ? { paid_at: paidOn } : {}),
    amount,
    currency: link.currency,
    kind: count ? "installment" : "deposit",
    method: link.provider === "tamara" ? "tamara" : "link",
    reference: link.invoice_id,
    note: link.provider === "tamara" ? "سُجّلت تلقائياً من رابط تمارا" : "سُجّلت تلقائياً من رابط ماي فاتورة",
    recorded_by: null,
    provider_ref: providerRef,
  });
  if ("error" in res) return "error";
  const paymentId = "id" in res ? res.id : ((await supabase.from("operation_payments").select("id").eq("provider_ref", providerRef).maybeSingle()).data as { id: string } | null)?.id;
  await supabase
    .from("payment_links")
    .update({ status: "paid", operation_id: operationId, payment_id: paymentId ?? null, paid_amount: amount, paid_on: paidOn ?? riyadhDate(), checked_at: new Date().toISOString() })
    .eq("id", link.id);
  if ("duplicate" in res) return "duplicate";
  await logAudit({
    action: "payment.recorded",
    entity: "operations",
    entity_id: operationId,
    meta: { amount, currency: link.currency, payment_id: res.id, provider: link.provider, invoice_id: link.invoice_id, auto: true },
    actor: { id: null, label: "payment-links" },
  });
  // the money moves the client track exactly as a manual payment does
  await syncOperation(operationId);
  return "created";
}

/**
 * The links an offer's client paid before it had a case, into the case — at confirmation (recordConfirmation)
 * and on every run for any a confirmation missed. Silent: the seller heard of each payment when it came.
 */
export async function carryOfferPayments(offerId: string, operationId: string): Promise<number> {
  const supabase = db();
  const { data } = await supabase
    .from("payment_links")
    .select("id, offer_id, provider, invoice_id, amount, currency, paid_amount, paid_on")
    .eq("offer_id", offerId)
    .eq("status", "paid")
    .is("payment_id", null);
  type Held = { id: string; offer_id: string; provider: LinkRow["provider"]; invoice_id: string; amount: number | string; currency: string; paid_amount: number | string | null; paid_on: string | null };
  let carried = 0;
  for (const h of (data ?? []) as Held[]) {
    const link: LinkRow = { id: h.id, offer_id: h.offer_id, operation_id: operationId, serial: "", provider: h.provider, invoice_id: h.invoice_id, amount: Number(h.amount), currency: h.currency, partner: false, employee_id: null, client: "" };
    if ((await recordInto(supabase, link, operationId, Number(h.paid_amount ?? h.amount), h.paid_on ?? undefined)) === "created") carried += 1;
  }
  return carried;
}

/** Each run: held payments whose file was confirmed since — a confirmation whose own carry failed loses nothing. */
async function carryConfirmed(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.from("payment_links").select("offer_id").eq("status", "paid").is("payment_id", null).limit(100);
  for (const offerId of new Set(((data ?? []) as { offer_id: string }[]).map((r) => r.offer_id))) {
    const op = await caseOf(supabase, offerId);
    if (op) await carryOfferPayments(offerId, op);
  }
}

async function close(supabase: SupabaseClient, link: LinkRow, to: "failed" | "expired"): Promise<boolean> {
  const { data } = await supabase.from("payment_links").update({ status: to, checked_at: new Date().toISOString() }).eq("id", link.id).eq("status", "pending").select("id");
  return Boolean(data?.length);
}

export async function runPaymentLinks(): Promise<{ checked: number; paid: number; closed: number }> {
  const supabase = db();
  await carryConfirmed(supabase);
  return pollLinks({
    pending: () => pending(supabase),
    status,
    recordPaid: (link, amount) => recordPaid(supabase, link, amount),
    close: (link, to) => close(supabase, link, to),
    touch: async (link) => {
      await supabase.from("payment_links").update({ checked_at: new Date().toISOString() }).eq("id", link.id);
    },
    notify: async (link, what) => {
      const href = link.operation_id ? `/operations/${link.operation_id}` : `/offer/${encodeURIComponent(link.serial)}`;
      if (link.employee_id) await tellEmployee(supabase, link.employee_id, linkNotice(link, what), href, `paylink:${link.id}:${what.kind}`);
    },
  });
}
