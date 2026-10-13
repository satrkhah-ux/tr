/**
 * What «اسحب الحجوزات من العرض» pulls, read from the draft that issued the
 * offer — the one place that still holds every city, flight, tour and transfer
 * with its date.
 *
 * One booking per thing a supplier books: the international flight is ONE
 * booking (one PNR, the legs inside it), the domestic flight another, a stay per
 * hotel, a transfer per drive (its time worked out from the flight it meets),
 * a booking per tour on its day, the SIM cards. Every row carries a stable
 * `origin_ref`, so pressing again adds only what is new and never a twin.
 *
 * Pure: no React, no Supabase.
 */

import {
  deriveHotelStays,
  stayTotal,
  TRANSPORT_AIRPORT,
  TRANSPORT_HOTEL_PREFIX,
  TRANSPORT_TOURS,
  type DraftData,
  type DraftFlight,
} from "@/lib/offer/draft-types";
import { withTours } from "@/lib/offer/basic";
import { BOARD_AR } from "@/components/offer-doc/labels";

export type PlannedBooking = {
  origin_ref: string;
  kind: "hotel" | "flight" | "transport" | "service";
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

/** The prefixes this plan writes — an older seed's refs (hotel:<id>, flight:<id>, transport:<id>) are not these. */
export const PLANNED_PREFIXES = ["flight:intl", "flight:dom", "stay:", "transfer:", "tour:", "sim"];

export const LATER = "يُحدَّد لاحقاً";
/** Minutes between a landing and the driver at the arrivals hall; a hotel pick-up before a flight. */
export const MEET_AFTER_LANDING = 45;
export const BEFORE_INTL = 180;
export const BEFORE_DOMESTIC = 120;
/** The word a leg line puts before its landing — drivers.ts reads it back. */
export const LANDS = "الوصول";

/** «YYYY-MM-DDTHH:mm» shifted by minutes, as the wall clock of the same place. */
export function shift(at: string, minutes: number): { date: string; time: string } {
  const t = new Date(`${at.slice(0, 16)}:00Z`).getTime() + minutes * 60_000;
  const iso = new Date(t).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** A leg's departure has a real time only once it is ticketed — a planned leg says midnight. */
const timed = (f: DraftFlight, at: string | null) => Boolean(at && (f.flight_no.trim() || at.slice(11, 16) !== "00:00"));
const code = (airport: string) => airport.match(/\(([A-Za-z0-9]{3,5})\)\s*$/)?.[1] ?? airport;

function legText(f: DraftFlight): string {
  const when = f.departure_at ? `${f.departure_at.slice(0, 10)} ${timed(f, f.departure_at) ? f.departure_at.slice(11, 16) : LATER}` : LATER;
  // the landing too: the reception is timed from it, and follows it when the airline moves the flight
  const lands = f.arrival_at && timed(f, f.arrival_at) ? ` · ${LANDS} ${f.arrival_at.slice(0, 10)} ${f.arrival_at.slice(11, 16)}` : "";
  return `${f.flight_no.trim() || "—"} · ${code(f.from_airport)} → ${code(f.to_airport)} · ${when}${lands}`;
}

function travellers(trip: DraftData["trip"]): string {
  return [
    `${trip.adults} بالغ`,
    trip.children > 0 ? `${trip.children} طفل` : "",
    trip.infants > 0 ? `${trip.infants} رضيع` : "",
  ]
    .filter(Boolean)
    .join(" + ");
}

const byDeparture = (a: DraftFlight, b: DraftFlight) => (a.departure_at ?? "").localeCompare(b.departure_at ?? "");

export function planBookingsFromDraft(data: DraftData, companyCancellation: string): PlannedBooking[] {
  const rows: PlannedBooking[] = [];
  const pax = travellers(data.trip);
  const people = data.trip.adults + data.trip.children + data.trip.infants;
  const flights = [...data.flights].sort(byDeparture);
  const buyOf = (ref: string) => {
    const item = data.pricing.items.find((i) => i.ref === ref);
    return item?.buy_price != null ? { price: item.buy_price * (item.quantity > 0 ? item.quantity : 1), currency: item.buy_currency || "SAR" } : null;
  };

  // ---- the flights: one booking per ticket ----
  const intl = flights.filter((f) => f.leg_order !== "internal");
  const dom = flights.filter((f) => f.leg_order === "internal");
  for (const [ref, legs, label] of [
    ["flight:intl", intl, "طيران دولي"],
    ["flight:dom", dom, "طيران داخلي"],
  ] as const) {
    if (legs.length === 0) continue;
    const out = legs.filter((f) => f.leg_order === "outbound");
    const back = legs.filter((f) => f.leg_order === "inbound");
    const detail: Record<string, string> = {};
    if (ref === "flight:intl") {
      out.forEach((f, k) => (detail[out.length > 1 ? `الذهاب ${k + 1}` : "الذهاب"] = legText(f)));
      back.forEach((f, k) => (detail[back.length > 1 ? `العودة ${k + 1}` : "العودة"] = legText(f)));
    } else legs.forEach((f, k) => (detail[`رحلة ${k + 1}`] = legText(f)));
    const cabin = [...new Set(legs.map((f) => f.cabin_class).filter(Boolean))].join("، ");
    if (cabin) detail["الدرجة"] = cabin;
    detail["الركاب"] = pax;
    const price = ref === "flight:intl" ? data.flight_booking.intl_price : data.flight_booking.dom_price;
    const currency = (ref === "flight:intl" ? data.flight_booking.intl_currency : data.flight_booking.dom_currency) || "SAR";
    const route = ref === "flight:intl" && back.length > 0 ? `${code(out[0]?.from_airport ?? "")} ⇄ ${code(out.at(-1)?.to_airport ?? "")}` : legs.map((f) => `${code(f.from_airport)} → ${code(f.to_airport)}`).join(" · ");
    rows.push({
      origin_ref: ref,
      kind: "flight",
      title: `${label} ${route}`.trim(),
      city_name: route,
      start_date: legs[0].departure_at?.slice(0, 10) ?? null,
      end_date: legs.at(-1)?.departure_at?.slice(0, 10) ?? null,
      detail,
      supplier_name: (ref === "flight:intl" ? data.flight_booking.intl_supplier : data.flight_booking.dom_supplier) || [...new Set(legs.map((f) => f.airline).filter(Boolean))].join("، "),
      cancellation_policy: null,
      quoted_net: price,
      currency,
    });
  }

  // ---- the stays: a booking per hotel, its rooms and its guests ----
  if (data.scope.hotels) {
    for (const stay of deriveHotelStays(data.cities, data.hotels)) {
      const line = stay.line;
      if (!line.hotel_name.trim()) continue;
      const detail: Record<string, string> = { المدينة: stay.city_name };
      line.rooms.forEach((r, k) => {
        const board = r.board_type ? BOARD_AR[r.board_type] : "";
        detail[line.rooms.length > 1 ? `الغرفة ${k + 1}` : "الغرفة"] = [r.room_type_name.trim() || "—", board].filter(Boolean).join(" — ");
      });
      detail["عدد الغرف"] = String(line.rooms.length);
      if (stay.nights) detail["عدد الليالي"] = String(stay.nights);
      detail["النزلاء"] = pax;
      rows.push({
        origin_ref: `stay:${line.id}`,
        kind: "hotel",
        title: line.hotel_name,
        city_name: stay.city_name,
        start_date: stay.check_in,
        end_date: stay.check_out,
        detail,
        supplier_name: line.supplier ?? "",
        cancellation_policy: line.sourcing?.cancellation_policy?.trim() || companyCancellation,
        quoted_net: line.sourcing?.net_base ?? stayTotal(line),
        currency: line.sourcing ? "SAR" : line.manual_currency || "SAR",
      });
    }
  }

  // ---- the transfers: each drive on its day, timed from the flight it meets ----
  if (data.scope.transport) {
    // the flight a drive meets: the one landing in (or leaving) the city nearest the drive's own day —
    // a city visited twice has two; a farewell (no day of its own) takes the last flight out
    const day = (f: DraftFlight, at: "arrival" | "departure") => ((at === "arrival" ? f.arrival_at : null) ?? f.departure_at ?? "").slice(0, 10);
    const nearest = (list: DraftFlight[], at: "arrival" | "departure", date: string | null, fallback: "first" | "last") => {
      if (list.length === 0) return undefined;
      if (!date) return fallback === "first" ? list[0] : list[list.length - 1];
      const gap = (f: DraftFlight) => Math.abs(Date.parse(day(f, at) || date) - Date.parse(date));
      return [...list].sort((a, b) => gap(a) - gap(b))[0];
    };
    const lastIn = (city: string, date: string | null) =>
      nearest(flights.filter((f) => f.leg_order !== "inbound" && f.to_city?.trim() === city), "arrival", date, "first") ?? intl.filter((f) => f.leg_order === "outbound").at(-1);
    const firstOut = (city: string, date: string | null) =>
      nearest(flights.filter((f) => f.leg_order !== "outbound" && f.from_city?.trim() === city), "departure", date, "last") ?? intl.find((f) => f.leg_order === "inbound");
    for (const tr of data.transport) {
      if (tr.from_place === TRANSPORT_TOURS) continue; // a tour's price includes its car
      const detail: Record<string, string> = {};
      let date = tr.date;
      let time = "";
      let flight: DraftFlight | undefined;
      let meet = "";
      if (tr.from_place === TRANSPORT_AIRPORT && tr.to_place.startsWith(TRANSPORT_HOTEL_PREFIX)) {
        const city = tr.to_place.slice(TRANSPORT_HOTEL_PREFIX.length).trim();
        flight = lastIn(city, tr.date);
        // the driver waits from the landing; a leg with no landing time yet is timed later
        const at = flight?.arrival_at ?? null;
        if (flight && at && timed(flight, at)) ({ date, time } = shift(at, MEET_AFTER_LANDING));
        else if (flight?.departure_at) date = flight.departure_at.slice(0, 10);
        meet = `صالة القادمين — ${flight ? code(flight.to_airport) : "المطار"}`;
      } else if (tr.to_place === TRANSPORT_AIRPORT && tr.from_place.startsWith(TRANSPORT_HOTEL_PREFIX)) {
        const city = tr.from_place.slice(TRANSPORT_HOTEL_PREFIX.length).trim();
        flight = firstOut(city, tr.date);
        const at = flight?.departure_at ?? null;
        if (flight && at && timed(flight, at)) ({ date, time } = shift(at, -(flight.leg_order === "internal" ? BEFORE_DOMESTIC : BEFORE_INTL)));
        else if (at) date = at.slice(0, 10);
        meet = "بهو الفندق";
      } else {
        // between cities by road: after checking out
        time = "12:00";
        meet = "بهو الفندق";
      }
      detail["الوقت"] = time || LATER;
      if (flight) detail["الرحلة"] = `${flight.flight_no.trim() || "—"} ${code(flight.from_airport)} → ${code(flight.to_airport)}`;
      detail["نقطة الالتقاء"] = meet;
      if (tr.car_type) detail["السيارة"] = tr.car_type;
      detail["الركاب"] = String(people);
      const buy = buyOf(`transport:${tr.from_place}>${tr.to_place}>${tr.car_type ?? ""}`);
      rows.push({
        origin_ref: `transfer:${tr.from_place}>${tr.to_place}>${date ?? ""}`,
        kind: "transport",
        title: `${tr.from_place} ← ${tr.to_place}`,
        city_name: tr.to_place.startsWith(TRANSPORT_HOTEL_PREFIX) ? tr.to_place.slice(TRANSPORT_HOTEL_PREFIX.length) : tr.from_place.replace(TRANSPORT_HOTEL_PREFIX, ""),
        start_date: date,
        end_date: null,
        detail,
        supplier_name: "",
        cancellation_policy: null,
        quoted_net: buy?.price ?? null,
        currency: buy?.currency ?? "SAR",
      });
    }
  }

  // ---- the tours: each on its day, in its car ----
  if (data.transport_plan.tours.enabled) {
    for (const city of data.cities) {
      withTours(city, city.tours ?? 0).forEach((pick, i) => {
        if (pick.free) return;
        const title = pick.title.trim() || `جولة سياحية في ${city.city_name}`;
        const detail: Record<string, string> = { المدينة: city.city_name, "وقت الانطلاق": "09:00" };
        const car = pick.car_type?.trim() || data.transport_plan.tours.car_type.trim();
        if (car) detail["السيارة"] = car;
        detail["الركاب"] = String(people);
        if (pick.text.trim()) detail["البرنامج"] = pick.text.trim();
        rows.push({
          origin_ref: `tour:${city.city_name}:${i}`,
          kind: "service",
          title: `جولة: ${title}`,
          city_name: city.city_name,
          start_date: pick.date ?? null,
          end_date: null,
          detail,
          supplier_name: "",
          cancellation_policy: null,
          quoted_net: pick.price,
          currency: "SAR",
        });
      });
    }
  }

  // ---- the SIM cards ----
  const sims = data.services.includes.find((l) => /^شريحة اتصال × \d+$/.test(l));
  if (sims) {
    const buy = buyOf("sim");
    rows.push({
      origin_ref: "sim",
      kind: "service",
      title: sims,
      city_name: data.cities[0]?.city_name ?? "",
      start_date: data.cities[0]?.check_in ?? data.trip.arrival_date,
      end_date: null,
      detail: { العدد: sims.match(/\d+/)?.[0] ?? "" },
      supplier_name: "",
      cancellation_policy: null,
      quoted_net: buy?.price ?? null,
      currency: buy?.currency ?? "SAR",
    });
  }
  return rows;
}
