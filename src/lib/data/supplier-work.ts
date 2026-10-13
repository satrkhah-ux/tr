"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import type { Permission } from "@/lib/roles/roles";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { confirmBookingManually } from "@/lib/data/operation-bookings";
import type { RequestDraft } from "@/lib/data/operation-assign";
import { conversationForPhone } from "@/lib/providers/teletel";
import { decryptJson, isVaultConfigured } from "@/lib/crypto/secrets";
import type { PassportView, TravelerKind } from "@/lib/operations/traveler-dto";
import { currentCan } from "@/lib/roles/current";
import {
  bookingCost,
  buildSupplierRequest,
  requestState,
  supplierBalances,
  type Money,
  type RequestLang,
  type RequestState,
  type SupplierBalance,
  type SupplierBookingKind,
} from "@/lib/operations/supplier-request";

/**
 * The supplier side of an operation (order 8): the request we send, their
 * answer, their confirmation on file, what each booking costs us, what we paid
 * them, and the balance between the two.
 *
 * Everything goes through the SERVICE client behind an explicit permission
 * check, because 0063's columns are not granted to sessions (a partner reads its
 * own bookings and must not learn whom we buy from) and money is closed to them
 * entirely (0047). Two gates:
 *   operations.write  — who handles it, the request, the answer, the papers;
 *   pricing.internal  — any figure: a booking's cost, a payment, a balance.
 */

function service(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

type Fail = { ok: false; error: TranslationKey };

async function gate(permission: Permission): Promise<TranslationKey | null> {
  if (!(await getServerUser())) return "err.session";
  return (await currentCan(permission)) ? null : permission === "operations.write" ? "ops.err.forbidden" : "err.forbidden";
}

// PostgREST returns an embedded relation as an array even when to-one.
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const BUCKET = "supplier-docs";
const MAX_BYTES = 8 * 1024 * 1024;
/** Short: a forwarded link to a supplier's paper should not outlive the look. */
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const METHODS = ["bank_transfer", "cash", "card", "other"] as const;

async function replyHours(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "supplier_reply_hours").maybeSingle();
  const n = Number((data as { value?: string } | null)?.value);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/** A PDF or a photo into the private bucket. The path never carries a name. */
async function upload(supabase: SupabaseClient, folder: string, file: FormDataEntryValue | null): Promise<{ path: string } | Fail> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ops.err.noFile" };
  if (file.size > MAX_BYTES) return { ok: false, error: "ops.err.fileTooLarge" };
  if (!(file.type === "application/pdf" || file.type.startsWith("image/"))) return { ok: false, error: "ops.sup.err.fileType" };
  const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "pdf";
  const path = `${folder}/${randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: file.type,
    upsert: false,
  });
  return up.error ? { ok: false, error: "ops.err.uploadFailed" } : { path };
}

async function signed(supabase: SupabaseClient, path: string | null): Promise<{ ok: true; url: string } | Fail> {
  if (!path) return { ok: false, error: "ops.err.noFile" };
  const res = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  return res.error || !res.data?.signedUrl ? { ok: false, error: "err.loadFailed" } : { ok: true, url: res.data.signedUrl };
}

type BookingMoneyRow = {
  quoted_net: number | null;
  net_charged: number | null;
  currency: string | null;
  origin_ref: string | null;
};

/**
 * A booking pulled from an offer's pricing line (`visa:<id>`, `transport:<id>`)
 * was seeded without a net: its cost is that line's buy. Read here, never in
 * the browser — 0039/0047 withhold the buy columns from every session.
 */
async function costsOf<T extends BookingMoneyRow>(supabase: SupabaseClient, rows: T[]): Promise<(T & { cost: Money | null })[]> {
  const lineId = (ref: string | null) => ref?.match(/^(?:visa|transport):([0-9a-f-]{36})$/)?.[1] ?? null;
  const ids = [...new Set(rows.filter((r) => r.quoted_net == null && r.net_charged == null).map((r) => lineId(r.origin_ref)).filter((x): x is string => !!x))];
  const lines = new Map<string, Money>();
  if (ids.length > 0) {
    const { data } = await supabase.from("offer_pricing_items").select("id, quantity, buy_price, buy_currency, total_buy").in("id", ids);
    for (const l of (data ?? []) as { id: string; quantity: number | null; buy_price: number | null; buy_currency: string | null; total_buy: number | null }[]) {
      const amount = l.total_buy ?? (l.buy_price != null ? Number(l.buy_price) * (l.quantity && l.quantity > 0 ? l.quantity : 1) : null);
      if (amount != null) lines.set(l.id, { amount: Number(amount), currency: l.buy_currency || "SAR" });
    }
  }
  return rows.map((r) => {
    const id = lineId(r.origin_ref);
    return { ...r, cost: bookingCost(r, id ? (lines.get(id) ?? null) : null) };
  });
}

// ---------------- the setting ----------------

/** How long a request may go unanswered before it is flagged. settings.manage. */
export async function setSupplierReplyHours(hours: number): Promise<{ ok: true } | Fail> {
  const denied = await gate("settings.manage");
  if (denied) return { ok: false, error: denied };
  if (!(Number.isFinite(hours) && hours >= 1 && hours <= 720)) return { ok: false, error: "ops.sup.err.hours" };
  try {
    const { error } = await service()
      .from("app_settings")
      .upsert({ key: "supplier_reply_hours", value: String(Math.round(hours)), updated_at: new Date().toISOString() });
    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------------- the case ----------------

export type CaseSupplier = {
  id: string;
  name: string;
  contact_name: string | null;
  /** WhatsApp when the supplier gave one, else the mobile. */
  phone: string | null;
  email: string | null;
  lang: RequestLang;
};

export type CaseBookingSupplier = {
  booking_id: string;
  supplier_id: string | null;
  state: RequestState;
  sent_at: string | null;
  has_confirmation: boolean;
  is_paid: boolean;
  /** null unless the viewer holds pricing.internal. */
  cost: Money | null;
};

export type CaseSupplierPayment = {
  id: string;
  supplier_id: string;
  booking_id: string | null;
  kind: "payment" | "refund";
  amount: number;
  currency: string;
  paid_on: string;
  method: string;
  reference: string | null;
  has_receipt: boolean;
};

export type SupplierWork = {
  /** the clock the states were read against */
  now: string;
  replyHours: number;
  canSeeCost: boolean;
  suppliers: CaseSupplier[];
  bookings: CaseBookingSupplier[];
  /** this case's payments to suppliers — empty without pricing.internal. */
  payments: CaseSupplierPayment[];
};

type SupplierRow = {
  id: string;
  arabic_name: string;
  english_name: string | null;
  contact_name: string | null;
  mobile: string | null;
  whatsapp: string | null;
  email: string | null;
  request_lang: string | null;
};

const toCaseSupplier = (s: SupplierRow): CaseSupplier => ({
  id: s.id,
  name: s.arabic_name,
  contact_name: s.contact_name,
  phone: s.whatsapp || s.mobile,
  email: s.email,
  lang: s.request_lang === "en" ? "en" : "ar",
});

export async function getSupplierWork(operationId: string): Promise<SupplierWork | null> {
  if (await gate("operations.write")) return null;
  try {
    const supabase = service();
    const canSeeCost = await currentCan("pricing.internal");
    const [bookingsRes, hours] = await Promise.all([
      supabase
        .from("operation_bookings")
        .select(
          "id, status, is_paid, assignee_supplier_id, assigned_at, request_status, request_sent_at, supplier_confirmation_path, quoted_net, net_charged, currency, origin_ref",
        )
        .eq("operation_id", operationId),
      replyHours(supabase),
    ]);
    // before 0063 the columns do not exist: no panel rather than an empty one
    if (bookingsRes.error) return null;
    type Row = BookingMoneyRow & {
      id: string;
      status: string;
      is_paid: boolean;
      assignee_supplier_id: string | null;
      assigned_at: string | null;
      request_status: string | null;
      request_sent_at: string | null;
      supplier_confirmation_path: string | null;
    };
    const rows = (bookingsRes.data ?? []) as Row[];
    const costed = canSeeCost ? await costsOf(supabase, rows) : rows.map((r) => ({ ...r, cost: null }));

    const supplierIds = [...new Set(rows.map((r) => r.assignee_supplier_id).filter((x): x is string => !!x))];
    const [suppliersRes, paymentsRes] = await Promise.all([
      supplierIds.length > 0
        ? supabase
            .from("company_suppliers")
            .select("id, arabic_name, english_name, contact_name, mobile, whatsapp, email, request_lang")
            .in("id", supplierIds)
        : Promise.resolve({ data: [] }),
      canSeeCost
        ? supabase
            .from("supplier_payments")
            .select("id, supplier_id, booking_id, kind, amount, currency, paid_on, method, reference, receipt_path")
            .eq("operation_id", operationId)
            .order("paid_on", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    const now = new Date();
    return {
      now: now.toISOString(),
      replyHours: hours,
      canSeeCost,
      suppliers: ((suppliersRes.data ?? []) as SupplierRow[]).map(toCaseSupplier),
      bookings: costed.map((r) => ({
        booking_id: r.id,
        supplier_id: r.assignee_supplier_id,
        state: requestState(r, now, hours),
        sent_at: r.request_sent_at,
        has_confirmation: Boolean(r.supplier_confirmation_path),
        is_paid: r.is_paid,
        cost: r.cost,
      })),
      payments: ((paymentsRes.data ?? []) as (Omit<CaseSupplierPayment, "has_receipt"> & { receipt_path: string | null })[]).map(
        ({ receipt_path, ...p }) => ({ ...p, amount: Number(p.amount), has_receipt: Boolean(receipt_path) }),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Compose the request for whoever the booking is handed to — in a supplier's
 * own language, with the names as in the passport.
 *
 * Returned for REVIEW, never sent here. The names are decrypted only for a
 * viewer who may read passports, and every one read is written to the audit
 * log first, exactly as opening the passport would be; without that, or
 * without the vault, the request carries the names as typed on the case.
 * The passport NUMBER never leaves: a supplier books a name, not a document.
 */
export async function composeRequest(bookingId: string): Promise<{ ok: true; draft: RequestDraft } | Fail> {
  const denied = await gate("operations.write");
  if (denied) return { ok: false, error: denied };

  try {
    const supabase = service();
    const read = (columns: string) => supabase.from("operation_bookings").select(columns).eq("id", bookingId).maybeSingle();
    const base =
      "id, operation_id, kind, title, city_name, start_date, end_date, detail, handoff_note, assignee_kind, employees:assignee_employee_id(arabic_name, mobile), booking_partners:assignee_partner_id(name, phone, whatsapp, email, contact_name), operations(offers(serial, customers(arabic_name)))";
    let { data, error } = await read(`${base}, company_suppliers:assignee_supplier_id(arabic_name, contact_name, mobile, whatsapp, email, request_lang)`);
    // until 0063 is applied there is no supplier to embed — colleagues and partners still get their request
    if (error) ({ data, error } = await read(base));
    if (error || !data) return { ok: false, error: "ops.err.notFound" };

    type Contact = { name?: string; arabic_name?: string | null; contact_name?: string | null; mobile?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; request_lang?: string | null };
    const row = data as unknown as {
      operation_id: string;
      kind: SupplierBookingKind;
      title: string;
      city_name: string;
      start_date: string | null;
      end_date: string | null;
      detail: Record<string, string> | null;
      handoff_note: string | null;
      assignee_kind: string;
      employees: Contact | Contact[] | null;
      booking_partners: Contact | Contact[] | null;
      company_suppliers?: Contact | Contact[] | null;
      operations: { offers: unknown } | { offers: unknown }[] | null;
    };
    const offer = one(one(row.operations)?.offers as { serial: string; customers: unknown } | { serial: string; customers: unknown }[] | null);
    const customer = one(offer?.customers as { arabic_name: string | null } | { arabic_name: string | null }[] | null);

    const to =
      row.assignee_kind === "supplier"
        ? one(row.company_suppliers)
        : row.assignee_kind === "partner"
          ? one(row.booking_partners)
          : row.assignee_kind === "employee"
            ? one(row.employees)
            : null;
    const to_label = to ? (to.arabic_name ?? to.name ?? "—") : "قسم العمليات";
    const to_phone = to ? (to.whatsapp || to.mobile || to.phone || null) : null;
    const lang: RequestLang = row.assignee_kind === "supplier" && to?.request_lang === "en" ? "en" : "ar";

    // ---- the names, as in the passport where we may read them ----
    const { data: trs } = await supabase
      .from("operation_travelers")
      .select("id, display_name, traveler_kind, passport_encrypted")
      .eq("operation_id", row.operation_id)
      .order("sort", { ascending: true });
    const travelers = (trs ?? []) as { id: string; display_name: string; traveler_kind: TravelerKind; passport_encrypted: string | null }[];
    const mayRead = isVaultConfigured() && (await currentCan("operations.passport"));
    const named = await Promise.all(
      travelers.map(async (t) => {
        if (!mayRead || !t.passport_encrypted) return { name: t.display_name, kind: t.traveler_kind };
        const logged = await logAudit({
          action: "passport.viewed",
          entity: "operation_travelers",
          entity_id: t.id,
          meta: { operation_id: row.operation_id, booking_id: bookingId, purpose: "supplier_request", fields: ["full_name"] },
        });
        const full = logged ? decryptJson<PassportView>(t.passport_encrypted)?.full_name?.trim() : "";
        return { name: full || t.display_name, kind: t.traveler_kind };
      }),
    );
    // no travelers on the case yet: the booking name is better than none
    if (named.length === 0 && customer?.arabic_name) named.push({ name: customer.arabic_name, kind: "adult" });

    // ---- the catalogue's English names, for a request in English ----
    const glossary: Record<string, string> = {};
    if (lang === "en") {
      const detail = row.detail ?? {};
      const cityNames = [...new Set([row.city_name, detail["المدينة"]].map((c) => c?.trim()).filter((c): c is string => !!c))];
      const [cities, hotels] = await Promise.all([
        cityNames.length > 0 ? supabase.from("cities").select("arabic_name, english_name").in("arabic_name", cityNames) : Promise.resolve({ data: [] }),
        row.kind === "hotel" && row.title.trim()
          ? supabase.from("hotels").select("arabic_name, english_name").eq("arabic_name", row.title.trim()).limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      for (const r of [...((cities.data ?? []) as { arabic_name: string; english_name: string | null }[]), ...((hotels.data ?? []) as { arabic_name: string; english_name: string | null }[])]) {
        if (r.english_name?.trim()) glossary[r.arabic_name.trim()] = r.english_name.trim();
      }
    }

    const { subject, body } = buildSupplierRequest({
      lang,
      reference: offer?.serial ?? "",
      contact: to?.contact_name ?? null,
      booking: {
        kind: row.kind,
        title: row.title,
        city_name: row.city_name,
        start_date: row.start_date,
        end_date: row.end_date,
        detail: row.detail ?? {},
      },
      travelers: named,
      note: row.handoff_note,
      glossary,
    });

    const conversationId = to_phone ? await conversationForPhone(to_phone) : null;
    return {
      ok: true,
      draft: { to_label, to_phone, to_email: to?.email ?? null, subject, body, canSendWhatsapp: conversationId !== null },
    };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The supplier said no. The booking stays open for someone else to take. */
export async function declineSupplierRequest(bookingId: string): Promise<{ ok: true } | Fail> {
  const denied = await gate("operations.write");
  if (denied) return { ok: false, error: denied };
  try {
    const { error } = await service()
      .from("operation_bookings")
      .update({ request_status: "declined", request_answered_at: new Date().toISOString() })
      .eq("id", bookingId)
      .neq("status", "confirmed");
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "dispatch.sent", entity: "operation_bookings", entity_id: bookingId, meta: { reply: "declined" } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * «تأكيد الكل»: one answer from a supplier covering several of its bookings —
 * a DMC confirms three tours under one reference. Each goes through the same
 * confirmation as a single one (number required, audited, the salesperson told).
 */
export async function confirmSupplierBookings(input: {
  supplier_id: string;
  booking_ids: string[];
  confirmation_number: string;
}): Promise<{ ok: true; confirmed: number } | Fail> {
  const denied = await gate("operations.write");
  if (denied) return { ok: false, error: denied };
  if (!input.confirmation_number.trim()) return { ok: false, error: "ops.err.confirmationRequired" };
  try {
    const { data } = await service()
      .from("operation_bookings")
      .select("id")
      .in("id", input.booking_ids)
      .eq("assignee_supplier_id", input.supplier_id)
      .not("status", "in", "(confirmed,cancelled)");
    let confirmed = 0;
    for (const { id } of (data ?? []) as { id: string }[]) {
      const res = await confirmBookingManually({ booking_id: id, confirmation_number: input.confirmation_number });
      if (!res.ok) return res;
      confirmed += 1;
    }
    return { ok: true, confirmed };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The supplier's own confirmation (PDF/photo), filed on one booking or on all it covers. */
export async function attachSupplierConfirmation(formData: FormData): Promise<{ ok: true } | Fail> {
  const denied = await gate("operations.write");
  if (denied) return { ok: false, error: denied };
  const ids = String(formData.get("booking_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "ops.err.notFound" };
  try {
    const supabase = service();
    const { data } = await supabase.from("operation_bookings").select("id, operation_id").in("id", ids);
    const rows = (data ?? []) as { id: string; operation_id: string }[];
    // one paper belongs to one case
    if (rows.length === 0 || new Set(rows.map((r) => r.operation_id)).size !== 1) return { ok: false, error: "ops.err.notFound" };

    const up = await upload(supabase, `confirmations/${rows[0].operation_id}`, formData.get("file"));
    if ("ok" in up) return up;
    const { error } = await supabase
      .from("operation_bookings")
      .update({ supplier_confirmation_path: up.path })
      .in("id", rows.map((r) => r.id));
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({
      action: "booking.confirmed",
      entity: "operations",
      entity_id: rows[0].operation_id,
      meta: { supplier_confirmation: true, bookings: rows.map((r) => r.id) },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function getSupplierConfirmationUrl(bookingId: string): Promise<{ ok: true; url: string } | Fail> {
  const denied = await gate("operations.write");
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = service();
    const { data } = await supabase.from("operation_bookings").select("supplier_confirmation_path").eq("id", bookingId).maybeSingle();
    return await signed(supabase, (data as { supplier_confirmation_path: string | null } | null)?.supplier_confirmation_path ?? null);
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------------- money: pricing.internal ----------------

/**
 * What the supplier actually charged for one booking — when it differs from the
 * offer's buy, or a booking typed by hand has none. Stored as net_charged, the
 * column the manual and the API confirmations already write it to.
 */
export async function setBookingCost(input: { booking_id: string; amount: number | null; currency: string }): Promise<{ ok: true } | Fail> {
  const denied = await gate("pricing.internal");
  if (denied) return { ok: false, error: denied };
  if (input.amount != null && !(Number.isFinite(input.amount) && input.amount >= 0)) return { ok: false, error: "ops.err.amountPositive" };
  try {
    const { error } = await service()
      .from("operation_bookings")
      .update({ net_charged: input.amount == null ? null : Math.round(input.amount * 100) / 100, currency: input.currency.trim().toUpperCase() || "SAR" })
      .eq("id", input.booking_id);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "booking.created", entity: "operation_bookings", entity_id: input.booking_id, meta: { edited: ["net_charged"] } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * «صدرت/سُددت» as money: a payment to the supplier (or a refund from it) with
 * its amount, day, method and receipt. Paying for bookings also marks them paid
 * — the switch the voucher's warning band reads.
 */
export async function recordSupplierPayment(formData: FormData): Promise<{ ok: true } | Fail> {
  const denied = await gate("pricing.internal");
  if (denied) return { ok: false, error: denied };

  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const supplierId = text("supplier_id");
  const kind = text("kind") === "refund" ? "refund" : "payment";
  const amount = Number(text("amount"));
  const method = text("method");
  const paidOn = text("paid_on") || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const bookingIds = text("booking_ids").split(",").map((s) => s.trim()).filter(Boolean);
  if (!supplierId) return { ok: false, error: "ops.err.pickAssignee" };
  if (!(Number.isFinite(amount) && amount > 0)) return { ok: false, error: "ops.err.amountPositive" };
  if (!METHODS.includes(method as (typeof METHODS)[number])) return { ok: false, error: "ops.sup.err.method" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: "ops.sup.err.date" };

  try {
    const supabase = service();
    // only this supplier's bookings — a payment cannot settle someone else's
    const { data } = bookingIds.length > 0
      ? await supabase.from("operation_bookings").select("id, operation_id").in("id", bookingIds).eq("assignee_supplier_id", supplierId)
      : { data: [] };
    const covered = (data ?? []) as { id: string; operation_id: string }[];
    const operationId = text("operation_id") || covered[0]?.operation_id || null;

    const file = formData.get("file");
    let receiptPath: string | null = null;
    if (file instanceof File && file.size > 0) {
      const up = await upload(supabase, `receipts/${supplierId}`, file);
      if ("ok" in up) return up;
      receiptPath = up.path;
    }

    const { data: inserted, error } = await supabase
      .from("supplier_payments")
      .insert({
        supplier_id: supplierId,
        operation_id: operationId,
        booking_id: covered.length === 1 ? covered[0].id : null,
        kind,
        amount: Math.round(amount * 100) / 100,
        currency: text("currency").toUpperCase() || "SAR",
        paid_on: paidOn,
        method,
        reference: text("reference") || null,
        receipt_path: receiptPath,
        note: text("note") || null,
        created_by: await getCurrentEmployeeId(),
      })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false, error: "err.createFailed" };

    if (kind === "payment" && covered.length > 0) {
      await supabase
        .from("operation_bookings")
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .in("id", covered.map((b) => b.id));
    }
    // the amount stays out of the log: audit_logs is read more widely than cost is
    await logAudit({
      action: "payment.recorded",
      entity: "supplier_payments",
      entity_id: (inserted as { id: string }).id,
      meta: { supplier_id: supplierId, kind, bookings: covered.map((b) => b.id) },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function getSupplierReceiptUrl(paymentId: string): Promise<{ ok: true; url: string } | Fail> {
  const denied = await gate("pricing.internal");
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = service();
    const { data } = await supabase.from("supplier_payments").select("receipt_path").eq("id", paymentId).maybeSingle();
    return await signed(supabase, (data as { receipt_path: string | null } | null)?.receipt_path ?? null);
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------------- the supplier's page ----------------

export type SupplierAccountBooking = {
  id: string;
  operation_id: string;
  serial: string;
  kind: SupplierBookingKind;
  title: string;
  start_date: string | null;
  status: string;
  is_paid: boolean;
  cost: Money | null;
};

export type SupplierAccount = {
  supplier: CaseSupplier & { name_en: string | null; categories: string };
  bookings: SupplierAccountBooking[];
  payments: CaseSupplierPayment[];
  balances: SupplierBalance[];
};

export type SupplierAccountSummary = { id: string; name: string; categories: string; balances: SupplierBalance[] };

type AccountBookingRow = BookingMoneyRow & {
  id: string;
  operation_id: string;
  assignee_supplier_id: string;
  kind: SupplierBookingKind;
  title: string;
  start_date: string | null;
  status: string;
  is_paid: boolean;
  operations: { offers: unknown } | { offers: unknown }[] | null;
};

/** What a supplier is owed: the cost of its bookings it confirmed. Pending ones are not a debt yet. */
const owedOf = (rows: (AccountBookingRow & { cost: Money | null })[]) =>
  rows.filter((r) => r.status === "confirmed" && r.cost).map((r) => r.cost as Money);

async function accountRows(supabase: SupabaseClient, supplierId: string | null) {
  let bq = supabase
    .from("operation_bookings")
    .select("id, operation_id, assignee_supplier_id, kind, title, start_date, status, is_paid, quoted_net, net_charged, currency, origin_ref, operations(offers(serial))")
    .not("assignee_supplier_id", "is", null)
    .neq("status", "cancelled")
    .order("start_date", { ascending: false, nullsFirst: false });
  let pq = supabase
    .from("supplier_payments")
    .select("id, supplier_id, booking_id, kind, amount, currency, paid_on, method, reference, receipt_path")
    .order("paid_on", { ascending: false });
  if (supplierId) {
    bq = bq.eq("assignee_supplier_id", supplierId);
    pq = pq.eq("supplier_id", supplierId);
  }
  const [b, p] = await Promise.all([bq, pq]);
  const bookings = await costsOf(supabase, (b.data ?? []) as AccountBookingRow[]);
  const payments = ((p.data ?? []) as (Omit<CaseSupplierPayment, "has_receipt"> & { receipt_path: string | null })[]).map(
    ({ receipt_path, ...x }) => ({ ...x, amount: Number(x.amount), has_receipt: Boolean(receipt_path) }),
  );
  return { bookings, payments };
}

/** Every supplier with its balance — the list a manager settles from — and the reply window. */
export async function listSupplierAccounts(): Promise<{ suppliers: SupplierAccountSummary[]; replyHours: number } | null> {
  if (await gate("pricing.internal")) return null;
  try {
    const supabase = service();
    const [suppliersRes, { bookings, payments }, hours] = await Promise.all([
      supabase.from("company_suppliers").select("id, arabic_name, categories, status").order("arabic_name"),
      accountRows(supabase, null),
      replyHours(supabase),
    ]);
    const suppliers = ((suppliersRes.data ?? []) as { id: string; arabic_name: string; categories: string | null; status: string | null }[])
      .map((s) => ({
        s,
        balances: supplierBalances(
          owedOf(bookings.filter((b) => b.assignee_supplier_id === s.id)),
          payments.filter((p) => p.supplier_id === s.id),
        ),
      }))
      // a disabled supplier still shows while money is open with it
      .filter(({ s, balances }) => s.status !== "Disabled" || balances.some((b) => b.balance !== 0))
      .map(({ s, balances }) => ({ id: s.id, name: s.arabic_name, categories: s.categories ?? "", balances }));
    return { suppliers, replyHours: hours };
  } catch {
    return null;
  }
}

export async function getSupplierAccount(supplierId: string): Promise<SupplierAccount | null> {
  if (await gate("pricing.internal")) return null;
  try {
    const supabase = service();
    const [supRes, { bookings, payments }] = await Promise.all([
      supabase
        .from("company_suppliers")
        .select("id, arabic_name, english_name, categories, contact_name, mobile, whatsapp, email, request_lang")
        .eq("id", supplierId)
        .maybeSingle(),
      accountRows(supabase, supplierId),
    ]);
    const s = supRes.data as (SupplierRow & { categories: string | null }) | null;
    if (!s) return null;
    return {
      supplier: { ...toCaseSupplier(s), name_en: s.english_name, categories: s.categories ?? "" },
      bookings: bookings.map((b) => ({
        id: b.id,
        operation_id: b.operation_id,
        serial: one(one(b.operations)?.offers as { serial: string } | { serial: string }[] | null)?.serial ?? "",
        kind: b.kind,
        title: b.title,
        start_date: b.start_date,
        status: b.status,
        is_paid: b.is_paid,
        cost: b.cost,
      })),
      payments,
      balances: supplierBalances(owedOf(bookings), payments),
    };
  } catch {
    return null;
  }
}
