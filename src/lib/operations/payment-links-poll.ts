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
import { linkNotice, pollLinks, type LinkRow, type LinkStatus } from "./payment-links-rules";

/**
 * «تسجيل روابط السداد تلقائياً» (the owner, 2026-10-29): every 10 minutes
 * (/api/ops/payments) each pending MyFatoorah / Tamara link of the last 14 days
 * is asked about. Paid → ONE payment row (insertPayment, provider_ref unique),
 * syncOperation moves the case as a manual payment would, and the case's
 * seller hears it in the bell and on «تنبيهاتي». Expired/failed → a staff
 * notice, nothing recorded. NEVER a client message from here.
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
    .select("id, operation_id, provider, invoice_id, amount, currency, operations(offers(employee_id, partner_company_id, customers(arabic_name)))")
    .eq("status", "pending")
    .eq("mock", false)
    .gte("created_at", since)
    .limit(200);
  type Raw = { id: string; operation_id: string; provider: LinkRow["provider"]; invoice_id: string; amount: number | string; currency: string; operations: unknown };
  return ((data ?? []) as Raw[]).map((r) => {
    const offer = one(one(r.operations as { offers: unknown } | null)?.offers as { employee_id: string | null; partner_company_id: string | null; customers: unknown } | null);
    return {
      id: r.id,
      operation_id: r.operation_id,
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

async function recordPaid(supabase: SupabaseClient, link: LinkRow, amount: number): Promise<"created" | "duplicate" | "error"> {
  const providerRef = `${link.provider}:${link.invoice_id}`;
  const { count } = await supabase.from("operation_payments").select("id", { count: "exact", head: true }).eq("operation_id", link.operation_id).neq("kind", "refund");
  const res = await insertPayment(supabase, {
    operation_id: link.operation_id,
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
  await supabase.from("payment_links").update({ status: "paid", payment_id: paymentId ?? null, checked_at: new Date().toISOString() }).eq("id", link.id);
  if ("duplicate" in res) return "duplicate";
  await logAudit({
    action: "payment.recorded",
    entity: "operations",
    entity_id: link.operation_id,
    meta: { amount, currency: link.currency, payment_id: res.id, provider: link.provider, invoice_id: link.invoice_id, auto: true },
    actor: { id: null, label: "payment-links" },
  });
  // the money moves the client track exactly as a manual payment does
  await syncOperation(link.operation_id);
  return "created";
}

async function close(supabase: SupabaseClient, link: LinkRow, to: "failed" | "expired"): Promise<boolean> {
  const { data } = await supabase.from("payment_links").update({ status: to, checked_at: new Date().toISOString() }).eq("id", link.id).eq("status", "pending").select("id");
  return Boolean(data?.length);
}

export async function runPaymentLinks(): Promise<{ checked: number; paid: number; closed: number }> {
  const supabase = db();
  return pollLinks({
    pending: () => pending(supabase),
    status,
    recordPaid: (link, amount) => recordPaid(supabase, link, amount),
    close: (link, to) => close(supabase, link, to),
    touch: async (link) => {
      await supabase.from("payment_links").update({ checked_at: new Date().toISOString() }).eq("id", link.id);
    },
    notify: async (link, what) => {
      if (link.employee_id) await tellEmployee(supabase, link.employee_id, linkNotice(link, what), `/operations/${link.operation_id}`, `paylink:${link.id}:${what.kind}`);
    },
  });
}
