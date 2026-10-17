"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { followFlight } from "@/lib/data/flight-follow";
import { notifyBookingChanged } from "@/lib/data/ops-notify";
import { syncOperation, syncOperationOfBooking } from "@/lib/data/operation-sync";
import { CLIENT_DOCUMENT_KINDS, type VoucherKind } from "@/lib/operations/voucher-dto";
import { issueDocumentNow, type IssueInput } from "@/lib/data/document-issue";
import { applyRoomDetails, roomDetailsOpen } from "@/lib/operations/room-details";
import type { LocaleChoice } from "@/lib/catalog/room-catalog";
import { currentCan } from "@/lib/roles/current";
import { gateManagerRow, gateOperation, gateRow } from "@/lib/operations/access";
import { carCount, DRV } from "@/lib/operations/drivers";
import { entriesToSave, type ConfirmEntry } from "@/lib/operations/confirm-all";
import { findLookupCountry, type LookupRoomType } from "@/lib/offer/draft-types";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import type { BoardType } from "@/lib/types";

/**
 * Bookings and the documents issued from them.
 *
 * Everything here works MANUALLY today: the agent types the confirmation number
 * read off a supplier email or portal. The supplier-API path writes the same
 * columns through the same action, so connecting TBO later changes no schema and
 * no screen — which matters, because those credentials do not exist yet and the
 * ops team needs this working now.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type Fail = { ok: false; error: TranslationKey };



/**
 * Tell the salesperson what operations just did to their case.
 *
 * They are the one the client phones, and finding out from the client that the
 * hotel moved is the failure this prevents. Best-effort and awaited only for its
 * side effect — a notification that fails must never roll back the edit it
 * describes.
 */
async function announce(bookingId: string, what: string, title?: string): Promise<void> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_bookings")
      .select("title, operation_id, operations(offers(serial, customers(arabic_name)))")
      .eq("id", bookingId)
      .maybeSingle();
    const row = data as unknown as {
      title: string;
      operation_id: string;
      operations: { offers: unknown } | { offers: unknown }[] | null;
    } | null;
    if (!row) return;

    const op = Array.isArray(row.operations) ? row.operations[0] : row.operations;
    const offerRaw = (op as { offers?: unknown } | null)?.offers;
    const offer = (Array.isArray(offerRaw) ? offerRaw[0] : offerRaw) as
      | { serial: string; customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null }
      | null;
    const custRaw = offer?.customers;
    const cust = (Array.isArray(custRaw) ? custRaw[0] : custRaw) as { arabic_name: string | null } | null;

    const user = await getServerUser();
    await notifyBookingChanged({
      operationId: row.operation_id,
      serial: offer?.serial ?? "",
      customer: cust?.arabic_name ?? null,
      bookingTitle: title || row.title,
      what,
      by: user?.email ?? null,
    });
  } catch {
    /* best-effort */
  }
}


/** Turn a patch into one Arabic sentence the salesperson can act on. */
function describeEdit(patch: Record<string, unknown>): string {
  const words: string[] = [];
  if ("title" in patch) words.push("الاسم");
  if ("start_date" in patch || "end_date" in patch) words.push("التواريخ");
  if ("detail" in patch) words.push("التفاصيل");
  if ("confirmation_number" in patch) {
    words.push(patch.confirmation_number ? "رقم التأكيد" : "إزالة رقم التأكيد");
  }
  if ("cancellation_policy" in patch) words.push("سياسة الإلغاء");
  if ("supplier_name" in patch) words.push("المزوّد");
  if ("note" in patch) words.push("ملاحظة");
  return words.length > 0 ? `تعديل ${words.join("، ")}` : "تعديل على الحجز";
}

export type BookingKind = "hotel" | "flight" | "visa" | "transport" | "service";
export type BookingStatus = "pending" | "prebooked" | "in_flight" | "confirmed" | "failed" | "cancelled";

export type OperationBooking = {
  id: string;
  operation_id: string;
  kind: BookingKind;
  title: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string>;
  supplier_name: string;
  source: "manual" | "api";
  status: BookingStatus;
  /**
   * Acknowledged by the supplier is NOT the same as ticketed. An airline holding
   * a seat and an issued ticket are different facts, and a voucher printed for
   * the first has to say so — otherwise a family is turned away at the counter
   * holding a document that looked confirmed.
   */
  is_paid: boolean;
  origin: "manual" | "offer";
  /** who is actually doing this one — see operation-assign.ts. */
  assignee_kind: "ops" | "employee" | "partner" | "supplier";
  assignee_employee_id: string | null;
  assignee_partner_id: string | null;
  /** one of our suppliers (company_suppliers, 0063) — staff screens only. */
  assignee_supplier_id: string | null;
  assignee_label: string | null;
  /** when someone CHOSE the assignee — null on 'ops' means nobody did yet (the column default), not «قسم العمليات» doing it. */
  assigned_at: string | null;
  handoff_note: string | null;
  confirmation_number: string | null;
  quoted_net: number | null;
  net_charged: number | null;
  currency: string;
  cancellation_policy: string | null;
  cancellation_deadline: string | null;
  note: string | null;
  /** ours, per service — <serial>-<H|F|T|V|S><n>, set by the database (0084); what the client's link shows. */
  company_ref: string | null;
  /** a flight's ticket, read from the uploaded ticket (0084). */
  pnr: string | null;
  ticket_numbers: string[];
  flight_legs: FlightLeg[];
  baggage: string | null;
};

/** One leg of a ticketed flight booking — times ISO with their offset; the drivers' pickups come from these. */
export type FlightLeg = { flight_no: string; from: string; to: string; departs_at: string | null; arrives_at: string | null };

export async function listBookings(operationId: string): Promise<OperationBooking[]> {
  if (await gateOperation(operationId)) return [];
  try {
    // Service client: 0047 withholds the net columns from sessions — gateOperation
    // is the gate. The nets themselves leave only for pricing.internal (order 8:
    // cost is internal); the supplier's own price check is supplier-booking.ts.
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const internal = await currentCan("pricing.internal");
    const read = (columns: string) =>
      supabase.from("operation_bookings").select(columns).eq("operation_id", operationId).order("start_date", { ascending: true, nullsFirst: false });
    const base =
      "id, operation_id, kind, title, city_name, start_date, end_date, detail, supplier_name, source, status, is_paid, origin, assignee_kind, assignee_employee_id, assignee_partner_id, assigned_at, handoff_note, confirmation_number, quoted_net, net_charged, currency, cancellation_policy, cancellation_deadline, note, company_ref, pnr, ticket_numbers, flight_legs, baggage, employees:assignee_employee_id(arabic_name), booking_partners:assignee_partner_id(name)";
    let { data, error } = await read(`${base}, assignee_supplier_id, company_suppliers:assignee_supplier_id(arabic_name)`);
    // until 0063 is applied the supplier columns do not exist — the case still opens
    if (error) ({ data, error } = await read(base));

    // PostgREST returns an embedded relation as an array even when to-one.
    const pick = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    return ((data ?? []) as unknown as (OperationBooking & {
      employees?: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
      booking_partners?: { name: string } | { name: string }[] | null;
      company_suppliers?: { arabic_name: string } | { arabic_name: string }[] | null;
    })[]).map(({ company_suppliers, ...b }) => ({
      ...b,
      quoted_net: internal ? b.quoted_net : null,
      net_charged: internal ? b.net_charged : null,
      assignee_label:
        b.assignee_kind === "partner"
          ? (pick(b.booking_partners)?.name ?? null)
          : b.assignee_kind === "employee"
            ? (pick(b.employees)?.arabic_name ?? null)
            : b.assignee_kind === "supplier"
              ? (pick(company_suppliers)?.arabic_name ?? null)
              : null,
    }));
  } catch {
    return [];
  }
}

export type CatalogHotel = { id: string; name: string; stars: number | null; city: string };
export type CaseHotelCatalog = { hotels: CatalogHotel[]; roomTypes: LookupRoomType[] };

/**
 * The hotels «إضافة حجز» picks from (operations order 4) — the catalogue Basic
 * picks from, each hotel with its city, and the room types the catalogue holds
 * for them. The case's own country first: its destination, or the cities its
 * bookings name; the whole catalogue when neither says. Names only.
 */
export async function caseHotelCatalog(operationId: string): Promise<CaseHotelCatalog> {
  const none: CaseHotelCatalog = { hotels: [], roomTypes: [] };
  if (await gateOperation(operationId)) return none;
  try {
    const supabase = await db();
    const [opRes, bookingsRes, countriesRes, citiesRes] = await Promise.all([
      supabase.from("operations").select("offers(destination)").eq("id", operationId).maybeSingle(),
      supabase.from("operation_bookings").select("city_name").eq("operation_id", operationId),
      supabase.from("countries").select("id, arabic_name"),
      supabase.from("cities").select("id, arabic_name, country_id"),
    ]);
    type Dest = { destination: string | null };
    const offer = (opRes.data as { offers: Dest | Dest[] | null } | null)?.offers;
    const destination = (Array.isArray(offer) ? offer[0] : offer)?.destination ?? "";
    const cities = (citiesRes.data ?? []) as { id: string; arabic_name: string; country_id: string | null }[];
    const named = new Set(((bookingsRes.data ?? []) as { city_name: string }[]).map((b) => normalizeName(b.city_name)).filter(Boolean));
    const dest = normalizeName(destination);

    // «اندونيسيا», «بالي 7», «تبليسي +باكورياني+باتومي» — a country, or a city of it
    const countryIds = new Set<string>();
    const countries = ((countriesRes.data ?? []) as { id: string; arabic_name: string }[]).map((c) => ({ id: c.id, name: c.arabic_name }));
    const country = destination ? findLookupCountry(countries, destination) : undefined;
    if (country) countryIds.add(country.id);
    for (const c of cities) {
      const n = normalizeName(c.arabic_name);
      if (c.country_id && n && (named.has(n) || (n.length > 2 && dest.includes(n)))) countryIds.add(c.country_id);
    }
    const inCountry = cities.filter((c) => c.country_id && countryIds.has(c.country_id)).map((c) => c.id);
    const cityName = new Map(cities.map((c) => [c.id, c.arabic_name]));

    const hotels: CatalogHotel[] = [];
    for (let from = 0; ; from += 1000) {
      const base = supabase.from("hotels").select("id, arabic_name, stars, city_id");
      const { data, error } = await (inCountry.length > 0 ? base.in("city_id", inCountry) : base).order("id").range(from, from + 999);
      if (error) break;
      const rows = (data ?? []) as { id: string; arabic_name: string; stars: number | null; city_id: string | null }[];
      hotels.push(...rows.map((h) => ({ id: h.id, name: h.arabic_name, stars: h.stars, city: (h.city_id && cityName.get(h.city_id)) || "" })));
      if (rows.length < 1000) break;
    }
    const ids = new Set(hotels.map((h) => h.id));
    const { data: rt } = await supabase.from("room_types").select("id, arabic_name, hotel_id, default_board").not("hotel_id", "is", null);
    const roomTypes = ((rt ?? []) as { id: string; arabic_name: string; hotel_id: string; default_board: BoardType | null }[])
      .filter((r) => ids.has(r.hotel_id))
      .map((r) => ({ id: r.id, name: r.arabic_name, hotel_id: r.hotel_id, default_board: r.default_board }));
    return { hotels: hotels.sort((a, b) => a.name.localeCompare(b.name, "ar")), roomTypes };
  } catch {
    return none;
  }
}

export async function addBooking(input: {
  operation_id: string;
  kind: BookingKind;
  title: string;
  city_name?: string;
  start_date?: string | null;
  end_date?: string | null;
  detail?: Record<string, string>;
  supplier_name?: string;
  quoted_net?: number | null;
  currency?: string;
}): Promise<{ ok: true; id: string } | Fail> {
  const denied = await gateOperation(input.operation_id);
  if (denied) return { ok: false, error: denied };
  if (!input.title.trim()) return { ok: false, error: "ops.err.titleRequired" };

  try {
    const supabase = await db();
    const { data, error } = await supabase
      .from("operation_bookings")
      .insert({
        operation_id: input.operation_id,
        kind: input.kind,
        title: input.title.trim(),
        city_name: input.city_name ?? "",
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        detail: input.detail ?? {},
        supplier_name: input.supplier_name ?? "",
        source: "manual",
        status: "pending",
        // Written on creation, before any supplier call could ever happen. The
        // unique index on this column is the double-booking guard.
        client_reference: `TRV-${randomUUID()}`,
        quoted_net: input.quoted_net ?? null,
        currency: input.currency ?? "SAR",
        created_by: await getCurrentEmployeeId(),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };

    const id = (data as { id: string }).id;
    await logAudit({
      action: "booking.created",
      entity: "operation_bookings",
      entity_id: id,
      meta: { operation_id: input.operation_id, kind: input.kind, source: "manual" },
    });
    return { ok: true, id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

type Confirmation = {
  booking_id: string;
  confirmation_number: string;
  supplier_name?: string;
  net_charged?: number | null;
  cancellation_policy?: string | null;
  cancellation_deadline?: string | null;
};

/**
 * The one write behind every manual confirmation — a booking at a time, or
 * «تأكيد الكل». What is not given is left as it was: the pull's cancellation
 * terms stay on the voucher when the agent only types the number.
 */
async function writeConfirmation(supabase: SupabaseClient, input: Confirmation, by: string | null, bulk = false): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: "confirmed",
    confirmation_number: input.confirmation_number.trim(),
    confirmed_at: new Date().toISOString(),
    confirmed_by: by,
  };
  if (input.supplier_name !== undefined) patch.supplier_name = input.supplier_name;
  // what the booking cost us is the manager's step (supplier-work.ts setBookingCost): operations.write, or
  // manage_own on one's own file — 0080/0081 refuse it from any other session
  if (input.net_charged !== undefined && !(await gateManagerRow("operation_bookings", input.booking_id))) patch.net_charged = input.net_charged;
  if (input.cancellation_policy !== undefined) patch.cancellation_policy = input.cancellation_policy;
  if (input.cancellation_deadline !== undefined) patch.cancellation_deadline = input.cancellation_deadline;
  const { error } = await supabase.from("operation_bookings").update(patch).eq("id", input.booking_id);
  if (error) return false;
  await logAudit({
    action: "booking.confirmed",
    entity: "operation_bookings",
    entity_id: input.booking_id,
    meta: { confirmation_number: input.confirmation_number.trim(), source: "manual", ...(bulk ? { bulk: true } : {}) },
  });
  return true;
}

/**
 * Record a confirmation the agent read off a supplier email or portal.
 *
 * There is no silent path to 'confirmed': the confirmation number is required,
 * because "confirmed" without one is a claim nobody can check at the hotel desk.
 */
export async function confirmBookingManually(input: Confirmation): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", input.booking_id);
  if (denied) return { ok: false, error: denied };
  if (!input.confirmation_number.trim()) return { ok: false, error: "ops.err.confirmationRequired" };

  try {
    if (!(await writeConfirmation(await db(), input, await getCurrentEmployeeId()))) return { ok: false, error: "err.updateFailed" };
    await announce(input.booking_id, `تأكيد الحجز برقم ${input.confirmation_number.trim()}`);
    await syncOperationOfBooking(input.booking_id);
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * «تأكيد الكل» (operations order 5): the numbers of several bookings at once —
 * one supplier's reference pasted onto all its bookings, or a quick table of
 * them. Each goes through the same write and lands in the audit log on its
 * own; the case's statuses then move once, through operation-sync.
 */
export async function confirmBookings(input: { operation_id: string; entries: ConfirmEntry[] }): Promise<{ ok: true; confirmed: number } | Fail> {
  const denied = await gateOperation(input.operation_id);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    // this case's bookings only — an id from the browser never confirms another case's
    const { data, error } = await supabase
      .from("operation_bookings")
      .select("id, status, title")
      .eq("operation_id", input.operation_id)
      .in("id", input.entries.map((e) => e.booking_id));
    if (error) return { ok: false, error: "err.loadFailed" };
    const held = (data ?? []) as { id: string; status: string; title: string }[];
    const rows = entriesToSave(input.entries, held);
    if (rows.length === 0) return { ok: false, error: "ops.err.confirmationRequired" };

    const by = await getCurrentEmployeeId();
    const done: Confirmation[] = [];
    for (const row of rows) if (await writeConfirmation(supabase, row, by, true)) done.push(row);
    if (done.length > 0) {
      const titles = done.map((r) => held.find((b) => b.id === r.booking_id)?.title ?? "").filter(Boolean);
      await announce(done[0].booking_id, `تأكيد ${done.length} حجوزات: ${[...new Set(done.map((r) => r.confirmation_number.trim()))].join("، ")}`, titles.join("، "));
      await syncOperation(input.operation_id);
    }
    return done.length === rows.length ? { ok: true, confirmed: done.length } : { ok: false, error: "err.updateFailed" };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Mark a confirmed booking as actually paid / ticketed.
 *
 * Separate from confirmation on purpose — see OperationBooking.is_paid. Only a
 * paid booking prints a clean voucher; a confirmed-but-unpaid one prints with a
 * warning band across it.
 */
export async function markBookingPaid(bookingId: string, paid: boolean): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_bookings")
      .update({ is_paid: paid, paid_at: paid ? new Date().toISOString() : null })
      .eq("id", bookingId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({
      action: "booking.confirmed",
      entity: "operation_bookings",
      entity_id: bookingId,
      meta: { is_paid: paid },
    });
    await announce(bookingId, paid ? "صدرت التذكرة/الحجز وسُدّد" : "أُلغيت حالة السداد");
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Edit a booking.
 *
 * Ops work is corrective by nature — a date read wrong off a supplier email, a
 * room type the hotel downgraded, a flight the airline rescheduled. Without an
 * edit the only recourse is delete-and-retype, which loses the confirmation
 * number and the audit trail along with the typo.
 */
export async function updateBooking(input: {
  id: string;
  title?: string;
  city_name?: string;
  start_date?: string | null;
  end_date?: string | null;
  detail?: Record<string, string>;
  supplier_name?: string;
  confirmation_number?: string | null;
  cancellation_policy?: string | null;
  note?: string | null;
}): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", input.id);
  if (denied) return { ok: false, error: denied };
  if (input.title !== undefined && !input.title.trim()) return { ok: false, error: "ops.err.titleRequired" };
  const cars = input.detail?.[DRV.cars];
  if (cars !== undefined && carCount(cars) === null) return { ok: false, error: "ops.err.carCount" };

  try {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.city_name !== undefined) patch.city_name = input.city_name;
    if (input.start_date !== undefined) patch.start_date = input.start_date;
    if (input.end_date !== undefined) patch.end_date = input.end_date;
    if (input.detail !== undefined) patch.detail = input.detail;
    if (input.supplier_name !== undefined) patch.supplier_name = input.supplier_name;
    if (input.cancellation_policy !== undefined) patch.cancellation_policy = input.cancellation_policy;
    if (input.note !== undefined) patch.note = input.note;
    // Clearing the reference drops the booking back to a provisional hold —
    // "confirmed" without a number is a claim nobody can check at the desk.
    if (input.confirmation_number !== undefined) {
      const ref = input.confirmation_number?.trim() || null;
      patch.confirmation_number = ref;
      patch.status = ref ? "confirmed" : "pending";
      patch.confirmed_at = ref ? new Date().toISOString() : null;
      if (!ref) patch.is_paid = false;
    }
    if (Object.keys(patch).length === 0) return { ok: true };

    const supabase = await db();
    // a flight's legs time the receptions and drop-offs — keep the lines as they were before the edit
    const before = input.detail
      ? ((await supabase.from("operation_bookings").select("kind, title, operation_id, detail").eq("id", input.id).maybeSingle()).data as {
          kind: string;
          title: string;
          operation_id: string;
          detail: Record<string, string> | null;
        } | null)
      : null;
    const { error } = await supabase.from("operation_bookings").update(patch).eq("id", input.id);
    if (error) return { ok: false, error: "err.updateFailed" };
    if (before?.kind === "flight" && input.detail) {
      await followFlight(supabase, { id: input.id, operation_id: before.operation_id, title: input.title ?? before.title, detail: input.detail }, before.detail);
    }
    await logAudit({
      action: "booking.created",
      entity: "operation_bookings",
      entity_id: input.id,
      meta: { edited: Object.keys(patch) },
    });
    await announce(input.id, describeEdit(patch));
    // a number typed here confirms the booking as surely as «تأكيد» does — the case moves, its papers issue
    if (input.confirmation_number !== undefined) await syncOperationOfBooking(input.id);
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * «تفاصيل الغرفة» (room catalogue, 2026-10-15): what the hotel confirmed about
 * each room — type, category, beds, view, smoking, capacity, its own name.
 * Entered once the hotel is confirmed, never before (the owner's order), and
 * checked against the catalogue's rules here as well as in the form. Kept in
 * the booking's detail (ROOM_SPEC_KEY); each room line is rewritten in the
 * catalogue's Arabic, which is what the client's programme reads.
 */
export async function saveRoomDetails(input: {
  booking_id: string;
  rooms: Record<string, unknown>;
  locale: LocaleChoice;
}): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", input.booking_id);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { data } = await supabase.from("operation_bookings").select("kind, status, detail").eq("id", input.booking_id).maybeSingle();
    const row = data as { kind: string; status: string; detail: Record<string, string> | null } | null;
    if (!row) return { ok: false, error: "err.loadFailed" };
    if (!roomDetailsOpen(row)) return { ok: false, error: "ops.room.err.notConfirmed" };
    const detail = applyRoomDetails(row.detail ?? {}, input.rooms, input.locale);
    if (!detail) return { ok: false, error: "ops.room.err.invalid" };
    const { error } = await supabase.from("operation_bookings").update({ detail }).eq("id", input.booking_id);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "booking.created", entity: "operation_bookings", entity_id: input.booking_id, meta: { edited: ["room_spec"] } });
    await announce(input.booking_id, "تفاصيل الغرفة");
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function cancelBooking(bookingId: string, reason: string): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_bookings")
      // no reason given keeps the booking's own note
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), ...(reason.trim() ? { note: reason } : {}) })
      .eq("id", bookingId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "booking.cancelled", entity: "operation_bookings", entity_id: bookingId, meta: { reason } });
    await announce(bookingId, `إلغاء الحجز — ${reason || "بلا سبب مذكور"}`);
    // a cancelled booking no longer holds the case back
    await syncOperationOfBooking(bookingId);
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteBooking(bookingId: string): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_bookings")
      .select("operation_id, kind, title, status, confirmation_number")
      .eq("id", bookingId)
      .maybeSingle();
    const booking = data as { operation_id: string; kind: string; title: string; status: string; confirmation_number: string | null } | null;
    if (!booking) return { ok: false, error: "err.loadFailed" };
    // What the supplier holds is cancelled, not erased: its confirmation number,
    // its net and its vouchers are the record (cancelBooking keeps them).
    if (booking.status === "confirmed" || booking.status === "in_flight") return { ok: false, error: "ops.err.deleteConfirmed" };
    // Recorded BEFORE: the row and its vouchers (0025's cascade) are gone after.
    const { count } = await supabase
      .from("operation_documents")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", bookingId);
    await logAudit({
      action: "booking.deleted",
      entity: "operation_bookings",
      entity_id: bookingId,
      meta: {
        operation_id: booking.operation_id,
        kind: booking.kind,
        title: booking.title,
        status: booking.status,
        confirmation_number: booking.confirmation_number,
        documents: count ?? 0,
      },
    });
    const { error } = await supabase.from("operation_bookings").delete().eq("id", bookingId);
    if (error) return { ok: false, error: "err.deleteFailed" };
    await syncOperation(booking.operation_id);
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------------- documents ----------------

export type OperationDocument = {
  id: string;
  kind: VoucherKind;
  booking_id: string | null;
  version: number;
  token: string;
  revoked_at: string | null;
  created_at: string;
};

export async function listDocuments(operationId: string): Promise<OperationDocument[]> {
  if (await gateOperation(operationId)) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("operation_documents")
      .select("id, kind, booking_id, version, token, revoked_at, created_at")
      .eq("operation_id", operationId)
      .order("created_at", { ascending: false });
    return (data ?? []) as OperationDocument[];
  } catch {
    return [];
  }
}

/**
 * «إصدار» a document — the gate, then the one write behind every issued paper
 * (document-issue.ts, shared with the documents the server issues by itself).
 * A paper identical to the latest of its kind comes back as it is, not as a
 * second version.
 */
export async function issueDocument(input: IssueInput): Promise<{ ok: true; id: string; token: string } | (Fail & { params?: Record<string, string> })> {
  const denied = (await gateOperation(input.operation_id)) ?? (input.booking_id ? await gateRow("operation_bookings", input.booking_id) : null);
  if (denied) return { ok: false, error: denied };
  const res = await issueDocumentNow(input, await getCurrentEmployeeId());
  if (!res.ok) return res;
  // a new client document moves the case — and issues whatever else just became due with it
  if (!res.reused && CLIENT_DOCUMENT_KINDS.includes(input.kind)) await syncOperation(input.operation_id);
  return { ok: true, id: res.id, token: res.token };
}

export async function revokeDocument(documentId: string): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_documents", documentId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { error } = await supabase
      .from("operation_documents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", documentId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "voucher.revoked", entity: "operation_documents", entity_id: documentId });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
