import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { issuedDraftData } from "@/lib/data/issued-draft";
import { logAudit } from "@/lib/data/audit";
import { caseTotal, paidTotal, riyadhDate } from "@/lib/operations/payments";
import { createInvoiceLink } from "@/lib/providers/myfatoorah";
import { isPayMethod } from "./methods";
import { payDecision, reusableLink, showsPayNow, type OpenLink, type PayFile, type PayRefusal } from "./pay-now-rules";
import { readAmount, signAmount } from "./pay-token";

/**
 * «ادفع الآن» (the owner, 2026-10-29). The client's PDF and page point at OUR stable page /pay/<serial> — a
 * MyFatoorah invoice expires, our link does not. Pressing «ادفع الآن» there makes the invoice for what is owed on
 * the file NOW (the latest published version, or the case's agreed price), or reuses a young one of the same
 * amount, keeps it in payment_links (the 10-minute job records it once paid) and sends the client to MyFatoorah.
 * Service role throughout: the page has no session and the serial is the only thing it is told.
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

/** The stable link: bare for the PDF's button, `?a=` with a server-signed amount for a deposit or an instalment. */
export function payLink(serial: string, amount?: number | null): string {
  const base = `${site()}/pay/${encodeURIComponent(serial)}`;
  return amount && amount > 0 && secret() ? `${base}?a=${signAmount(secret(), serial, amount)}` : base;
}

/** For the client's PDF and page: the button only when the client's way is MyFatoorah (link / card) and the file is ours. */
export async function payNowUrl(serial: string): Promise<string | undefined> {
  try {
    const loaded = await loadPayFile(serial);
    if (!loaded || loaded.file.partner || loaded.file.status === "cancelled" || !showsPayNow(loaded.file.method)) return undefined;
    return payLink(serial);
  } catch {
    return undefined;
  }
}

/** What the page shows before the press — the amount, or why not. */
export async function payPreview(serial: string, token: string | undefined): Promise<{ ok: true; amount: number; currency: string } | { ok: false; why: PayRefusal }> {
  const loaded = await loadPayFile(serial);
  const d = payDecision(loaded?.file ?? null, token === undefined ? undefined : readAmount(secret(), serial, token), riyadhDate());
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

/** «ادفع الآن» pressed: an invoice for what is owed now (or a young one reused), kept for the job, then MyFatoorah. */
export async function startPayNow(serial: string, token: string | undefined, ip: string): Promise<PayStart> {
  if (limited(`ip:${ip}`, 10) || limited(`serial:${serial}`, 20)) return { ok: false, why: "busy" };
  const loaded = await loadPayFile(serial);
  const d = payDecision(loaded?.file ?? null, token === undefined ? undefined : readAmount(secret(), serial, token), riyadhDate());
  if (!d.ok || !loaded) return d.ok ? { ok: false, why: "missing" } : d;
  const supabase = db();

  const { data: open } = await supabase
    .from("payment_links")
    .select("invoice_id, url, amount, mock, created_at")
    .eq("offer_id", loaded.offerId)
    .eq("provider", "myfatoorah")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);
  const links = ((open ?? []) as (Omit<OpenLink, "amount"> & { amount: number | string })[]).map((l) => ({ ...l, amount: Number(l.amount) }));
  const url = await createOrReuse(loaded, serial, d.amount, links);
  return url ? { ok: true, url } : { ok: false, why: "gateway" };
}

async function createOrReuse(loaded: Loaded, serial: string, amount: number, links: OpenLink[]): Promise<string | null> {
  // only a real invoice is reused — a test-mode one never stands in once the key is set
  const reuse = reusableLink(links, amount, false);
  if (reuse) return reuse.url;
  const outcome = await createInvoiceLink({ amount, currency: "SAR", customerName: loaded.name, customerMobile: loaded.phone, reference: serial, language: "ar" });
  if (outcome.kind !== "ok") return null;
  const { error } = await db().from("payment_links").insert({
    offer_id: loaded.offerId,
    operation_id: loaded.operationId,
    provider: "myfatoorah",
    invoice_id: outcome.data.invoiceId,
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
    meta: { provider: "myfatoorah", amount, mock: outcome.data.mock, serial },
    actor: { id: null, label: "pay-now" },
  });
  return outcome.data.url;
}
