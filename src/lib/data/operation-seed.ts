"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { BOARD_AR } from "@/components/offer-doc/labels";
import type { BoardType } from "@/lib/types";
import { gateOperation } from "@/lib/operations/access";
import { normalizeDraftData } from "@/lib/offer/draft-types";
import { LATER, newBookings, planBookingsFromDraft, type ExistingBooking } from "@/lib/operations/seed-plan";
import { issuedDraftData } from "@/lib/data/issued-draft";
import { roomsJson, seededSpec } from "@/lib/operations/room-details";
import { ROOM_SPEC_KEY } from "@/lib/operations/voucher-dto";

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
 * Safe to run more than once: each seeded row carries `origin_ref` under a
 * unique index, so a second press skips what is already there instead of
 * creating a second hotel nobody booked — and a booking typed by hand before
 * the pull covers the one it stands for (newBookings in seed-plan.ts).
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

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
};

export type SeedResult = { ok: true; added: number; linked: number; skipped: number } | Fail;

export async function seedBookingsFromOffer(operationId: string): Promise<SeedResult> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };

  try {
    const supabase = await db();

    type OfferRef = { serial: string; partner_company_id: string | null };
    const opRes = await supabase
      .from("operations")
      .select("id, offer_id, offers(serial, partner_company_id)")
      .eq("id", operationId)
      .maybeSingle();
    const op = opRes.data as { id: string; offer_id: string; offers: OfferRef | OfferRef[] | null } | null;
    if (!op) return { ok: false, error: "ops.err.notFound" };
    const offer = Array.isArray(op.offers) ? op.offers[0] : op.offers;

    // The draft the offer was ISSUED from holds every city, flight, tour and
    // transfer with its date — the copy frozen at issue, never a draft edited
    // since (issued-draft.ts; service: gateOperation above is the gate). An offer
    // with none (imported, repackaged) falls back to its own tables below.
    const draft = await issuedDraftData(createSupabaseServiceClient() as unknown as SupabaseClient, {
      id: op.offer_id,
      serial: offer?.serial ?? "",
      partner_company_id: offer?.partner_company_id ?? null,
    });

    const [hotelsRes, flightsRes, itemsRes, existingRes] = await Promise.all([
      // Service client: the buy price seeds quoted_net, and 0047 withholds it
      // from sessions. gateOperation above is the gate.
      (createSupabaseServiceClient() as unknown as SupabaseClient)
        .from("offer_hotels")
        .select(
          "id, hotel_name, room_type_name, rooms_count, board_type, check_in, check_out, nights, cancellation_policy, supplier_name, buy_price, buy_currency",
        )
        .eq("offer_id", op.offer_id)
        .order("sort", { ascending: true }),
      supabase
        .from("offer_flights")
        .select("id, airline, flight_no, from_airport, to_airport, departure_at, arrival_at, cabin_class, baggage_allowance, leg_order, flight_date")
        .eq("offer_id", op.offer_id)
        .order("sort", { ascending: true }),
      supabase
        .from("offer_pricing_items")
        .select("id, item_type, description, quantity")
        .eq("offer_id", op.offer_id)
        .in("item_type", ["visa", "transport"]),
      supabase.from("operation_bookings").select("id, origin_ref, kind, title, city_name, start_date, end_date, status").eq("operation_id", operationId),
    ]);
    // not knowing what the case holds is no licence to add it all again
    if (existingRes.error) return { ok: false, error: "err.loadFailed" };
    const existing = (existingRes.data ?? []) as ExistingBooking[];

    const rows: SeedRow[] = [];
    const refs = existing.map((r) => r.origin_ref).filter((r): r is string => Boolean(r));
    // a case seeded by the old pull keeps its rows; the plan adds only the kinds it never had
    const seededBefore = {
      hotel: refs.some((r) => r.startsWith("hotel:")),
      flight: refs.some((r) => r.startsWith("flight:") && r !== "flight:intl" && r !== "flight:dom"),
      transport: refs.some((r) => r.startsWith("transport:")),
    };

    if (draft) {
      for (const p of planBookingsFromDraft(normalizeDraftData(draft), COMPANY_CANCELLATION)) {
        if (p.kind === "hotel" && seededBefore.hotel) continue;
        if (p.kind === "flight" && seededBefore.flight) continue;
        if (p.kind === "transport" && seededBefore.transport) continue;
        rows.push(p);
      }
    }

    for (const h of (draft ? [] : (hotelsRes.data ?? [])) as {
      id: string;
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
    }[]) {
      const detail: Record<string, string> = {};
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
        title: h.hotel_name?.trim() || `فندق — ${LATER}`,
        city_name: "",
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
      if (f.departure_at) detail["الإقلاع"] = f.departure_at.replace("T", " ").slice(0, 16);
      if (f.arrival_at) detail["الوصول"] = f.arrival_at.replace("T", " ").slice(0, 16);
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

    for (const item of (itemsRes.data ?? []) as {
      id: string;
      item_type: string;
      description: string | null;
      quantity: number | null;
    }[]) {
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

    const { fresh, links } = newBookings(rows, existing);
    // a booking typed by hand that IS a planned one takes its ref — the next pull matches it outright
    let linked = 0;
    for (const link of links) {
      const { error } = await supabase.from("operation_bookings").update({ origin_ref: link.origin_ref }).eq("id", link.id).eq("operation_id", operationId);
      if (!error) linked += 1;
    }
    if (fresh.length === 0) {
      if (linked > 0) await logAudit({ action: "booking.created", entity: "operations", entity_id: operationId, meta: { seeded: 0, linked, from: "offer" } });
      return { ok: true, added: 0, linked, skipped: rows.length };
    }

    const employeeId = await getCurrentEmployeeId();
    const { error } = await supabase.from("operation_bookings").insert(
      fresh.map((r) => ({
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
      })),
    );
    if (error) return { ok: false, error: "err.createFailed" };

    await logAudit({
      action: "booking.created",
      entity: "operations",
      entity_id: operationId,
      meta: { seeded: fresh.length, linked, from: "offer" },
    });
    return { ok: true, added: fresh.length, linked, skipped: rows.length - fresh.length };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
