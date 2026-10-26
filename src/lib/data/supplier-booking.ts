"use server";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { syncOperationOfBooking } from "@/lib/data/operation-sync";
import { listTravelers } from "@/lib/data/operation-travelers";
import { currentCan } from "@/lib/roles/current";
import { gateRow } from "@/lib/operations/access";
import { getEnabledHotelSuppliers, getSupplierAdapterLogged } from "@/lib/providers/hotel-registry";
import { offerHotelCity, offerHotelFor } from "@/lib/operations/seed-plan";
import { hotelIdOf } from "@/lib/operations/voucher-dto";
import { getRates } from "@/lib/data/rates-actions";
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
 * Permissions split deliberately: re-checking a price is the case's own gate
 * (anyone who may work the file), committing is `operations.book` (whoever the owner
 * names). One is a question, the other is a purchase.
 */

/**
 * Service client: a booking here runs on the supplier's net (quoted_net, the
 * offer's rate_key), which 0047 withholds from sessions. Every export is behind
 * gateRow (operations/access.ts) and, to commit, requireBook — that is the gate.
 */
async function db(): Promise<SupabaseClient> {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

type Fail = { ok: false; error: TranslationKey };
type Blocked = { ok: false; message: string };

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
  city_name: string;
  status: string;
  supplier_name: string;
  client_reference: string | null;
  supplier_booking_code: string | null;
  supplier_ref: string | null;
  confirmation_number: string | null;
  quoted_net: number | null;
  prebook_net: number | null;
  prebook_at: string | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string> | null;
};

const BOOKING_COLUMNS =
  "id, operation_id, kind, title, city_name, status, supplier_name, client_reference, supplier_booking_code, supplier_ref, confirmation_number, quoted_net, prebook_net, prebook_at, currency, start_date, end_date, detail";

/** the currency of the last price check (TBO's), kept on the row's detail — hidden from every paper (shownDetail) */
const PREBOOK_CURRENCY_KEY = "prebook_currency";

/** TBO keeps a search's session 30 minutes from the search to the Book; a price checked longer ago is asked again. */
const PRICE_FRESH_MS = 25 * 60_000;

/** a supplier's cost: who books (operations.book) or prices (pricing.internal) sees it */
async function seesCost(): Promise<boolean> {
  return (await currentCan("operations.book")) || (await currentCan("pricing.internal"));
}

/** SAR per one unit of `currency`; null when there is no rate for it */
function sarOf(amount: number | null, currency: string, sarPer: Record<string, number>): number | null {
  if (amount == null) return null;
  const c = currency.trim().toUpperCase();
  const rate = c === "SAR" ? 1 : sarPer[c];
  return rate ? Math.round(amount * rate * 100) / 100 : null;
}

/**
 * The booking's hotel at TBO: its catalogue hotel (detail.hotel_id, set at the pull) linked to a TBO code when it was
 * picked from TBO's list in /basic (hotel-search.ts pickSupplierHotel). Null: not a TBO hotel — the manual path.
 */
async function tboCodeFor(row: BookingRow): Promise<string | null> {
  const hotelId = hotelIdOf(row.detail);
  if (!hotelId) return null;
  const supabase = await db();
  const { data } = await supabase.from("hotel_content_cache").select("supplier_hotel_id").eq("supplier", "tbo").eq("internal_hotel_id", hotelId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { supplier_hotel_id: string } | null)?.supplier_hotel_id ?? null;
}

/** how many rooms the booking holds — the pull writes «عدد الغرف» */
function roomsOf(row: BookingRow): number {
  const n = Number(row.detail?.["عدد الغرف"]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

const ISO3_TO_2: Record<string, string> = {
  SAU: "SA", ARE: "AE", KWT: "KW", QAT: "QA", BHR: "BH", OMN: "OM", EGY: "EG", JOR: "JO", YEM: "YE", SYR: "SY", LBN: "LB", IRQ: "IQ",
  SDN: "SD", PSE: "PS", MAR: "MA", DZA: "DZ", TUN: "TN", LBY: "LY", IND: "IN", PAK: "PK", BGD: "BD", PHL: "PH", IDN: "ID", TUR: "TR",
  GBR: "GB", USA: "US",
};

/** a traveler's nationality as TBO wants it (ISO-2): «SA», «SAU», «سعودي» — null when unreadable */
function nationalityCode(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  if (/^[A-Za-z]{3}$/.test(s)) return ISO3_TO_2[s.toUpperCase()] ?? null;
  return /سعود/u.test(s) ? "SA" : null;
}

/** The party to ask rooms for: the case's travelers, else the offer's count. Ages from the traveler, else 8. */
async function partyOf(row: BookingRow): Promise<{ adults: number; children: number; ages: number[]; nationality: string }> {
  const travelers = await listTravelers(row.operation_id).catch(() => []);
  if (travelers.length) {
    const kids = travelers.filter((t) => t.traveler_kind === "child" || t.traveler_kind === "infant");
    // rates are priced by the lead guest's passport (TBO: never hard-code it); the riyal market when none is known
    const lead = travelers.find((t) => t.traveler_kind !== "child" && t.traveler_kind !== "infant" && nationalityCode(t.nationality));
    return {
      adults: Math.max(1, travelers.length - kids.length),
      children: kids.length,
      ages: kids.map((k) => (typeof k.age === "number" && k.age >= 0 && k.age <= 17 ? k.age : k.traveler_kind === "infant" ? 1 : 8)),
      nationality: nationalityCode(lead?.nationality) ?? "SA",
    };
  }
  const supabase = await db();
  const { data: op } = await supabase.from("operations").select("offer_id").eq("id", row.operation_id).maybeSingle();
  const offerId = (op as { offer_id: string } | null)?.offer_id;
  const { data: offer } = offerId ? await supabase.from("offers").select("adults, children, infants").eq("id", offerId).maybeSingle() : { data: null };
  const o = offer as { adults: number | null; children: number | null; infants: number | null } | null;
  const children = (o?.children ?? 0) + (o?.infants ?? 0);
  return { adults: Math.max(1, o?.adults ?? 2), children, ages: [...Array(o?.children ?? 0).fill(8), ...Array(o?.infants ?? 0).fill(1)], nationality: "SA" };
}

/**
 * What a found room was searched FOR — this booking, its dates, its hotel at TBO, its rooms. A room chosen from a
 * stale screen (the dates or the hotel edited since) no longer matches and is never priced or booked.
 */
function roomToken(rateKey: string, row: BookingRow, code: string): string {
  const secret = process.env.ADMIN_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "traveliun";
  return createHmac("sha256", `tbo-room:${secret}`).update([rateKey, row.id, row.start_date, row.end_date, code, roomsOf(row)].join("|")).digest("hex");
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type BookingRoomOption = {
  /** TBO's BookingCode — valid about 30 minutes; checked by «تحقق من السعر» before anything else */
  rate_key: string;
  /** binds this room to the booking as it was searched (roomToken) */
  token: string;
  name: string;
  rooms: string[];
  board: string;
  refundable: boolean;
  policy: string;
  /** null for whoever does not see costs */
  total: number | null;
  currency: string;
  total_sar: number | null;
};

export type BookingRooms =
  | {
      ok: true;
      options: BookingRoomOption[];
      /** what the file was sold on: the typed cost, its currency, in riyals — null for whoever does not see costs */
      typed: { amount: number | null; currency: string; sar: number | null } | null;
      party: { rooms: number; adults: number; children: number };
      /** may check a price (and so book): operations.book or pricing.internal */
      can_check: boolean;
    }
  | { ok: false; why: "not_linked" | "no_dates" | "not_enabled" | "none" | "unreachable" | "done" }
  | Fail;

/**
 * TBO's rooms for this booking, now — its hotel, dates, rooms and party (the owner, 2026-10-24: the rooms are chosen
 * at booking, not at sale). Read-only. Until TBO enables Search for our account: «not_enabled», and the manual path.
 */
export async function searchBookingRooms(bookingId: string): Promise<BookingRooms> {
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  const row = await loadBooking(bookingId);
  if (!row) return { ok: false, error: "ops.err.notFound" };
  if (row.kind !== "hotel" || ["confirmed", "in_flight", "cancelled"].includes(row.status)) return { ok: false, why: "done" };
  const code = await tboCodeFor(row);
  if (!code) return { ok: false, why: "not_linked" };
  if (!row.start_date || !row.end_date || row.end_date <= row.start_date) return { ok: false, why: "no_dates" };

  const sink: SupplierCallRecord[] = [];
  // only while TBO is switched on in «ربط مزوّدي الفنادق»
  const adapter = (await getEnabledHotelSuppliers(sink)).find((s) => s.code === "tbo") ?? null;
  if (!adapter) return { ok: false, why: "unreachable" };
  const rooms = roomsOf(row);
  const party = await partyOf(row);
  const rates = await adapter
    .searchRates({
      city: "",
      supplier_hotel_id: code,
      check_in: row.start_date,
      check_out: row.end_date,
      rooms,
      adults: party.adults,
      children: party.children,
      children_ages: party.ages,
      nationality: party.nationality,
    })
    .catch(() => []);
  await flushCalls(sink, { booking_id: row.id, client_reference: row.client_reference });
  if (!rates.length) {
    const failed = sink.find((c) => !c.ok);
    if (!failed) return { ok: false, why: "none" };
    // 500 on Search: TBO has not enabled availability for our account (2026-10-23)
    if ((failed.status_code ?? failed.http_status ?? 0) >= 500) return { ok: false, why: "not_enabled" };
    return { ok: false, why: failed.status_code === 201 ? "none" : "unreachable" };
  }
  const costs = await seesCost();
  const { sarPer } = await getRates();
  return {
    ok: true,
    can_check: costs,
    party: { rooms, adults: party.adults, children: party.children },
    typed: costs ? { amount: row.quoted_net, currency: row.currency, sar: sarOf(row.quoted_net, row.currency, sarPer) } : null,
    options: rates
      .slice()
      .sort((a, b) => a.inclusive - b.inclusive)
      .slice(0, 20)
      .map((r) => ({
        rate_key: r.rate_key,
        token: roomToken(r.rate_key, row, code),
        name: r.room_category_raw,
        rooms: r.room_category_raw.split(" + ").map((x) => x.trim()).filter(Boolean),
        board: r.board_type,
        refundable: r.refundable,
        policy: r.cancellation_policy,
        total: costs ? r.inclusive : null,
        currency: r.currency,
        total_sar: costs ? sarOf(r.inclusive, r.currency, sarPer) : null,
      })),
  };
}

async function loadBooking(bookingId: string): Promise<BookingRow | null> {
  const supabase = await db();
  const { data } = await supabase.from("operation_bookings").select(BOOKING_COLUMNS).eq("id", bookingId).maybeSingle();
  return (data as BookingRow | null) ?? null;
}

/**
 * The daily TBO sweep's candidates (tbo-sweep.ts): hotel bookings that hold a
 * reference to ask TBO about, on cases whose travel is not behind us. Service
 * client — the sweep runs with no session; its route's secret is the gate.
 */
export async function listSweepBookings(today: string, operationId?: string): Promise<{ row: BookingRow; operation_id: string }[]> {
  const supabase = await db();
  let query = supabase
    .from("operation_bookings")
    .select(`${BOOKING_COLUMNS}, operations!inner(travel_end, execution_status)`)
    .eq("kind", "hotel")
    .in("status", ["confirmed", "in_flight", "prebooked"])
    .or("supplier_ref.not.is.null,confirmation_number.not.is.null")
    .gte("operations.travel_end", today)
    .neq("operations.execution_status", "cancelled")
    .limit(100);
  if (operationId) query = query.eq("operation_id", operationId);
  const { data } = await query;
  type R = BookingRow & { operations: unknown };
  return (((data ?? []) as R[]) ?? [])
    .filter((r) => r.supplier_ref || r.client_reference)
    .map(({ operations: _ops, ...row }) => ({ row: row as BookingRow, operation_id: row.operation_id }));
}

/**
 * The rate identifier to commit against.
 *
 * Prefers the code returned by the most recent PreBook (TBO re-issues it and the
 * new one is the only valid session), and falls back to the rate the offer was
 * priced from — for THIS booking's hotel: its catalogue hotel (else its name) on
 * its own dates, in its own city (offerHotelFor). It used to take the first
 * priced hotel of the offer for any booking, and the price check then wrote that
 * other hotel's rate over this one. Never invents one, never borrows one: no
 * line of its own means no machine booking, and the agent uses the manual path.
 */
async function bookingCodeFor(row: BookingRow): Promise<string | null> {
  if (row.supplier_booking_code) return row.supplier_booking_code;
  try {
    const supabase = await db();
    const { data: op } = await supabase.from("operations").select("offer_id").eq("id", row.operation_id).maybeSingle();
    const offerId = (op as { offer_id: string } | null)?.offer_id;
    if (!offerId) return null;
    const [linesRes, citiesRes] = await Promise.all([
      supabase.from("offer_hotels").select("hotel_id, offer_city_id, hotel_name, check_in, check_out, rate_key").eq("offer_id", offerId).not("rate_key", "is", null),
      supabase.from("offer_cities").select("id, city_name, check_in, check_out, hotel_name").eq("offer_id", offerId),
    ]);
    type Line = { hotel_id: string | null; offer_city_id: string | null; hotel_name: string | null; check_in: string | null; check_out: string | null; rate_key: string };
    const cities = (citiesRes.data ?? []) as { id: string; city_name: string; check_in: string | null; check_out: string | null; hotel_name: string | null }[];
    const lines = ((linesRes.data ?? []) as Line[]).map((l) => ({ ...l, city: offerHotelCity(l, cities) }));
    return offerHotelFor(row, lines)?.rate_key ?? null;
  } catch {
    return null;
  }
}

export type PriceCheck = {
  ok: true;
  /** what the supplier will honour right now, for the whole stay — exactly as TBO sent it. */
  total: number;
  currency: string;
  /** what we had quoted internally (the typed cost), in its own currency; null when the row was never priced. */
  previous: number | null;
  previous_currency: string;
  /** both in riyals, and their difference — positive means it got dearer; null when a currency has no rate. */
  total_sar: number | null;
  previous_sar: number | null;
  difference: number | null;
  refundable: boolean;
  cancellation_policy: string;
  cancellation_deadline: string | null;
  room_name: string;
  /** one name per room, the room count TBO priced */
  rooms: string[];
  /** paid at the hotel / included, and the rate's norms — shown before «احجز» (TBO's own rule) */
  supplements: string[];
  conditions: string[];
  /** this check's moment: «احجز» books THIS check only — another check since (another screen, a colleague) refuses it */
  checked_at: string;
};

/**
 * Ask the supplier what this room costs NOW, and write the answer down.
 *
 * Deliberately does not book, whatever the answer is. A price that moved is a
 * commercial decision — someone has to look at the difference and accept it, or
 * the margin quietly becomes someone else's.
 */
export async function prebookHotel(bookingId: string, rateKey?: string | null, token?: string | null): Promise<PriceCheck | Fail | Blocked> {
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  // the answer is a supplier's cost
  if (!(await seesCost())) return { ok: false, error: "ops.err.forbidden" };
  if (rateKey != null && (typeof rateKey !== "string" || !rateKey.trim() || rateKey.length > 600)) return { ok: false, message: "اختر غرفة من نتيجة البحث." };

  const row = await loadBooking(bookingId);
  if (!row) return { ok: false, error: "ops.err.notFound" };
  if (row.kind !== "hotel") return { ok: false, message: "الحجز الآلي متاح للفنادق فقط حالياً." };
  // a booked or in-flight row is never re-priced from a stale screen
  if (["confirmed", "in_flight", "cancelled"].includes(row.status)) return { ok: false, message: "هذا الحجز مؤكَّد أو قيد الحجز أو ملغى." };

  // a room chosen from TBO's answer — for THIS booking as it is now (roomToken) — else the code the offer was priced on
  const ours = await tboCodeFor(row);
  if (rateKey?.trim()) {
    if (!ours || !token || !sameToken(token, roomToken(rateKey.trim(), row, ours))) {
      return { ok: false, message: "تغيّر الحجز (التواريخ أو الفندق أو الغرف) منذ البحث — ابحث عن الغرف من جديد." };
    }
  }
  const code = rateKey?.trim() || (await bookingCodeFor(row));
  // refused, and said why: no priced line of the offer is this hotel on these dates — another's is never used
  if (!code) return { ok: false, error: "ops.err.rateNoMatch" };

  const sink: SupplierCallRecord[] = [];
  const adapter = await getSupplierAdapterLogged("tbo", sink);
  if (!adapter?.prebook) return { ok: false, message: "مورّد الفنادق غير مهيّأ للحجز الآلي." };

  const out = await adapter.prebook(code);
  await flushCalls(sink, { booking_id: row.id, client_reference: row.client_reference });

  if (out.kind === "unreachable") return { ok: false, message: `${out.message} — أعد المحاولة.` };
  if (out.kind === "rejected") return { ok: false, message: out.message };

  const r = out.data;
  // its rate must be THIS booking's hotel, never another's
  if (ours && r.hotel_code && r.hotel_code !== ours) return { ok: false, message: "هذا السعر لفندق آخر — ابحث عن غرف هذا الفندق من جديد." };
  // the typed cost the file was sold on (once checked, the last check's figure) against TBO's, both in riyals
  const previous = row.quoted_net;
  const { sarPer } = await getRates();
  const totalSar = sarOf(r.total_fare, r.currency, sarPer);
  const previousSar = sarOf(previous, row.currency, sarPer);
  const difference = totalSar != null && previousSar != null ? Number((totalSar - previousSar).toFixed(2)) : null;

  const checkedAt = new Date().toISOString();
  // the booking as it is NOW: an edit while TBO answered (dates, rooms, hotel) voids this check — and the write
  // below carries this fresh detail, never the copy read before the call
  const now = await loadBooking(row.id);
  if (
    !now ||
    now.start_date !== row.start_date ||
    now.end_date !== row.end_date ||
    roomsOf(now) !== roomsOf(row) ||
    hotelIdOf(now.detail) !== hotelIdOf(row.detail)
  ) {
    return { ok: false, message: "تغيّر الحجز أثناء التحقق — ابحث عن الغرف من جديد." };
  }
  try {
    const supabase = await db();
    const { data: moved, error } = await supabase
      .from("operation_bookings")
      .update({
        // The re-issued code REPLACES the old one: booking against the previous
        // session is the documented way to get a rejection at the last step.
        supplier_booking_code: r.booking_code,
        // TBO's real price and its currency are the CHECK's — quoted_net/currency stay the cost the file was sold on
        // until a booking exists (bookHotel)
        prebook_net: r.total_fare,
        prebook_at: checkedAt,
        detail: { ...(now.detail ?? {}), [PREBOOK_CURRENCY_KEY]: r.currency },
        cancellation_policy: r.cancellation_policy,
        cancellation_deadline: r.cancellation_deadline,
        source: "api",
        supplier_code: "tbo",
        supplier_name: row.supplier_name || "TBO Holidays",
        // Only ever forward, and never over a booking that already exists.
        ...(row.status === "pending" || row.status === "failed" ? { status: "prebooked" } : {}),
      })
      .eq("id", row.id)
      // and never over a row that was booked while TBO answered
      .in("status", ["pending", "failed", "prebooked"])
      .select("id");
    // a price shown but not saved would only be refused at «احجز» — said now
    if (error) return { ok: false, error: "err.db" };
    if (!moved?.length) return { ok: false, message: "تغيّرت حالة الحجز أثناء التحقق — حدّث الصفحة." };
  } catch {
    return { ok: false, error: "err.db" };
  }

  await logAudit({
    action: "supplier.prebooked",
    entity: "operation_bookings",
    entity_id: row.id,
    meta: { total: r.total_fare, currency: r.currency, previous, previous_currency: row.currency, difference_sar: difference },
  });

  return {
    ok: true,
    total: r.total_fare,
    currency: r.currency,
    previous,
    previous_currency: row.currency,
    total_sar: totalSar,
    previous_sar: previousSar,
    difference,
    refundable: r.refundable,
    cancellation_policy: r.cancellation_policy,
    cancellation_deadline: r.cancellation_deadline,
    room_name: r.room_name,
    rooms: r.rooms,
    supplements: r.supplements,
    conditions: r.conditions,
    checked_at: checkedAt,
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
   * The names to print, ONE LIST PER ROOM, as the operator confirmed them.
   *
   * Deliberately NOT read from the encrypted passports here. Those sit behind
   * `operations.passport` and every read is audited, and more importantly the
   * spelling on the voucher has to match the document the guest hands the front
   * desk — one letter apart is a family turned away. A human reads both and
   * confirms; this module does not transliterate anything.
   */
  rooms: BookGuest[][];
  email: string;
  phone: string;
  /** the check the operator looked at (PriceCheck.checked_at) */
  checked_at: string;
}): Promise<BookOk | BookUnknown | Fail | Blocked> {
  const denied = (await gateRow("operation_bookings", input.booking_id)) ?? (await requireBook());
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
  // only the check this screen showed: another check since (another screen, a colleague) may be another room
  if (!row.prebook_at || Date.parse(row.prebook_at) !== Date.parse(input.checked_at)) {
    return { ok: false, message: "تغيّر الاختيار منذ تحققك (من شاشة أخرى أو زميل) — ابحث وتحقق من جديد." };
  }
  // the check's currency (detail.prebook_currency): without it the cost would be written under another currency
  const checkCurrency = row.detail?.[PREBOOK_CURRENCY_KEY];
  if (!checkCurrency) return { ok: false, message: "تحقق من السعر من جديد قبل الحجز." };
  // the figure TBO returned at the last check — the one Book must send back, exactly
  const priced = row.prebook_net;
  if (priced == null || Math.abs(priced - input.approved_total) > 0.01) {
    return { ok: false, message: "السعر تغيّر منذ آخر تحقق — راجع الفرق واعتمده من جديد." };
  }
  // TBO's session lives 30 minutes from the search: an older check is asked again, never booked on
  if (!row.prebook_at || Date.now() - Date.parse(row.prebook_at) > PRICE_FRESH_MS) {
    return { ok: false, message: "مضى على التحقق من السعر أكثر من 25 دقيقة — ابحث وتحقق من جديد قبل الحجز." };
  }
  if (!input.email.trim() || input.phone.replace(/[^\d]/g, "").length < 8) {
    return { ok: false, message: "بريد العميل ورقمه (بمفتاح الدولة) مطلوبان — يرسل المورّد الفاوتشر عليهما." };
  }

  // one list per room, every room with an adult — TBO reads the lists as the rooms
  const rooms = (Array.isArray(input.rooms) ? input.rooms : []).map((room) => (Array.isArray(room) ? room : []).filter((g) => g.first_name.trim() && g.last_name.trim()));
  if (rooms.length !== roomsOf(row)) return { ok: false, message: `هذا الحجز ${roomsOf(row)} غرف — أدخل نزلاء كل غرفة.` };
  if (rooms.some((room) => !room.some((g) => g.type === "Adult"))) return { ok: false, message: "في كل غرفة نزيل بالغ واحد على الأقل." };
  const guests = rooms.flat();
  if (guests.some((g) => !/^[A-Za-z][A-Za-z .'-]*$/.test(g.first_name.trim()) || !/^[A-Za-z][A-Za-z .'-]*$/.test(g.last_name.trim()))) {
    // The voucher is printed by the supplier and read at a foreign front desk.
    return { ok: false, message: "أسماء النزلاء بالحروف اللاتينية كما في الجواز." };
  }
  if (guests.some((g) => !["Mr", "Mrs", "Ms"].includes(g.title) || !["Adult", "Child"].includes(g.type))) return { ok: false, message: "اللقب أو النوع غير صحيح." };

  // Written BEFORE the call, and only once: TBO's recovery path needs the exact
  // reference we sent, and generating a new one on a retry would make the first
  // booking unfindable. (A refused attempt clears it — see below — so a new one starts fresh.)
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
    rooms: rooms.map((room) => ({ guests: room.map((g) => ({ ...g, first_name: g.first_name.trim(), last_name: g.last_name.trim() })) })),
    client_reference: clientReference,
    booking_reference: bookingReference,
    // TBO's figure exactly as the check returned it (prebook_net keeps 2 decimals; the screen's is the exact one,
    // and it was held to within a cent of the stored one above)
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
    // refused for certain: the next attempt is a new booking with a new reference
    try {
      const supabase = await db();
      await supabase.from("operation_bookings").update({ status: "failed", supplier_ref: null }).eq("id", row.id);
    } catch {
      await setStatus(row.id, "failed");
    }
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
        // booked: the row's cost is now what TBO charges, in TBO's currency
        quoted_net: priced,
        net_charged: priced,
        currency: checkCurrency,
        confirmed_at: new Date().toISOString(),
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
    meta: { outcome: "confirmed", confirmation_number: out.data.confirmation_number, total: priced },
  });
  // booked by the supplier's own system — the case moves as if an agent had confirmed it
  await syncOperationOfBooking(row.id);
  return { ok: true, confirmation_number: out.data.confirmation_number, total: priced, currency: checkCurrency };
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
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };

  const row = await loadBooking(bookingId);
  if (!row) return { ok: false, error: "ops.err.notFound" };
  return refreshLoadedBooking(row);
}

/**
 * The read-and-apply core, shared with the daily TBO sweep (tbo-sweep.ts),
 * which runs with no session — its caller answers for access; here the
 * gate above does.
 */
export async function refreshLoadedBooking(row: NonNullable<Awaited<ReturnType<typeof loadBooking>>>): Promise<
  | { ok: true; status: string; confirmation_number: string | null; hotel_confirmation_number: string | null }
  | Fail
  | Blocked
> {
  if (!row.confirmation_number && !row.supplier_ref) {
    return { ok: false, message: "لا رقم تأكيد ولا مرجع حجز — لا شيء نسأل عنه المورّد." };
  }

  // TBO's rule: after a lost Book, ask 120 seconds after it — sooner, «no such booking» means nothing yet
  const lostAt = row.status === "in_flight" ? await lastUnknownBook(row.id) : null;
  if (lostAt != null && Date.now() - lostAt < 120_000) {
    return { ok: false, message: `انتظر ${Math.ceil((120_000 - (Date.now() - lostAt)) / 1000)} ثانية ثم تحقق — TBO يطلب دقيقتين بعد الحجز.` };
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
  // TBO's money in TBO's currency: what it reports, else the last check's — never under the sold cost's currency
  const tboCurrency = d.currency || row.detail?.[PREBOOK_CURRENCY_KEY] || null;
  // only a finished cancellation is «cancelled»; «CancellationInProgress», «CancelPending», «CxlRequestSentToHotel» keep
  // the row as it is (said in supplier_status) — and a cancelled row never comes back as confirmed
  const word = d.status.replace(/\s+/g, "").toLowerCase();
  const cancelled = word === "cancelled" || word === "cancelledandrefundawaited";
  const cancelling = !cancelled && /cancel|cxl/.test(word);
  try {
    const supabase = await db();
    await supabase
      .from("operation_bookings")
      .update({
        status: cancelled ? "cancelled" : cancelling || row.status === "cancelled" ? row.status : d.confirmation_number ? "confirmed" : row.status,
        supplier_status: d.status || null,
        confirmation_number: d.confirmation_number ?? row.confirmation_number,
        // a total only with its currency; a lost Book confirmed here gets the cost and time Book would have written
        ...(d.total_fare != null && tboCurrency
          ? {
              net_charged: d.total_fare,
              currency: tboCurrency,
              ...(row.status === "in_flight" && !cancelled && !cancelling && d.confirmation_number ? { quoted_net: d.total_fare, confirmed_at: new Date().toISOString() } : {}),
            }
          : {}),
        ...(d.cancellation_policy ? { cancellation_policy: d.cancellation_policy } : {}),
        ...(d.cancellation_deadline ? { cancellation_deadline: d.cancellation_deadline } : {}),
        // added to the room lines, never in place of them
        ...(d.hotel_confirmation_number ? { detail: { ...(row.detail ?? {}), "رقم تأكيد الفندق": d.hotel_confirmation_number } } : {}),
      })
      .eq("id", row.id);
  } catch {
    return { ok: false, error: "err.db" };
  }
  // confirmed (or cancelled) by what the supplier says — the case moves, its papers issue
  await syncOperationOfBooking(row.id);

  return {
    ok: true,
    status: d.status,
    confirmation_number: d.confirmation_number,
    hotel_confirmation_number: d.hotel_confirmation_number,
  };
}

/** Cancel at the supplier. Same permission as booking — it is the same money. */
export async function cancelSupplierBooking(bookingId: string): Promise<{ ok: true; message: string } | Fail | Blocked> {
  const denied = (await gateRow("operation_bookings", bookingId)) ?? (await requireBook());
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

/** when a Book on this booking last came back unknown (its audit line), ms — null when none */
async function lastUnknownBook(bookingId: string): Promise<number | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("audit_logs")
      .select("created_at")
      .eq("action", "supplier.booked")
      .eq("entity_id", bookingId)
      .eq("meta->>outcome", "unknown")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? Date.parse((data as { created_at: string }).created_at) : null;
  } catch {
    return null;
  }
}

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
