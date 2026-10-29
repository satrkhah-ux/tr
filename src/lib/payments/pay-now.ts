import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { issuedDraftData } from "@/lib/data/issued-draft";
import { logAudit } from "@/lib/data/audit";
import { caseTotal, paidTotal, riyadhDate } from "@/lib/operations/payments";
import { createInvoiceLink } from "@/lib/providers/myfatoorah";
import { createCheckout, getInstalmentLimits } from "@/lib/providers/tamara";
import { tellEmployee } from "@/lib/operations/payment-links-poll";
import { isPayMethod } from "./methods";
import { payButtonFor, payDecision, reusableLink, REUSE_MS, TAMARA_REUSE_MS, type OpenLink, type PayFile, type PayRefusal, type PayVia, withinTamara } from "./pay-now-rules";
import { readAmount, signAmount } from "./pay-token";

/**
 * «ادفع الآن» (the owner, 2026-10-29). The client's PDF and page point at OUR stable page /pay/<serial> — a
 * MyFatoorah invoice expires, our link does not. Pressing «ادفع الآن» there makes the invoice for what is owed on
 * the file NOW (the latest published version, or the case's agreed price), or reuses a young one of the same
 * amount, keeps it in payment_links (the 10-minute job records it once paid) and sends the client to MyFatoorah.
 * Service role throughout: the page has no session and the serial is the only thing it is told.
 *
 * Tamara (`?m=tamara`, the owner 2026-10-29): the same page and rules; the press makes a Tamara checkout session
 * for what is owed, with the client's name and mobile from the offer, and Tamara sends the client back to
 * /pay/<serial>/done — which only says thanks: the 10-minute job records the payment once Tamara authorises it.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const site = () => (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
// the same server secret the voucher links sign with (document-issue.ts tokenFor); without it no custom amount verifies
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type Loaded = {
  offerId: string;
  operationId: string | null;
  employeeId: string | null;
  name: string;
  phone: string | null;
  file: PayFile;
};

export async function loadPayFile(serial: string): Promise<Loaded | null> {
  if (!/^[A-Za-z0-9-]{3,40}$/.test(serial)) return null;
  const supabase = db();
  type Offer = { id: string; status: string | null; partner_company_id: string | null; valid_until: string | null; currency: string | null; employee_id: string | null; customers: unknown };
  const { data: o } = await supabase
    .from("offers")
    .select("id, status, partner_company_id, valid_until, currency, employee_id, customers(arabic_name, mobile)")
    .eq("serial", serial)
    .maybeSingle();
  const offer = o as Offer | null;
  if (!offer) return null;
  const [render, op, held, draft] = await Promise.all([
    supabase
      .from("offer_renders")
      .select("total:snapshot_json->total, currency:snapshot_json->>currency")
      .eq("offer_id", offer.id)
      .eq("variant", "client")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("operations").select("id, agreed_total").eq("offer_id", offer.id).maybeSingle(),
    supabase.from("payment_links").select("amount, paid_amount").eq("offer_id", offer.id).eq("status", "paid").is("payment_id", null),
    issuedDraftData(supabase, { id: offer.id, serial, partner_company_id: offer.partner_company_id }).catch(() => null),
  ]);
  const r = render.data as { total: number | string | null; currency: string | null } | null;
  if (!r) return null;
  const operation = op.data as { id: string; agreed_total: number | string | null } | null;
  const payments = operation
    ? (((await supabase.from("operation_payments").select("amount, kind").eq("operation_id", operation.id)).data ?? []) as { amount: number | string; kind: string }[])
    : [];
  const heldPaid = ((held.data ?? []) as { amount: number | string; paid_amount: number | string | null }[]).reduce((s, l) => s + Number(l.paid_amount ?? l.amount), 0);
  const method = (draft?.pricing as { payment_method?: unknown } | undefined)?.payment_method;
  const customer = one(offer.customers as { arabic_name: string | null; mobile: string | null } | null);
  return {
    offerId: offer.id,
    operationId: operation?.id ?? null,
    employeeId: offer.employee_id,
    name: customer?.arabic_name?.trim() ?? "",
    phone: customer?.mobile ?? null,
    file: {
      status: offer.status,
      partner: Boolean(offer.partner_company_id),
      validUntil: offer.valid_until,
      total: caseTotal(r.total, operation?.agreed_total),
      currency: r.currency || offer.currency || "SAR",
      method: isPayMethod(method) ? method : null,
      paid: paidTotal(payments.map((p) => ({ amount: Number(p.amount), kind: p.kind }))) + heldPaid,
    },
  };
}

/** The stable link: bare for the PDF's button, `?a=` with a server-signed amount for a deposit or an instalment; `?m=tamara` for Tamara. */
export function payLink(serial: string, amount?: number | null, via: PayVia = "myfatoorah"): string {
  const q = new URLSearchParams();
  if (via === "tamara") q.set("m", "tamara");
  if (amount && amount > 0 && secret()) q.set("a", signAmount(secret(), serial, amount, Date.now(), via));
  const base = `${site()}/pay/${encodeURIComponent(serial)}`;
  return q.size ? `${base}?${q}` : base;
}

/** For the staff tools: Tamara's limits when this amount falls outside them — null when it fits, or they cannot be read (Tamara's checkout decides then). */
export async function tamaraLimitProblem(amount: number): Promise<{ min: string; max: string } | null> {
  const limits = await getInstalmentLimits();
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return limits && !withinTamara(amount, limits) ? { min: fmt(limits.min), max: fmt(limits.max) } : null;
}

const readToken = (serial: string, token: string | undefined, via: PayVia) => (token === undefined ? undefined : readAmount(secret(), serial, token, Date.now(), via));

/** For the client's PDF and page: the button of the ONE way the offer was issued with (MyFatoorah or Tamara), only on our own files. */
export async function payNowUrl(serial: string): Promise<{ url: string; via: PayVia } | undefined> {
  try {
    const loaded = await loadPayFile(serial);
    const via = payButtonFor(loaded?.file.method);
    if (!loaded || !via || loaded.file.partner || loaded.file.status === "cancelled") return undefined;
    return { url: payLink(serial, null, via), via };
  } catch {
    return undefined;
  }
}

/** What the page shows before the press — the amount, or why not. */
export async function payPreview(
  serial: string,
  token: string | undefined,
  via: PayVia = "myfatoorah",
): Promise<{ ok: true; amount: number; currency: string } | { ok: false; why: PayRefusal }> {
  const loaded = await loadPayFile(serial);
  const d = payDecision(loaded?.file ?? null, readToken(serial, token, via), riyadhDate(), via);
  return d.ok ? { ok: true, amount: d.amount, currency: loaded!.file.currency } : d;
}

// ponytail: per-instance memory (one container on the VPS); a shared store if the app ever scales out
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
function limited(key: string, max: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return recent.length > max;
}

export type PayStart = { ok: true; url: string } | { ok: false; why: PayRefusal | "busy" | "gateway" };

/** «ادفع الآن» pressed: an invoice / a Tamara session for what is owed now (or a young one reused), kept for the job, then the gateway. */
export async function startPayNow(serial: string, token: string | undefined, ip: string, via: PayVia = "myfatoorah"): Promise<PayStart> {
  if (limited(`ip:${ip}`, 10) || limited(`serial:${serial}`, 20)) return { ok: false, why: "busy" };
  const loaded = await loadPayFile(serial);
  const d = payDecision(loaded?.file ?? null, readToken(serial, token, via), riyadhDate(), via);
  if (!d.ok || !loaded) return d.ok ? { ok: false, why: "missing" } : d;
  // Tamara knows the buyer by mobile
  if (via === "tamara" && !loaded.phone) return { ok: false, why: "noPhone" };
  const supabase = db();

  const { data: open } = await supabase
    .from("payment_links")
    .select("invoice_id, url, amount, mock, created_at")
    .eq("offer_id", loaded.offerId)
    .eq("provider", via)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);
  const links = ((open ?? []) as (Omit<OpenLink, "amount"> & { amount: number | string })[]).map((l) => ({ ...l, amount: Number(l.amount) }));
  const url = await createOrReuse(loaded, serial, d.amount, links, via);
  return url ? { ok: true, url } : { ok: false, why: "gateway" };
}

/** The gateway's own words for a refusal — to the file's seller (bell + «تنبيهاتي»), never to the client. */
async function tellFailure(loaded: Loaded, serial: string, via: PayVia, reason: string): Promise<void> {
  await logAudit({ action: "payment_link.failed", entity: "offers", entity_id: loaded.offerId, meta: { provider: via, serial, reason }, actor: { id: null, label: "pay-now" } });
  if (!loaded.employeeId) return;
  const name = via === "tamara" ? "تمارا" : "ماي فاتورة";
  const title = `تعذّر فتح ${name} للعميل على ملف ${serial}: ${reason.slice(0, 200)}`;
  await tellEmployee(db(), loaded.employeeId, title, `/offer/${encodeURIComponent(serial)}`, `pay-fail:${serial}:${via}:${reason.slice(0, 60)}`).catch(() => undefined);
}

async function createOrReuse(loaded: Loaded, serial: string, amount: number, links: OpenLink[], via: PayVia): Promise<string | null> {
  // only a real invoice is reused — a test-mode one never stands in once the key is set
  const reuse = reusableLink(links, amount, false, Date.now(), via === "tamara" ? TAMARA_REUSE_MS : REUSE_MS);
  if (reuse) return reuse.url;
  const outcome =
    via === "tamara"
      ? await tamaraSession(loaded, serial, amount)
      : await createInvoiceLink({ amount, currency: "SAR", customerName: loaded.name, customerMobile: loaded.phone, reference: serial, language: "ar" });
  if (outcome.kind !== "ok") {
    await tellFailure(loaded, serial, via, outcome.message || outcome.kind);
    return null;
  }
  const { error } = await db().from("payment_links").insert({
    offer_id: loaded.offerId,
    operation_id: loaded.operationId,
    provider: via,
    // the job asks Tamara by its order id (getOrderStatus), as the staff link keeps it
    invoice_id: "invoiceId" in outcome.data ? outcome.data.invoiceId : (outcome.data.orderId ?? outcome.data.checkoutId),
    amount,
    currency: "SAR",
    url: outcome.data.url,
    mock: outcome.data.mock,
    created_by: null,
    // the client opened it himself — nothing for anyone to send
    sent_at: new Date().toISOString(),
  });
  // a link the job would never record must not take the client's money
  if (error && error.code !== "23505") return null;
  await logAudit({
    action: "payment_link.client_opened",
    entity: "offers",
    entity_id: loaded.offerId,
    meta: { provider: via, amount, mock: outcome.data.mock, serial },
    actor: { id: null, label: "pay-now" },
  });
  return outcome.data.url;
}

/** A Tamara checkout session for this file: back to /pay/<serial>/done whatever happens there (that page records nothing). */
function tamaraSession(loaded: Loaded, serial: string, amount: number) {
  const [firstName = "", ...rest] = loaded.name.split(/\s+/);
  const done = (s: string) => `${site()}/pay/${encodeURIComponent(serial)}/done?s=${s}`;
  return createCheckout({
    amount,
    currency: "SAR",
    reference: serial,
    customer: { firstName: firstName || "—", lastName: rest.join(" "), phone: loaded.phone ?? "" },
    description: `رحلة ${serial}`,
    successUrl: done("ok"),
    failureUrl: done("fail"),
    cancelUrl: done("cancel"),
  });
}
