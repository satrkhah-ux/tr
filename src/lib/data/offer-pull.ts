// NOT "use server": nothing here checks who is asking. Its callers are the gate —
// seedBookingsFromOffer (the case's gate, operation-seed.ts), the case page after
// its own visibility check (wizard-case.ts), and the confirmation that opens the
// case (operations.ts recordConfirmation, itself checked). A server-actions module
// would hand any signed-in browser an ungated pull.
import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { BOARD_AR } from "@/components/offer-doc/labels";
import type { BoardType } from "@/lib/types";
import { normalizeDraftData } from "@/lib/offer/draft-types";
import { flightRefresh, LATER, newBookings, offerHotelCity, oldPullStays, planBookingsFromDraft, type ExistingBooking, type HeldFlight } from "@/lib/operations/seed-plan";
import { issuedDraftData } from "@/lib/data/issued-draft";
import { registeredSupplier } from "@/lib/data/repackage-supplier";
import { normalizeRepackageData } from "@/lib/repackage/repackage-types";
import { isPackageLine, packageLine } from "@/lib/repackage/package-line";
import { roomsJson, seededSpec } from "@/lib/operations/room-details";
import { HOTEL_ID_KEY, ROOM_SPEC_KEY } from "@/lib/operations/voucher-dto";
import type { OfferKinds } from "@/lib/operations/wizard/types";

/**
 * Pull the bookings straight out of the offer the client agreed to.
 *
 * Ops staff should not retype a hotel name, a room type, or a flight number that
 * is already sitting in the offer — retyping is where a wrong date or a
 * transposed flight number enters the system, and the client already signed the
 * version in the document. Everything comes from the offer; the ONLY thing a
 * human adds is the supplier's confirmation number, which by definition does not
 * exist until the supplier says it.
 *
 * Run when the case is opened (the confirmation), again when its wizard opens
 * with nothing on it, and by «اسحب الحجوزات». Safe to run more than once: each
 * seeded row carries `origin_ref` under a unique index, so a second run skips
 * what is already there instead of creating a second hotel nobody booked — and
 * a booking typed by hand before the pull covers the one it stands for
 * (newBookings in seed-plan.ts).
 *
 * Service role throughout: the buy price seeds quoted_net (0047 withholds it from
 * sessions; 0080 takes origin_ref from no session but operations.write), and the
 * confirmation that opens a partner's case has no staff session at all.
 */

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

type Fail = { ok: false; error: TranslationKey };

/**
 * The company's standing cancellation terms, used when the hotel row carries
 * none of its own. Stated rather than left blank: a voucher with an empty
 * cancellation line invites the guest to assume there is no penalty.
 */
const COMPANY_CANCELLATION =
  "تخضع سياسة الإلغاء لشروط الفندق والمورّد. يُرجى مراجعة قسم العمليات قبل أي طلب إلغاء أو تعديل.";

type SeedRow = {
  origin_ref: string;
  kind: "hotel" | "flight" | "visa" | "transport" | "service";
  title: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string>;
  supplier_name: string;
  cancellation_policy: string | null;
  quoted_net: number | null;
  currency: string;
  /** the registered supplier a line is handed to when it is seeded (a repackage's package line). */
  assignee_supplier_id?: string | null;
};

/** `failed`: the bookings that could not be written — each skipped and named, never the whole pull lost to one. */
export type SeedResult = { ok: true; added: number; linked: number; skipped: number; failed: string[] } | Fail;

type OfferHotelRow = {
  id: string;
  hotel_id: string | null;
  offer_city_id: string | null;
  hotel_name: string | null;
  room_type_name: string | null;
  rooms_count: number | null;
  board_type: string | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  cancellation_policy: string | null;
  supplier_name: string | null;
  buy_price: number | null;
  buy_currency: string | null;
};
type OfferCityRow = { id: string; city_name: string; check_in: string | null; check_out: string | null; hotel_name: string | null };

/** What the offer books, and what the case already holds. */
async function planFor(operationId: string): Promise<{ ok: true; rows: SeedRow[]; existing: ExistingBooking[] } | Fail> {
  const supabase = service();
  type OfferRef = { serial: string; partner_company_id: string | null; source_kind: string | null; source_import_id: string | null };
  const opRes = await supabase
    .from("operations")
    .select("id, offer_id, offers(serial, partner_company_id, source_kind, source_import_id)")
    .eq("id", operationId)
    .maybeSingle();
  const op = opRes.data as { id: string; offer_id: string; offers: OfferRef | OfferRef[] | null } | null;
  if (!op) return { ok: false, error: "ops.err.notFound" };
  const offer = Array.isArray(op.offers) ? op.offers[0] : op.offers;

  // The draft the offer was ISSUED from holds every city, flight, tour and
  // transfer with its date — the copy frozen at issue, never a draft edited
  // since (issued-draft.ts). An offer with none (imported, repackaged) falls
  // back to its own tables below.
  const draft = await issuedDraftData(supabase, { id: op.offer_id, serial: offer?.serial ?? "", partner_company_id: offer?.partner_company_id ?? null });

  const [hotelsRes, citiesRes, flightsRes, itemsRes, existingRes] = await Promise.all([
    supabase
      .from("offer_hotels")
      .select(
        "id, hotel_id, offer_city_id, hotel_name, room_type_name, rooms_count, board_type, check_in, check_out, nights, cancellation_policy, supplier_name, buy_price, buy_currency",
      )
      .eq("offer_id", op.offer_id)
      .order("sort", { ascending: true }),
    supabase.from("offer_cities").select("id, city_name, check_in, check_out, hotel_name").eq("offer_id", op.offer_id).order("sort", { ascending: true }),
    supabase
      .from("offer_flights")
      .select("id, airline, flight_no, from_airport, to_airport, departure_at, arrival_at, cabin_class, baggage_allowance, leg_order, flight_date")
      .eq("offer_id", op.offer_id)
      .order("sort", { ascending: true }),
    supabase.from("offer_pricing_items").select("id, item_type, description, quantity").eq("offer_id", op.offer_id).in("item_type", ["visa", "transport"]),
    supabase.from("operation_bookings").select("id, origin_ref, kind, title, city_name, start_date, end_date, status, detail").eq("operation_id", operationId),
  ]);
  // not knowing what the case holds is no licence to add it all again
  if (existingRes.error) return { ok: false, error: "err.loadFailed" };
  const offerHotels = (hotelsRes.data ?? []) as OfferHotelRow[];
  const offerCities = (citiesRes.data ?? []) as OfferCityRow[];
  const cityOfHotel = (h: OfferHotelRow) => offerHotelCity(h, offerCities);
  // the old pull's hotels compared stay by stay, as what their offer lines say (oldPullStays)
  const existing = oldPullStays((existingRes.data ?? []) as ExistingBooking[], offerHotels, offerCities);
  const refs = existing.map((r) => r.origin_ref).filter((r): r is string => Boolean(r));
  // a case seeded by the old pull keeps its flights and transfers; the plan adds only the kinds it never had
  const seededBefore = {
    flight: refs.some((r) => r.startsWith("flight:") && r !== "flight:intl" && r !== "flight:dom"),
    transport: refs.some((r) => r.startsWith("transport:")),
  };

  const rows: SeedRow[] = [];
  if (draft) {
    for (const p of planBookingsFromDraft(normalizeDraftData(draft), COMPANY_CANCELLATION)) {
      if (p.kind === "flight" && seededBefore.flight) continue;
      if (p.kind === "transport" && seededBefore.transport) continue;
      rows.push(p);
    }
  }

  for (const h of draft ? [] : offerHotels) {
    const detail: Record<string, string> = {};
    const city = cityOfHotel(h);
    if (city) detail["المدينة"] = city;
    if (h.hotel_id) detail[HOTEL_ID_KEY] = h.hotel_id;
    if (h.room_type_name) detail["نوع الغرفة"] = h.room_type_name;
    const spec = h.room_type_name ? seededSpec({ room_type_name: h.room_type_name }) : null;
    // the board CODE means nothing to a hotel receptionist — print the words
    if (h.board_type) detail["الإقامة"] = BOARD_AR[h.board_type as BoardType] ?? h.board_type;
    if (h.rooms_count) detail["عدد الغرف"] = String(h.rooms_count);
    if (h.nights) detail["عدد الليالي"] = String(h.nights);
    if (spec) detail[ROOM_SPEC_KEY] = roomsJson({ "نوع الغرفة": spec });

    rows.push({
      origin_ref: `hotel:${h.id}`,
      kind: "hotel",
      title: h.hotel_name?.trim() || `فندق${city ? ` ${city}` : ""} — ${LATER}`,
      // the offer's own city for it (offer_cities), as a pull from the draft writes it
      city_name: city,
      start_date: h.check_in,
      end_date: h.check_out,
      detail,
      supplier_name: h.supplier_name ?? "",
      // the hotel's own terms when the rate carried them, else the company's
      cancellation_policy: h.cancellation_policy?.trim() || COMPANY_CANCELLATION,
      quoted_net: h.buy_price != null ? Number(h.buy_price) : null,
      currency: h.buy_currency ?? "SAR",
    });
  }

  for (const f of (draft ? [] : (flightsRes.data ?? [])) as {
    id: string;
    airline: string | null;
    flight_no: string | null;
    from_airport: string | null;
    to_airport: string | null;
    departure_at: string | null;
    arrival_at: string | null;
    cabin_class: string | null;
    baggage_allowance: string | null;
    leg_order: string | null;
    flight_date: string | null;
  }[]) {
    const detail: Record<string, string> = {};
    if (f.airline) detail["شركة الطيران"] = f.airline;
    if (f.flight_no) detail["رقم الرحلة"] = f.flight_no;
    if (f.from_airport) detail["من"] = f.from_airport;
    if (f.to_airport) detail["إلى"] = f.to_airport;
    // a midnight on an unticketed leg is no time at all — it was printed on a client's ticket page as
    // «الإقلاع 2026-11-27 00:00» (the evaluator, 2026-10-22)
    const at = (v: string) => (!f.flight_no?.trim() && v.slice(11, 16) === "00:00" ? `${v.slice(0, 10)} ${LATER}` : v.replace("T", " ").slice(0, 16));
    if (f.departure_at) detail["الإقلاع"] = at(f.departure_at);
    if (f.arrival_at) detail["الوصول"] = at(f.arrival_at);
    if (f.cabin_class) detail["الدرجة"] = f.cabin_class;
    if (f.baggage_allowance) detail["الأمتعة"] = f.baggage_allowance;

    const route = [f.from_airport, f.to_airport].filter(Boolean).join(" → ");
    rows.push({
      origin_ref: `flight:${f.id}`,
      kind: "flight",
      title: [f.airline, f.flight_no].filter(Boolean).join(" ") || route || "رحلة",
      city_name: route,
      start_date: (f.departure_at ?? f.flight_date)?.slice(0, 10) ?? null,
      end_date: f.arrival_at?.slice(0, 10) ?? null,
      detail,
      supplier_name: f.airline ?? "",
      cancellation_policy: null,
      quoted_net: null,
      currency: "SAR",
    });
  }

  for (const item of (itemsRes.data ?? []) as { id: string; item_type: string; description: string | null; quantity: number | null }[]) {
    // with the draft, the transfers come from its plan; without it, a flight hop
    // priced as a «transfer» (offers before 2026-10-13) is the domestic flight again
    if (item.item_type === "transport" && (draft || (item.description ?? "").includes("طيران داخلي"))) continue;
    rows.push({
      origin_ref: `${item.item_type}:${item.id}`,
      kind: item.item_type === "visa" ? "visa" : "transport",
      title: item.description ?? (item.item_type === "visa" ? "تأشيرة" : "مواصلات"),
      city_name: "",
      start_date: null,
      end_date: null,
      detail: item.quantity ? { العدد: String(item.quantity) } : {},
      supplier_name: "",
      cancellation_policy: null,
      quoted_net: null,
      currency: "SAR",
    });
  }

  // A repackaged file: the supplier's package is priced as a whole (pricings.buy_total), so the hotels
  // above cost nothing — ONE line carries the debt, with the supplier and its cost, so «حسابات الموردين»
  // lists it and the supplier's payments are recorded against it (repackage/package-line.ts).
  if (offer?.source_kind === "repackaged" && offer.source_import_id) {
    const { data: imported } = await supabase.from("repackage_imports").select("data").eq("id", offer.source_import_id).maybeSingle();
    if (imported) {
      const file = normalizeRepackageData((imported as { data: Record<string, unknown> }).data);
      const line = packageLine(op.offer_id, file);
      if (line) {
        const supplier = line.assignee_supplier_id ? { id: line.assignee_supplier_id } : await registeredSupplier(supabase, file);
        rows.push({ ...line, assignee_supplier_id: supplier?.id ?? null });
      }
    }
  }
  return { ok: true, rows, existing };
}

/**
 * What the offer itself books — what decides whether a wizard step with no
 * booking is «لا ينطبق» or «لم تُسحب الحجوزات». null when it cannot be read.
 */
export async function offerBookingKinds(operationId: string): Promise<OfferKinds | null> {
  try {
    const plan = await planFor(operationId);
    if (!plan.ok) return null;
    return {
      flight: plan.rows.some((r) => r.kind === "flight"),
      hotel: plan.rows.some((r) => r.kind === "hotel"),
      // the drives and the tours — what the transport step works (drivers.ts driverServiceKind)
      transport: plan.rows.some((r) => r.kind === "transport" || r.origin_ref.startsWith("tour:")),
    };
  } catch {
    return null;
  }
}

/** The unique index on (operation_id, origin_ref): that booking is already on the case. */
const DUPLICATE = "23505";

/** Pull the offer's bookings onto the case. Ungated — see the head of this file. */
export async function pullBookingsFromOffer(operationId: string): Promise<SeedResult> {
  try {
    const plan = await planFor(operationId);
    if (!plan.ok) return plan;
    const { rows, existing } = plan;

    const { fresh, links } = newBookings(rows, existing);
    const writer = service();
    // the flights already on the case follow the newest issue until their ticket is in (flightRefresh)
    const held = await writer
      .from("operation_bookings")
      .select("id, origin_ref, status, title, start_date, end_date, detail, pnr, flight_legs, note")
      .eq("operation_id", operationId)
      .in("origin_ref", ["flight:intl", "flight:dom"]);
    for (const { id, patch } of flightRefresh(rows, (held.data ?? []) as HeldFlight[])) {
      await writer.from("operation_bookings").update(patch).eq("id", id).eq("operation_id", operationId);
    }
    // the supplier's package line follows the newest issue — its cost and its supplier — until the supplier confirms it
    for (const r of rows.filter((x) => isPackageLine(x.origin_ref))) {
      const open = ["pending", "prebooked", "in_flight", "failed"];
      await writer
        .from("operation_bookings")
        .update({ quoted_net: r.quoted_net, currency: r.currency, supplier_name: r.supplier_name })
        .eq("operation_id", operationId)
        .eq("origin_ref", r.origin_ref)
        .in("status", open);
      if (r.assignee_supplier_id) {
        // only while nobody else holds it: the clerk's own hand-off stays
        await writer
          .from("operation_bookings")
          .update({ assignee_kind: "supplier", assignee_supplier_id: r.assignee_supplier_id })
          .eq("operation_id", operationId)
          .eq("origin_ref", r.origin_ref)
          .eq("assignee_kind", "ops");
      }
    }
    // a booking typed by hand that IS a planned one takes its ref — the next pull matches it outright
    let linked = 0;
    for (const link of links) {
      const { error } = await writer.from("operation_bookings").update({ origin_ref: link.origin_ref }).eq("id", link.id).eq("operation_id", operationId);
      if (!error) linked += 1;
    }

    // one ref once: a twin in the plan is named and left out, never the whole pull failed on it
    const failed: string[] = [];
    const taken = new Set<string>();
    const unique = fresh.filter((r) => (taken.has(r.origin_ref) ? (failed.push(r.title), false) : (taken.add(r.origin_ref), true)));
    if (unique.length === 0) {
      if (linked > 0) await logAudit({ action: "booking.created", entity: "operations", entity_id: operationId, meta: { seeded: 0, linked, from: "offer" } });
      return { ok: true, added: 0, linked, skipped: rows.length, failed };
    }

    const employeeId = await getCurrentEmployeeId();
    const inserts = unique.map((r) => ({
      operation_id: operationId,
      kind: r.kind,
      title: r.title,
      city_name: r.city_name,
      start_date: r.start_date,
      end_date: r.end_date,
      detail: r.detail,
      supplier_name: r.supplier_name,
      source: "manual",
      origin: "offer",
      origin_ref: r.origin_ref,
      status: "pending",
      client_reference: `TRV-${randomUUID()}`,
      cancellation_policy: r.cancellation_policy,
      quoted_net: r.quoted_net,
      currency: r.currency,
      created_by: employeeId,
      // the supplier's package line is born handed to its supplier (assignee_kind / assignee_supplier_id pair, 0063)
      ...(r.assignee_supplier_id ? { assignee_kind: "supplier", assignee_supplier_id: r.assignee_supplier_id } : {}),
    }));
    let added = unique.length;
    const { error } = await writer.from("operation_bookings").insert(inserts);
    if (error) {
      // one row the database refuses fails the batch: each on its own, the refused ones named —
      // and one a second pull at the same moment already wrote is simply there
      added = 0;
      for (const [i, row] of inserts.entries()) {
        const one = await writer.from("operation_bookings").insert(row);
        if (!one.error) added += 1;
        else if (one.error.code !== DUPLICATE) failed.push(unique[i].title);
      }
    }

    if (added > 0 || linked > 0) {
      await logAudit({
        action: "booking.created",
        entity: "operations",
        entity_id: operationId,
        meta: { seeded: added, linked, from: "offer", ...(failed.length > 0 ? { failed } : {}) },
      });
    }
    return { ok: true, added, linked, skipped: rows.length - added, failed };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
