"use server";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { listTravelers } from "@/lib/data/operation-travelers";
import { currentCan } from "@/lib/roles/current";
import { getSupplierAdapterLogged } from "@/lib/providers/hotel-registry";
import type { BookGuest, SupplierCallRecord } from "@/lib/providers/hotel-supplier";

/**
 * Booking a room through a supplier's API — the only place in this system that
 * spends money without a human typing the amount.
 *
 * The shape of every function here follows from one asymmetry: a booking that
 * did not happen costs a phone call, and a booking that happened twice costs a
 * night's room and an apology. So every uncertain outcome resolves towards
 * "find out" rather than "try again":
 *
 *   - the row is moved to `in_flight` BEFORE the call, so a crashed request
 *     leaves a marker instead of a row that still looks untouched;
 *   - our own reference is written BEFORE the call, because TBO's recovery path
 *     (BookingDetail by BookingReferenceId, 120s later) is impossible without it;
 *   - `unreachable` never becomes `failed` — it becomes "check the status".
 *
 * Permissions split deliberately: re-checking a price is `operations.write`
 * (everyone in operations), committing is `operations.book` (whoever the owner
 * names). One is a question, the other is a purchase.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type Fail = { ok: false; error: TranslationKey };
type Blocked = { ok: false; message: string };

async function requireWrite(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return (await currentCan("operations.write")) ? null : "ops.err.forbidden";
}

async function requireBook(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return (await currentCan("operations.book")) ? null : "ops.err.forbidden";
}

/**
 * Write the call log.
 *
 * Service client: `supplier_calls` is RLS-locked with no policy, because a
 * request body carries the guest's name and phone and a response carries what we
 * pay. Failure here is swallowed — losing the log must never fail the booking it
 * describes, and the audit trail records the decision separately.
 */
async function flushCalls(sink: SupplierCallRecord[], ctx: { booking_id: string; client_reference: string | null }): Promise<void> {
  if (sink.length === 0) return;
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const createdBy = await getCurrentEmployeeId();
    await service.from("supplier_calls").insert(
      sink.map((c) => ({
        supplier_code: c.supplier_code,
        method: c.method,
        booking_id: ctx.booking_id,
        client_reference: ctx.client_reference,
        request: c.request ?? null,
        response: c.response ?? null,
        http_status: c.http_status,
        status_code: c.status_code,
        duration_ms: c.duration_ms,
        ok: c.ok,
        created_by: createdBy,
      })),
    );
  } catch {
    /* the booking is what matters; the log is best-effort */
  }
}

type BookingRow = {
  id: string;
  operation_id: string;
  kind: string;
  title: string;
  status: string;
  supplier_name: string;
  client_reference: string | null;
  supplier_booking_code: string | null;
  supplier_ref: string | null;
  confirmation_number: string | null;
  quoted_net: number | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
};

const BOOKING_COLUMNS =
  "id, operation_id, kind, title, status, supplier_name, client_reference, supplier_booking_code, supplier_ref, confirmation_number, quoted_net, currency, start_date, end_date";

async function loadBooking(bookingId: string): Promise<BookingRow | null> {
  const supabase = await db();
  const { data } = await supabase.from("operation_bookings").select(BOOKING_COLUMNS).eq("id", bookingId).maybeSingle();
  return (data as BookingRow | null) ?? null;
}

/**
 * The rate identifier to commit against.
 *
 * Prefers the code returned by the most recent PreBook (TBO re-issues it and the
 * new one is the only valid session), and falls back to the rate the offer was
 * priced from. Never invents one — no code means no machine booking, and the
 * agent uses the manual path.
 */
async function bookingCodeFor(row: BookingRow): Promise<string | null> {
  if (row.supplier_booking_code) return row.supplier_booking_code;
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("offer_hotels")
      .select("rate_key, offers!inner(operations!inner(id))")
      .eq("offers.operations.id", row.operation_id)
      .not("rate_key", "is", null)
      .limit(1)
      .maybeSingle();
    return (data as { rate_key: string | null } | null)?.rate_key ?? null;
  } catch {
    return null;
  }
}

export type PriceCheck = {
  ok: true;
  /** what the supplier will honour right now, for the whole stay. */
  total: number;
  currency: string;
  /** what we had quoted internally; null when the row was never priced. */
  previous: number | null;
  /** total - previous, rounded. Positive means it got dearer. */
  difference: number | null;
  refundable: boolean;
  cancellation_policy: string;
  cancellation_deadline: string | null;
  room_name: string;
};

/**
 * Ask the supplier what this room costs NOW, and write the answer down.
 *
 * Deliberately does not book, whatever the answer is. A price that moved is a
 * commercial decision — someone has to look at the difference and accept it, or
 * the margin quietly becomes someone else's.
 */
export async function prebookHotel(bookingId: string): Promise<PriceCheck | Fail | Blocked> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };

  const row = await loadBooking(bookingId);
  if (!row) return { ok: false, error: "ops.err.notFound" };
  if (row.kind !== "hotel") return { ok: false, message: "الحجز الآلي متاح للفنادق فقط حالياً." };
  if (row.status === "cancelled") return { ok: false, message: "هذا الحجز ملغى." };

  const code = await bookingCodeFor(row);
  if (!code) return { ok: false, message: "لا يوجد رمز سعر من المورّد لهذا الحجز — استخدم التأكيد اليدوي." };

  const sink: SupplierCallRecord[] = [];
  const adapter = await getSupplierAdapterLogged("tbo", sink);
  if (!adapter?.prebook) return { ok: false, message: "مورّد الفنادق غير مهيّأ للحجز الآلي." };

  const out = await adapter.prebook(code);
  await flushCalls(sink, { booking_id: row.id, client_reference: row.client_reference });

  if (out.kind === "unreachable") return { ok: false, message: `${out.message} — أعد المحاولة.` };
  if (out.kind === "rejected") return { ok: false, message: out.message };

  const r = out.data;
  const previous = row.quoted_net;
  const difference = previous == null ? null : Number((r.total_fare - previous).toFixed(2));

  try {
    const supabase = await db();
    await supabase
      .from("operation_bookings")
      .update({
        // The re-issued code REPLACES the old one: booking against the previous
        // session is the documented way to get a rejection at the last step.
        supplier_booking_code: r.booking_code,
        quoted_net: r.total_fare,
        currency: r.currency,
        cancellation_policy: r.cancellation_policy,
        cancellation_deadline: r.cancellation_deadline,
        source: "api",
        supplier_name: row.supplier_name || "TBO Holidays",
        // Only ever forward, and never over a booking that already exists.
        ...(row.status === "pending" || row.status === "failed" ? { status: "prebooked" } : {}),
      })
      .eq("id", row.id);
  } catch {
    return { ok: false, error: "err.db" };
  }

  await logAudit({
    action: "supplier.prebooked",
    entity: "operation_bookings",
    entity_id: row.id,
    meta: { total: r.total_fare, currency: r.currency, previous, difference },
  });

  return {
    ok: true,
    total: r.total_fare,
    currency: r.currency,
    previous,
    difference,
    refundable: r.refundable,
    cancellation_policy: r.cancellation_policy,
    cancellation_deadline: r.cancellation_deadline,
    room_name: r.room_name,
  };
}

export type BookOk = { ok: true; confirmation_number: string; total: number; currency: string };
/** The supplier may have booked it. Do NOT retry — read the status back. */
export type BookUnknown = { ok: false; unknown: true; message: string; booking_reference: string };

/**
 * Commit the reservation.
 *
 * Requires `operations.book`, a fresh PreBook, and — when the price moved — the
 * caller to pass the exact figure they saw. That last check is what stops a
 * stale screen from authorising a number nobody read.
 */
export async function bookHotel(input: {
  booking_id: string;
  /** the total the human approved. Must equal what PreBook last returned. */
  approved_total: number;
  /**
   * The names to print, as the operator confirmed them.
   *
   * Deliberately NOT read from the encrypted passports here. Those sit behind
   * `operations.passport` and every read is audited, and more importantly the
   * spelling on the voucher has to match the document the guest hands the front
   * desk — one letter apart is a family turned away. A human reads both and
   * confirms; this module does not transliterate anything.
   */
  guests: BookGuest[];
  email: string;
  phone: string;
}): Promise<BookOk | BookUnknown | Fail | Blocked> {
  const denied = await requireBook();
  if (denied) return { ok: false, error: denied };

  const row = await loadBooking(input.booking_id);
  if (!row) return { ok: false, error: "ops.err.notFound" };
  if (row.status === "confirmed") return { ok: false, message: "هذا الحجز مؤكَّد أصلاً." };
  if (row.status === "in_flight") {
    return { ok: false, message: "هناك محاولة حجز جارية لم تُحسم — استخدم «تحقق من الحالة» قبل أي إعادة." };
  }
  if (row.status !== "prebooked" || !row.supplier_booking_code) {
    return { ok: false, message: "تحقق من السعر أولاً — الحجز يتم على سعر مُعاد التحقق منه فقط." };
  }
  if (row.quoted_net == null || Math.abs(row.quoted_net - input.approved_total) > 0.01) {
    return { ok: false, message: "السعر تغيّر منذ آخر تحقق — راجع الفرق واعتمده من جديد." };
  }
  if (!input.email.trim() || !input.phone.trim()) {
    return { ok: false, message: "بريد العميل ورقمه مطلوبان — يرسل المورّد الفاوتشر عليهما." };
  }

  const guests = input.guests.filter((g) => g.first_name.trim() && g.last_name.trim());
  if (guests.length === 0) return { ok: false, message: "أدخل أسماء النزلاء بالحروف اللاتينية كما في الجواز." };
  if (guests.some((g) => /[؀-ۿ]/.test(`${g.first_name}${g.last_name}`))) {
    // The voucher is printed by the supplier and read at a foreign front desk.
    return { ok: false, message: "أسماء النزلاء يجب أن تكون لاتينية كما في الجواز، لا عربية." };
  }

  // Written BEFORE the call, and only once: TBO's recovery path needs the exact
  // reference we sent, and generating a new one on a retry would make the first
  // booking unfindable.
  const bookingReference = row.supplier_ref ?? `${Date.now()}${randomInt(1000, 9999)}`;
  const clientReference = row.client_reference ?? row.id;

  try {
    const supabase = await db();
    await supabase
      .from("operation_bookings")
      .update({ status: "in_flight", supplier_ref: bookingReference })
      .eq("id", row.id);
  } catch {
    return { ok: false, error: "err.db" };
  }

  const sink: SupplierCallRecord[] = [];
  const adapter = await getSupplierAdapterLogged("tbo", sink);
  if (!adapter?.book) {
    await setStatus(row.id, "prebooked");
    return { ok: false, message: "مورّد الفنادق غير مهيّأ للحجز الآلي." };
  }

  const out = await adapter.book({
    booking_code: row.supplier_booking_code,
    // One entry per room. TBO reads the array length as the room count, so a
    // flat guest list would book a single room for everyone.
    rooms: [{ guests }],
    client_reference: clientReference,
    booking_reference: bookingReference,
    total_fare: input.approved_total,
    email: input.email.trim(),
    phone: input.phone.replace(/[^\d]/g, ""),
  });
  await flushCalls(sink, { booking_id: row.id, client_reference: clientReference });

  if (out.kind === "unreachable") {
    // The reservation may exist. The row STAYS `in_flight` — the one state that
    // says "unknown" out loud — and the operator is pointed at the status check.
    await logAudit({
      action: "supplier.booked",
      entity: "operation_bookings",
      entity_id: row.id,
      meta: { outcome: "unknown", booking_reference: bookingReference, message: out.message },
    });
    return { ok: false, unknown: true, booking_reference: bookingReference, message: out.message };
  }

  if (out.kind === "rejected") {
    await setStatus(row.id, "failed");
    await logAudit({
      action: "supplier.booked",
      entity: "operation_bookings",
      entity_id: row.id,
      meta: { outcome: "rejected", code: out.code, message: out.message },
    });
    return { ok: false, message: out.message };
  }

  try {
    const supabase = await db();
    await supabase
      .from("operation_bookings")
      .update({
        status: "confirmed",
        confirmation_number: out.data.confirmation_number,
        net_charged: input.approved_total,
        source: "api",
      })
      .eq("id", row.id);
  } catch {
    // Booked at the supplier but not written here — the worst row to leave
    // silent. The audit entry below carries the confirmation number regardless.
    await logAudit({
      action: "supplier.booked",
      entity: "operation_bookings",
      entity_id: row.id,
      meta: { outcome: "confirmed_unsaved", confirmation_number: out.data.confirmation_number },
    });
    return { ok: false, error: "err.db" };
  }

  await logAudit({
    action: "supplier.booked",
    entity: "operation_bookings",
    entity_id: row.id,
    meta: { outcome: "confirmed", confirmation_number: out.data.confirmation_number, total: input.approved_total },
  });
  return { ok: true, confirmation_number: out.data.confirmation_number, total: input.approved_total, currency: row.currency };
}

/**
 * Read the booking back from the supplier — the recovery path.
 *
 * This is what resolves an `in_flight` row, and TBO's spec makes it mandatory
 * after a timed-out Book rather than optional. Also picks up the hotel's own
 * confirmation number, which TBO only issues once check-in is within 30 days.
 */
export async function refreshSupplierBooking(bookingId: string): Promise<
  | { ok: true; status: string; confirmation_number: string | null; hotel_confirmation_number: string | null }
  | Fail
  | Blocked
> {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };

  const row = await loadBooking(bookingId);
  if (!row) return { ok: false, error: "ops.err.notFound" };
  if (!row.confirmation_number && !row.supplier_ref) {
    return { ok: false, message: "لا رقم تأكيد ولا مرجع حجز — لا شيء نسأل عنه المورّد." };
  }

  const sink: SupplierCallRecord[] = [];
  const adapter = await getSupplierAdapterLogged("tbo", sink);
  if (!adapter?.bookingDetail) return { ok: false, message: "مورّد الفنادق غير مهيّأ للحجز الآلي." };

  const out = await adapter.bookingDetail({
    confirmation_number: row.confirmation_number ?? undefined,
    booking_reference: row.supplier_ref ?? undefined,
  });
  await flushCalls(sink, { booking_id: row.id, client_reference: row.client_reference });

  if (out.kind === "unreachable") return { ok: false, message: `${out.message} — أعد المحاولة بعد قليل.` };
  if (out.kind === "rejected") {
    // The supplier has no such booking. NOW an in-flight row can be called
    // failed, because we asked and were told — not because we gave up waiting.
    if (row.status === "in_flight") await setStatus(row.id, "failed");
    return { ok: false, message: out.message };
  }

  const d = out.data;
  const cancelled = d.status.toLowerCase().includes("cancel");
  try {
    const supabase = await db();
    await supabase
      .from("operation_bookings")
      .update({
        status: cancelled ? "cancelled" : d.confirmation_number ? "confirmed" : row.status,
        confirmation_number: d.confirmation_number ?? row.confirmation_number,
        ...(d.total_fare != null ? { net_charged: d.total_fare } : {}),
        ...(d.cancellation_policy ? { cancellation_policy: d.cancellation_policy } : {}),
        ...(d.cancellation_deadline ? { cancellation_deadline: d.cancellation_deadline } : {}),
        ...(d.hotel_confirmation_number ? { detail: { hotel_confirmation_number: d.hotel_confirmation_number } } : {}),
      })
      .eq("id", row.id);
  } catch {
    return { ok: false, error: "err.db" };
  }

  return {
    ok: true,
    status: d.status,
    confirmation_number: d.confirmation_number,
    hotel_confirmation_number: d.hotel_confirmation_number,
  };
}

/** Cancel at the supplier. Same permission as booking — it is the same money. */
export async function cancelSupplierBooking(bookingId: string): Promise<{ ok: true; message: string } | Fail | Blocked> {
  const denied = await requireBook();
  if (denied) return { ok: false, error: denied };

  const row = await loadBooking(bookingId);
  if (!row) return { ok: false, error: "ops.err.notFound" };
  if (!row.confirmation_number) return { ok: false, message: "لا يوجد رقم تأكيد — لا شيء يُلغى لدى المورّد." };
  if (row.status === "cancelled") return { ok: false, message: "ملغى أصلاً." };

  const sink: SupplierCallRecord[] = [];
  const adapter = await getSupplierAdapterLogged("tbo", sink);
  if (!adapter?.cancel) return { ok: false, message: "مورّد الفنادق غير مهيّأ للحجز الآلي." };

  const out = await adapter.cancel(row.confirmation_number);
  await flushCalls(sink, { booking_id: row.id, client_reference: row.client_reference });

  if (out.kind === "unreachable") {
    // Not cancelled as far as we know. Leaving the row untouched is the honest
    // reading: a cancellation we cannot confirm is not a cancellation.
    return { ok: false, message: `${out.message} — الحجز ما زال قائماً حتى يتأكد الإلغاء.` };
  }
  if (out.kind === "rejected") return { ok: false, message: out.message };

  try {
    const supabase = await db();
    await supabase.from("operation_bookings").update({ status: "cancelled" }).eq("id", row.id);
  } catch {
    return { ok: false, error: "err.db" };
  }

  await logAudit({
    action: "supplier.cancelled",
    entity: "operation_bookings",
    entity_id: row.id,
    meta: { confirmation_number: row.confirmation_number, message: out.data.message },
  });
  return { ok: true, message: out.data.message };
}

// ---------------------------------------------------------------- helpers ----

async function setStatus(bookingId: string, status: string): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("operation_bookings").update({ status }).eq("id", bookingId);
  } catch {
    /* the caller already has a message for the operator */
  }
}

/**
 * How many guests the file expects, and of what kind — used to pre-fill the
 * booking form so the operator is correcting spellings rather than typing a
 * list from scratch. Names are NOT included: those come from the passport, in
 * front of a human. See `bookHotel.guests`.
 */
export async function expectedGuests(operationId: string): Promise<{ id: string; label: string; child: boolean }[]> {
  const travelers = await listTravelers(operationId);
  return travelers.map((t) => ({
    id: t.id,
    label: t.display_name,
    child: t.traveler_kind === "child" || t.traveler_kind === "infant",
  }));
}
