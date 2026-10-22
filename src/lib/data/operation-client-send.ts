"use server";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { gateOperation } from "@/lib/operations/access";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { clientWhatsappAllowed, greeting, messageClient, type ClientSendResult, type OfferClient } from "@/lib/data/client-whatsapp";
import { clientSummaryMessage, type SummaryBooking } from "@/lib/operations/client-summary";
import { paidTotal, remainingBalance } from "@/lib/operations/payments";
import { hotelAtRisk, preparedMessages, type PreparedMessage, type StayKey } from "@/lib/operations/client-booking-state";
import { waParams } from "@/lib/operations/client-messages";

/**
 * «أرسل للعميل» inside the operations file (operations order 6) — like «أرسل
 * للسائق»: a ready message drafted from the file, read and edited by the agent,
 * sent when they press «إرسال». It leaves through messageClient — Teletel, the
 * client's own thread, and the app_settings `client_whatsapp` gate — never past
 * it. The client's mobile is the file's, never the browser's; a partner's
 * client is never written to. What went out is kept in operation_dispatches
 * and the case's activity log.
 */

type Fail = { ok: false; error: TranslationKey };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Why a file's client cannot be written to, in the agent's words. */
const BLOCKED: Record<Exclude<ClientSendResult, "sent" | "template" | "window">, TranslationKey> = {
  partner: "ops.err.clientPartner",
  off: "ops.err.clientOff",
  not_allowed: "ops.err.clientNotAllowed",
  no_phone: "ops.err.clientNoPhone",
  unreachable: "ops.err.clientUnreachable",
};

type CaseOffer = OfferClient & { serial: string; destination: string | null; total: number | null; currency: string | null };
type CaseClient = { offer: CaseOffer; token: string | null; travel_start: string | null; bookings: SummaryBooking[]; paid: number };
type OfferRow = Omit<CaseOffer, "customer"> & { customers: OfferClient["customer"] | OfferClient["customer"][] };

/** The file as the message needs it — service role, after gateOperation. */
async function loadCase(service: SupabaseClient, operationId: string): Promise<CaseClient | null> {
  const { data } = await service
    .from("operations")
    .select("id, client_token, client_token_revoked_at, travel_start, offers(serial, destination, total, currency, employee_id, partner_company_id, customers(arabic_name, mobile))")
    .eq("id", operationId)
    .maybeSingle();
  const op = data as unknown as {
    client_token: string | null;
    client_token_revoked_at: string | null;
    travel_start: string | null;
    offers: OfferRow | OfferRow[] | null;
  } | null;
  const offer = one(op?.offers);
  if (!op || !offer) return null;
  const [bookingsRes, paymentsRes] = await Promise.all([
    service
      .from("operation_bookings")
      .select("id, kind, title, city_name, start_date, end_date, status, confirmation_number, company_ref, pnr, ticket_numbers, flight_legs, is_paid, detail")
      .eq("operation_id", operationId),
    service.from("operation_payments").select("amount, kind").eq("operation_id", operationId),
  ]);
  // the link the message points at — minted if the agent never opened it; a stopped link stays stopped
  let token = op.client_token && !op.client_token_revoked_at ? op.client_token : null;
  if (!token && !op.client_token_revoked_at && !offer.partner_company_id) {
    token = randomBytes(24).toString("base64url");
    const { error } = await service.from("operations").update({ client_token: token }).eq("id", operationId);
    if (error) token = null;
  }
  const { customers, ...rest } = offer;
  return {
    offer: { ...rest, customer: one(customers) },
    token,
    travel_start: op.travel_start,
    bookings: (bookingsRes.data ?? []) as SummaryBooking[],
    paid: paidTotal(((paymentsRes.data ?? []) as { amount: number | string; kind: string }[]).map((p) => ({ amount: Number(p.amount) || 0, kind: p.kind }))),
  };
}

const site = () => (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");

/**
 * The updates ready for the client (client-booking-state.ts) — worked out from
 * the file each time, each gone once it was dispatched (operation_dispatches
 * keeps its key). Prepared only: nothing leaves until staff press «إرسال».
 */
async function prepared(service: SupabaseClient, operationId: string, c: CaseClient): Promise<PreparedMessage[]> {
  const [sentRes, docsRes] = await Promise.all([
    // only a delivered one is gone: a text left as a note outside WhatsApp's 24 hours is offered again
    service.from("operation_dispatches").select("template").eq("operation_id", operationId).eq("audience", "client").eq("status", "sent"),
    service.from("operation_documents").select("stays:snapshot_json->bookings").eq("operation_id", operationId).eq("kind", "hotel_voucher").is("revoked_at", null),
  ]);
  return preparedMessages({
    hello: greeting(c.offer.customer?.arabic_name),
    destination: c.offer.destination,
    serial: c.offer.serial,
    link: c.token ? `${site()}/trip/${c.token}` : null,
    bookings: c.bookings,
    voucherStays: ((docsRes.data ?? []) as { stays: StayKey[] | null }[]).flatMap((d) => d.stays ?? []),
    sent: new Set(((sentRes.data ?? []) as { template: string }[]).map((d) => d.template)),
  });
}

export type PreparedList = {
  to_name: string;
  to_phone: string;
  blocked: TranslationKey | null;
  items: PreparedMessage[];
  /** the prepared keys already delivered — «أُرسل ✓» where the button was */
  delivered: string[];
  /** red: hotels still on our number alone from the day before travel (the morning alert says the same). */
  risks: string[];
};

/** «رسائل جاهزة للإرسال» on the case — and the hotels that must not wait another day. */
export async function listPreparedMessages(operationId: string): Promise<{ ok: true; list: PreparedList } | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const c = await loadCase(service, operationId);
    if (!c) return { ok: false, error: "ops.err.notFound" };
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
    const phone = c.offer.customer?.mobile?.trim() ?? "";
    const gate = await clientWhatsappAllowed(c.offer);
    const { data: went } = await service.from("operation_dispatches").select("template").eq("operation_id", operationId).eq("audience", "client").eq("status", "sent");
    return {
      ok: true,
      list: {
        delivered: [...new Set(((went ?? []) as { template: string }[]).map((d) => d.template))],
        to_name: c.offer.customer?.arabic_name ?? "",
        to_phone: phone,
        blocked: gate && gate in BLOCKED ? BLOCKED[gate as keyof typeof BLOCKED] : null,
        // a partner's client hears from the partner; no mobile, no one to send to
        items: c.offer.partner_company_id || !phone ? [] : await prepared(service, operationId, c),
        risks: c.bookings.filter((b) => hotelAtRisk(b, c.travel_start, today)).map((b) => b.title),
      },
    };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ClientDraft = {
  to_name: string;
  to_phone: string;
  body: string;
  /** set when the gate would refuse the send now — the agent may still copy the text. */
  blocked: TranslationKey | null;
};

export async function draftClientMessage(operationId: string): Promise<{ ok: true; draft: ClientDraft } | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const c = await loadCase(service, operationId);
    if (!c) return { ok: false, error: "ops.err.notFound" };
    if (c.offer.partner_company_id) return { ok: false, error: "ops.err.clientPartner" };
    const phone = c.offer.customer?.mobile?.trim() ?? "";
    if (!phone) return { ok: false, error: "ops.err.clientNoPhone" };
    const body = clientSummaryMessage({
      hello: greeting(c.offer.customer?.arabic_name),
      destination: c.offer.destination,
      serial: c.offer.serial,
      bookings: c.bookings,
      link: c.token ? `${site()}/trip/${c.token}` : null,
      remaining: remainingBalance(c.offer.total != null ? Number(c.offer.total) : null, c.paid),
      currency: c.offer.currency ?? "SAR",
    });
    const gate = await clientWhatsappAllowed(c.offer);
    return {
      ok: true,
      draft: { to_name: c.offer.customer?.arabic_name ?? "", to_phone: phone, body, blocked: gate && gate in BLOCKED ? BLOCKED[gate as keyof typeof BLOCKED] : null },
    };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Send what the agent reviewed. «window»: WhatsApp's 24 hours since the
 * client last wrote have passed — the text waits as a note on their Teletel
 * thread (messageClient), said on screen and in the log, never claimed as sent.
 * `key`: one of the prepared updates — still ready, or refused; after the 24
 * hours it travels as its approved template, and once dispatched it is no
 * longer prepared.
 */
export async function sendClientMessageNow(input: { operation_id: string; body: string; key?: string }): Promise<{ ok: true; result: "sent" | "window" } | Fail> {
  const denied = await gateOperation(input.operation_id);
  if (denied) return { ok: false, error: denied };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "ops.err.emptyMessage" };
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const c = await loadCase(service, input.operation_id);
    if (!c) return { ok: false, error: "ops.err.notFound" };
    if (c.offer.partner_company_id) return { ok: false, error: "ops.err.clientPartner" };
    const item = input.key ? (await prepared(service, input.operation_id, c)).find((m) => m.key === input.key) : undefined;
    if (input.key && !item) return { ok: false, error: "trip.status.preparedGone" };
    const fields = {
      name: c.offer.customer?.arabic_name ?? "",
      destination: c.offer.destination ?? "",
      serial: c.offer.serial,
      link: c.token ? `${site()}/trip/${c.token}` : "",
      rate_link: "",
    };
    const raw = await messageClient(
      c.offer,
      body,
      item ? { labels: ["تحديث-الحجز"], template: { key: item.template, params: waParams(item.template, fields) } } : { labels: ["ملخص-الحجوزات"] },
    );
    // «template»: it went, as the approved template's own text
    const result = raw === "template" ? "sent" : raw;
    const template = item?.key ?? "client_summary";
    if (result !== "sent" && result !== "window") return { ok: false, error: BLOCKED[result] };

    const name = c.offer.customer?.arabic_name ?? "";
    await service.from("operation_dispatches").insert({
      operation_id: input.operation_id,
      channel: "whatsapp",
      audience: "client",
      template,
      to_label: name,
      to_address: c.offer.customer?.mobile ?? null,
      body,
      status: result === "sent" ? "sent" : "failed",
      error_note: result === "window" ? "24h window — left as a note on the client's Teletel thread" : null,
      approved_by: await getCurrentEmployeeId(),
      sent_at: result === "sent" ? new Date().toISOString() : null,
    });
    await logAudit({
      action: result === "sent" ? "dispatch.sent" : "dispatch.held",
      entity: "operations",
      entity_id: input.operation_id,
      meta: { channel: "whatsapp", to: name, template },
    });
    return { ok: true, result };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
