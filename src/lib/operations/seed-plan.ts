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
  deriveCityDates,
  deriveHotelStays,
  FREE_DAY_TITLE,
  roomLabel,
  stayTotal,
  TRANSPORT_AIRPORT,
  TRANSPORT_HOTEL_PREFIX,
  transportRef,
  TRANSPORT_TOURS,
  splitVehicle,
  tourCars,
  tourVehicle,
  vehicleText,
  type DraftCity,
  type DraftData,
  type DraftFlight,
  type DraftTransport,
  type TourPick,
} from "@/lib/offer/draft-types";
import { cityDates, withTours } from "@/lib/offer/basic";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { BOARD_AR } from "@/components/offer-doc/labels";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { roomsJson, seededSpec, type BookingRoomSpec } from "./room-details";
import { HOTEL_ID_KEY, hotelIdOf, ROOM_SPEC_KEY } from "./voucher-dto";

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
/** A flight the package sold whose legs are only a plan — booked, with nothing on it to print. */
export const FLIGHT_NEEDED = "طيران مطلوب — بدون تفاصيل";
/** Minutes between a landing and the driver at the arrivals hall; a hotel pick-up before a flight. */
export const MEET_AFTER_LANDING = 45;
export const BEFORE_INTL = 180;
export const BEFORE_DOMESTIC = 120;
/** A tour on the day the group lands sets off this long after the landing: met, driven, checked in. */
export const TOUR_AFTER_LANDING = 180;
/** A tour on the day the group flies out ends this long before the take-off: back, checked out, driven, checked in. */
export const TOUR_BEFORE_TAKEOFF = 240;
/**
 * How long a tour is taken to last when it has to fit before a take-off.
 * ponytail: one length for every tour — the programmes keep none; read the
 * programme's own once tour_programs holds a duration.
 */
export const TOUR_MINUTES = 240;
/** Never earlier than this, whatever the take-off — a 05:00 tour is no tour. */
export const EARLIEST_TOUR = "07:00";
/** The word a leg line puts before its landing — drivers.ts reads it back. */
export const LANDS = "الوصول";
/** The detail line that tells operations what the pull could not settle on its own. */
export const NOTICE = "تنبيه";
export const ARRIVAL_DAY_TOUR = "يوم الوصول — تبدأ الجولة بعد وصول المجموعة إلى الفندق";
export const DEPARTURE_DAY_TOUR = "يوم المغادرة — تنتهي الجولة قبل الإقلاع بأربع ساعات";
export const FAREWELL_UNSOLD = "التوديع إلى المطار — لم يكن بنداً مستقلاً في العرض (أُزيل أو صار جولة قبل المغادرة)";

/** «YYYY-MM-DDTHH:mm» shifted by minutes, as the wall clock of the same place. */
export function shift(at: string, minutes: number): { date: string; time: string } {
  const t = new Date(`${at.slice(0, 16)}:00Z`).getTime() + minutes * 60_000;
  const iso = new Date(t).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * A clock is real once it is not midnight — what a leg holds until its time is known, numbered
 * or not (a domestic number may come before its times; that 00:00 was printed and timed drives).
 */
const timed = (at: string | null | undefined) => Boolean(at && at.slice(11, 16) !== "00:00");
/**
 * A leg only planned, never flown as written (the evaluator, 2026-10-22: «طيران دولي MED ⇄ IST»
 * booked from Basic's default MED → gateway at midnight): one the cities wrote (`auto`), or one
 * with neither a number nor a real time (a number makes it real). Ops books its flight; no route, day line or clock of it
 * is printed, and no drive is timed from it.
 */
export const plannedLeg = (f: DraftFlight) => !f.flight_no.trim() && (f.auto === true || !timed(f.departure_at));
const code = (airport: string) => airport.match(/\(([A-Za-z0-9]{3,5})\)\s*$/)?.[1] ?? airport;

function legText(f: DraftFlight): string {
  const when = f.departure_at ? `${f.departure_at.slice(0, 10)} ${timed(f.departure_at) ? f.departure_at.slice(11, 16) : LATER}` : LATER;
  // the landing too: the reception is timed from it, and follows it when the airline moves the flight
  const lands = f.arrival_at && timed(f.arrival_at) ? ` · ${LANDS} ${f.arrival_at.slice(0, 10)} ${f.arrival_at.slice(11, 16)}` : "";
  return `${f.flight_no.trim() || "—"} · ${code(f.from_airport)} → ${code(f.to_airport)} · ${when}${lands}`;
}

/**
 * A flight booking's title once its ticket is in — the route the ticket flies, not
 * the one the offer planned (the evaluator, 2026-10-22: the card and the client's
 * page kept «MED ⇄ IST» after an RUH ticket was saved). Connected legs read as one
 * chain (RUH → IST → TZX), a break starts another («· TZX → RUH»).
 */
export function ticketTitle(ref: string | null, legs: { from: string; to: string }[]): string {
  const label = ref === "flight:intl" ? "طيران دولي" : ref === "flight:dom" ? "طيران داخلي" : "طيران";
  const chains: string[][] = [];
  for (const l of legs) {
    const chain = chains.at(-1);
    if (chain && chain.at(-1) === l.from) chain.push(l.to);
    else chains.push([l.from, l.to]);
  }
  return `${label} ${chains.map((c) => c.join(" → ")).join(" · ")}`.trim();
}

/** Said on a ticketed flight's (internal) note when the offer issued again flies other days. */
export const OFFER_FLIGHT_CHANGED = "تغيّرت رحلة العرض بعد إعادة الإصدار — راجع التذكرة:";

/** A flight booking on the case, as the refresh reads it. */
export type HeldFlight = {
  id: string;
  origin_ref: string | null;
  status: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string> | null;
  pnr: string | null;
  flight_legs: unknown;
  note: string | null;
};

type FlightPatch = { id: string; patch: Partial<Pick<HeldFlight, "title" | "start_date" | "end_date" | "detail" | "note">> };

/**
 * What a pull changes on the flights already on the case (the evaluator, 2026-10-22:
 * «a re-issue never reaches ops» — newBookings only adds refs it has not seen). A
 * flight not ticketed yet takes the newest issue's title, days and lines; a ticketed
 * one is the ticket's and stays, but a plan that now flies other days is said on its
 * note, once. A plan that only says «طيران مطلوب» has no days of its own to compare.
 */
export function flightRefresh(
  plan: Pick<PlannedBooking, "origin_ref" | "title" | "start_date" | "end_date" | "detail">[],
  held: HeldFlight[],
): FlightPatch[] {
  const day = (v: string | null) => v?.slice(0, 10) ?? null;
  return held.flatMap((b): FlightPatch[] => {
    const p = plan.find((r) => r.origin_ref === b.origin_ref && (r.origin_ref === "flight:intl" || r.origin_ref === "flight:dom"));
    if (!p || b.status === "cancelled") return [];
    const ticketed = Boolean(b.pnr?.trim()) || (Array.isArray(b.flight_legs) && b.flight_legs.length > 0);
    if (!ticketed) {
      const same =
        b.title === p.title && day(b.start_date) === p.start_date && day(b.end_date) === p.end_date && JSON.stringify(b.detail ?? {}) === JSON.stringify(p.detail);
      return same ? [] : [{ id: b.id, patch: { title: p.title, start_date: p.start_date, end_date: p.end_date, detail: p.detail } }];
    }
    if (p.title.endsWith(FLIGHT_NEEDED)) return [];
    const moved = (p.start_date && p.start_date !== day(b.start_date)) || (p.end_date && p.end_date !== day(b.end_date));
    if (!moved) return [];
    const flag = `${OFFER_FLIGHT_CHANGED} ${[p.start_date, p.end_date].filter(Boolean).join(" → ")}`;
    return (b.note ?? "").includes(flag) ? [] : [{ id: b.id, patch: { note: [flag, b.note?.trim()].filter(Boolean).join("\n") } }];
  });
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

/**
 * The car under «السيارة» and how many under «عدد السيارات» (DRV in drivers.ts):
 * apart, so a model typed into the car later does not drop the «× 2».
 */
function putCar(detail: Record<string, string>, vehicle: string) {
  const { car_type, cars } = splitVehicle(vehicle);
  if (!car_type) return;
  detail["السيارة"] = car_type;
  detail["عدد السيارات"] = String(cars);
}

const byDeparture = (a: DraftFlight, b: DraftFlight) => (a.departure_at ?? "").localeCompare(b.departure_at ?? "");

/**
 * The full generator asks no tour count per city: its tours are the programme's
 * days in the city after the one it arrives on — what operations booked by hand
 * for AD-4-8573 — never a day the programme calls «يوم حر».
 */
function programmeTours(data: DraftData, city: DraftCity): TourPick[] {
  return cityDates(city)
    .slice(1)
    .flatMap((date) => {
      const day = data.days.find((d) => d.date === date);
      if (day?.title.trim() === FREE_DAY_TITLE) return [];
      return [{ program_id: null, title: day?.title.trim() ?? "", text: (day?.activities ?? []).join(" "), price: null, date, cars: data.transport_plan.tours.cars }];
    });
}

export function planBookingsFromDraft(data: DraftData, companyCancellation: string): PlannedBooking[] {
  const rows: PlannedBooking[] = [];
  // the cities as issued; a file saved before its dates were chained gets them from the arrival
  const cities = data.cities.every((c) => c.check_in) ? data.cities : deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
  const pax = travellers(data.trip);
  const people = data.trip.adults + data.trip.children + data.trip.infants;
  // the legs actually flown as written — what the drives are timed from (a planned leg is not)
  const flights = data.flights.filter((f) => !plannedLeg(f)).sort(byDeparture);
  // the flight that brings the group to `city` on `date` — by its landing, else its take-off
  const landsIn = (city: string, date: string) =>
    flights.find((f) => f.leg_order !== "inbound" && f.to_city?.trim() === city.trim() && (f.arrival_at ?? f.departure_at ?? "").slice(0, 10) === date);
  // …and the one that takes it away on `date` — the earliest, if two leave that day
  const leavesFrom = (city: string, date: string) =>
    flights.find((f) => f.leg_order !== "outbound" && f.from_city?.trim() === city.trim() && (f.departure_at ?? "").slice(0, 10) === date);
  const buyOf = (ref: string) => {
    const item = data.pricing.items.find((i) => i.ref === ref);
    return item?.buy_price != null ? { price: item.buy_price * (item.quantity > 0 ? item.quantity : 1), currency: item.buy_currency || "SAR" } : null;
  };

  // ---- the flights: one booking per ticket ----
  const intl = flights.filter((f) => f.leg_order !== "internal");
  const sold = [...data.flights].sort(byDeparture);
  for (const [ref, legs, label, inScope] of [
    ["flight:intl", sold.filter((f) => f.leg_order !== "internal"), "طيران دولي", data.scope.flights_intl],
    ["flight:dom", sold.filter((f) => f.leg_order === "internal"), "طيران داخلي", data.scope.flights_domestic],
  ] as const) {
    // a flight the package did not sell is not booked (the evaluator, 2026-10-22) — its legs only date the trip
    if (!inScope) continue;
    // «أضف لاحقاً» (the owner, 2026-10-22): issued without its flights, still booked — the case asks its
    // tickets before «جاهز للسفر» like any other flight (flightsReadiness)
    const later = ref === "flight:intl" ? data.scope.flights_intl && data.flight_booking.later_intl : data.scope.flights_domestic && data.flight_booking.later_dom;
    if (later) {
      rows.push({
        origin_ref: ref,
        kind: "flight",
        title: `${label} — ${LATER}`,
        city_name: "",
        start_date: ref === "flight:intl" ? data.trip.arrival_date : null,
        end_date: ref === "flight:intl" ? data.trip.departure_date : null,
        detail: { الركاب: pax },
        supplier_name: "",
        cancellation_policy: null,
        quoted_net: null,
        currency: "SAR",
      });
      continue;
    }
    if (legs.length === 0) continue;
    const price = ref === "flight:intl" ? data.flight_booking.intl_price : data.flight_booking.dom_price;
    const currency = (ref === "flight:intl" ? data.flight_booking.intl_currency : data.flight_booking.dom_currency) || "SAR";
    const supplier = (ref === "flight:intl" ? data.flight_booking.intl_supplier : data.flight_booking.dom_supplier) ?? "";
    const real = legs.filter((f) => !plannedLeg(f));
    if (real.length === 0) {
      // only a plan: one booking that says a flight is needed — no route, no day line, no clock
      rows.push({
        origin_ref: ref,
        kind: "flight",
        title: `${label} — ${FLIGHT_NEEDED}`,
        city_name: "",
        start_date: ref === "flight:intl" ? data.trip.arrival_date : (legs[0].departure_at?.slice(0, 10) ?? null),
        end_date: ref === "flight:intl" ? data.trip.departure_date : (legs.at(-1)?.departure_at?.slice(0, 10) ?? null),
        detail: { الركاب: pax },
        supplier_name: supplier,
        cancellation_policy: null,
        quoted_net: price,
        currency,
      });
      continue;
    }
    const out = legs.filter((f) => f.leg_order === "outbound");
    const back = legs.filter((f) => f.leg_order === "inbound");
    const detail: Record<string, string> = {};
    if (ref === "flight:intl") {
      // a leg still only planned beside a real one: said as to be set, never its planned route or clock
      out.forEach((f, k) => (detail[out.length > 1 ? `الذهاب ${k + 1}` : "الذهاب"] = plannedLeg(f) ? LATER : legText(f)));
      back.forEach((f, k) => (detail[back.length > 1 ? `العودة ${k + 1}` : "العودة"] = plannedLeg(f) ? LATER : legText(f)));
    } else legs.forEach((f, k) => (detail[`رحلة ${k + 1}`] = plannedLeg(f) ? LATER : legText(f)));
    const cabin = [...new Set(legs.map((f) => f.cabin_class).filter(Boolean))].join("، ");
    if (cabin) detail["الدرجة"] = cabin;
    detail["الركاب"] = pax;
    // the route of the legs actually written; the ticket rewrites it (wizard-tickets ticketTitle)
    const realOut = real.filter((f) => f.leg_order === "outbound");
    const route =
      ref === "flight:intl" && realOut.length > 0 && real.some((f) => f.leg_order === "inbound")
        ? `${code(realOut[0].from_airport)} ⇄ ${code(realOut.at(-1)!.to_airport)}`
        : real.map((f) => `${code(f.from_airport)} → ${code(f.to_airport)}`).join(" · ");
    rows.push({
      origin_ref: ref,
      kind: "flight",
      title: `${label} ${route}`.trim(),
      // a flight has no city — its route is the title, and a «title — city» line said it twice (0086)
      city_name: "",
      start_date: legs[0].departure_at?.slice(0, 10) ?? null,
      end_date: legs.at(-1)?.departure_at?.slice(0, 10) ?? null,
      detail,
      supplier_name: supplier || [...new Set(real.map((f) => f.airline).filter(Boolean))].join("، "),
      cancellation_policy: null,
      quoted_net: price,
      currency,
    });
  }

  // ---- the stays: a booking per hotel, its rooms and its guests ----
  if (data.scope.hotels) {
    const stays = deriveHotelStays(cities, data.hotels);
    // a named hotel no stop holds any more (its city renamed) is still a hotel the client was sold
    const placed = new Set(stays.map((s) => s.line.id));
    const orphans = data.hotels
      .filter((h) => !placed.has(h.id) && h.hotel_name.trim())
      .map((line) => ({ line, city_name: line.city_name, nights: line.nights, check_in: null, check_out: null }));
    // A line written before stops had keys goes by its city's NAME, so a city visited twice
    // holds it twice (cityHotelLines) — booked on each visit, the second under a ref of its
    // own: two rows under one ref broke the unique index and failed the whole pull.
    const seen = new Map<string, number>();
    for (const stay of [...stays, ...orphans]) {
      const line = stay.line;
      const n = (seen.get(line.id) ?? 0) + 1;
      seen.set(line.id, n);
      const detail: Record<string, string> = { المدينة: stay.city_name };
      // the catalogue's hotel, so its address and map are this one's, not a namesake's
      if (line.hotel_id) detail[HOTEL_ID_KEY] = line.hotel_id;
      // the room as the catalogue names it — the offer's codes, else read from its name — for «تفاصيل الغرفة» and the voucher
      const specs: Record<string, BookingRoomSpec> = {};
      line.rooms.forEach((r, k) => {
        const board = r.board_type ? BOARD_AR[r.board_type] : "";
        const key = line.rooms.length > 1 ? `الغرفة ${k + 1}` : "الغرفة";
        detail[key] = [roomLabel(r) || "—", board].filter(Boolean).join(" — ");
        const spec = seededSpec(r);
        if (spec) specs[key] = spec;
      });
      detail["عدد الغرف"] = String(line.rooms.length);
      if (stay.nights) detail["عدد الليالي"] = String(stay.nights);
      detail["النزلاء"] = pax;
      if (Object.keys(specs).length > 0) detail[ROOM_SPEC_KEY] = roomsJson(specs);
      rows.push({
        origin_ref: n === 1 ? `stay:${line.id}` : `stay:${line.id}#${n}`,
        kind: "hotel",
        // issued before the hotel was chosen: booked all the same, named by operations
        title: line.hotel_name.trim() || `فندق ${stay.city_name} — ${LATER}`,
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
    // with no flight to read it from, a drive is on the day the group reaches the city or leaves it —
    // the farewell on the trip's last day
    const named = (place: string) => cities.filter((c) => c.city_name.trim() === place.replace(TRANSPORT_HOTEL_PREFIX, "").trim());
    const dayOf = (from: string, to: string): string | null => {
      if (to === TRANSPORT_AIRPORT) return named(from).at(-1)?.check_out ?? data.trip.departure_date ?? null;
      if (from === TRANSPORT_AIRPORT) return named(to)[0]?.check_in ?? data.trip.arrival_date ?? null;
      return cities.find((c, i) => i > 0 && c.city_name.trim() === to.trim() && cities[i - 1].city_name.trim() === from.trim())?.check_in ?? null;
    };
    // The way home. A farewell taken off the last city's card — or turned into «جولة قبل
    // المغادرة» (AD-2-3599) — leaves the offer without it, but the group still flies home
    // from that city: the drive to the airport is booked all the same, and says why.
    const last = cities.at(-1)?.city_name.trim();
    const seenOff = data.transport.some((tr) => tr.to_place === TRANSPORT_AIRPORT && tr.from_place.replace(TRANSPORT_HOTEL_PREFIX, "").trim() === last);
    const unsold: DraftTransport[] =
      // a flight home planned but not yet ticketed still takes the group to the airport
      last && !seenOff && data.transport_plan.airport.enabled && data.flights.some((f) => f.leg_order === "inbound")
        ? [{ from_place: `${TRANSPORT_HOTEL_PREFIX}${last}`, to_place: TRANSPORT_AIRPORT, car_type: vehicleText(data.transport_plan.farewell ?? data.transport_plan.airport), date: null, note: "" }]
        : [];
    for (const tr of [...data.transport, ...unsold]) {
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
        if (flight && at && timed(at)) ({ date, time } = shift(at, MEET_AFTER_LANDING));
        else if (flight?.departure_at) date = flight.departure_at.slice(0, 10);
        meet = `صالة القادمين — ${flight ? code(flight.to_airport) : "المطار"}`;
      } else if (tr.to_place === TRANSPORT_AIRPORT && tr.from_place.startsWith(TRANSPORT_HOTEL_PREFIX)) {
        const city = tr.from_place.slice(TRANSPORT_HOTEL_PREFIX.length).trim();
        flight = firstOut(city, tr.date);
        const at = flight?.departure_at ?? null;
        if (flight && at && timed(at)) ({ date, time } = shift(at, -(flight.leg_order === "internal" ? BEFORE_DOMESTIC : BEFORE_INTL)));
        else if (at) date = at.slice(0, 10);
        meet = "بهو الفندق";
      } else {
        // between cities by road: after checking out
        time = "12:00";
        meet = "بهو الفندق";
      }
      date ??= dayOf(tr.from_place, tr.to_place);
      detail["الوقت"] = time || LATER;
      if (flight) detail["الرحلة"] = `${flight.flight_no.trim() || "—"} ${code(flight.from_airport)} → ${code(flight.to_airport)}`;
      detail["نقطة الالتقاء"] = meet;
      putCar(detail, tr.car_type ?? "");
      detail["الركاب"] = String(people);
      if (unsold.includes(tr)) detail[NOTICE] = FAREWELL_UNSOLD;
      const buy = buyOf(transportRef(tr));
      rows.push({
        // a row the agent added on the city card is its own booking, under its own words
        origin_ref: tr.ref ? `transfer:${tr.ref}` : `transfer:${tr.from_place}>${tr.to_place}>${date ?? ""}`,
        kind: "transport",
        title: tr.text || `${tr.from_place} ← ${tr.to_place}`,
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
    cities.forEach((city, c) => {
      // the last city's «جولة قبل المغادرة» is booked on the day home
      const picks = city.tours === undefined ? programmeTours(data, city) : withTours(city, city.tours, undefined, c === cities.length - 1);
      picks.forEach((pick, i) => {
        if (pick.free) return;
        const title = pick.title.trim() || `جولة سياحية في ${city.city_name}`;
        const detail: Record<string, string> = { المدينة: city.city_name, "وقت الانطلاق": "09:00" };
        // The day the group reaches the city is no 09:00 tour — the plane may not be down
        // yet (AD-2-3599): set off a while after a known landing, else «يُحدَّد لاحقاً», and say so.
        const arrival = pick.date && (pick.date === city.check_in || landsIn(city.city_name, pick.date));
        if (arrival) {
          const f = landsIn(city.city_name, pick.date!);
          const after = f?.arrival_at && timed(f.arrival_at) ? shift(f.arrival_at, TOUR_AFTER_LANDING) : null;
          detail["وقت الانطلاق"] = after && after.date === pick.date ? after.time : LATER;
        }
        // The day the group flies out the same way (AD-2-3599: «جولة قبل المغادرة» at 09:00
        // on the day home): back TOUR_BEFORE_TAKEOFF before a known take-off — set off earlier
        // when 09:00 would end too late, «يُحدَّد لاحقاً» when even EARLIEST_TOUR would.
        const departure = !arrival && pick.date && (pick.date === city.check_out || leavesFrom(city.city_name, pick.date));
        if (departure) {
          const f = leavesFrom(city.city_name, pick.date!);
          const latest = f?.departure_at && timed(f.departure_at) ? shift(f.departure_at, -(TOUR_BEFORE_TAKEOFF + TOUR_MINUTES)) : null;
          const fits = latest && latest.date === pick.date && latest.time >= EARLIEST_TOUR;
          detail["وقت الانطلاق"] = fits ? (latest.time < "09:00" ? latest.time : "09:00") : LATER;
        }
        // the car and how many — «فان» and 2, read together as «فان × 2»
        putCar(detail, tourVehicle(pick, data.transport_plan.tours.car_type));
        detail["الركاب"] = String(people);
        if (pick.text.trim()) detail["البرنامج"] = pick.text.trim();
        if (arrival) detail[NOTICE] = ARRIVAL_DAY_TOUR;
        else if (departure) detail[NOTICE] = DEPARTURE_DAY_TOUR;
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
          // the price is per car
          quoted_net: pick.price == null ? null : pick.price * tourCars(pick),
          currency: "SAR",
        });
      });
    });
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
      start_date: cities[0]?.check_in ?? data.trip.arrival_date,
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

/** A booking already on the case, as the pull compares it. */
export type ExistingBooking = {
  /** to link a booking typed by hand to the planned one it is (its origin_ref set). */
  id?: string;
  origin_ref: string | null;
  kind: string;
  title?: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  /** a hotel's catalogue id rides here (HOTEL_ID_KEY). */
  detail?: Record<string, string> | null;
};

/** A transfer's ref without its date — the pull wrote the farewell undated before it knew the day. */
const undated = (ref: string) => (ref.startsWith("transfer:") ? ref.replace(/>[^>]*$/, ">") : ref);
const dayPart = (d: string | null | undefined) => d?.slice(0, 10) ?? null;
/** A name before its « - …» — «نوفوتيل بالي نوسا دوا» of «نوفوتيل بالي نوسا دوا - فندق». */
const head = (s: string) => s.split(/\s[-–—]\s/)[0].trim();
/**
 * «نوفوتيل بالي» in «نوفوتيل بالي - غرفة مزدوجة شامل الإفطار» — the name the agent
 * typed, with or without the room after it; or the same name before two different
 * tails. A head of one word («فندق — يُحدَّد لاحقاً») says nothing.
 */
const sameName = (a: string | null | undefined, b: string | null | undefined) => {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const [hx, hy] = [head(x), head(y)];
  const short = hx.length < hy.length ? hx : hy;
  return short.split(" ").length >= 2 && (hx.includes(hy) || hy.includes(hx));
};
/**
 * The same city, spelling aside. An empty city is a city nobody wrote — it is no
 * city at all, not every city: a hotel typed by hand without one used to cover
 * any stay of its day (AD-2-3599).
 */
const sameCity = (a: string | null | undefined, b: string | null | undefined) => normalizeName(a) === normalizeName(b);
/** «فندق بالي — يُحدَّد لاحقاً»: a stay booked before its hotel was chosen. */
const unnamedStay = (title: string | undefined) => (title ?? "").trim().endsWith(LATER);

/**
 * The offer's city of an offer_hotels row, for an offer pulled without its draft:
 * the stop it names, else the one stop that prints its hotel, else the one whose
 * dates hold its check-in, else the trip's only city — "" when none says.
 */
export function offerHotelCity(
  h: { offer_city_id?: string | null; hotel_name: string | null; check_in: string | null },
  cities: { id: string; city_name: string; check_in: string | null; check_out: string | null; hotel_name?: string | null }[],
): string {
  const one = <T,>(list: T[]) => (list.length === 1 ? list[0] : undefined);
  const day = dayPart(h.check_in);
  const city =
    cities.find((c) => h.offer_city_id && c.id === h.offer_city_id) ??
    one(cities.filter((c) => sameName(c.hotel_name, h.hotel_name))) ??
    one(cities.filter((c) => day && c.check_in && dayPart(c.check_in)! <= day && (!c.check_out || day < dayPart(c.check_out)!))) ??
    one(cities);
  return city?.city_name.trim() ?? "";
}

/**
 * The hotels the OLD pull wrote («hotel:<offer_hotels.id>», no city, no
 * catalogue id), as their offer lines say they are — so newBookings compares
 * them stay by stay like any booking: the stay one IS links to it, and the
 * stays none is are still pulled. A single «hotel:» ref used to keep every
 * stay of the offer from being pulled at all.
 */
export function oldPullStays(
  existing: ExistingBooking[],
  lines: { id: string; hotel_id: string | null; offer_city_id?: string | null; hotel_name: string | null; check_in: string | null }[],
  cities: Parameters<typeof offerHotelCity>[1],
): ExistingBooking[] {
  return existing.map((e) => {
    const line = e.origin_ref?.startsWith("hotel:") ? lines.find((h) => `hotel:${h.id}` === e.origin_ref) : undefined;
    if (!line) return e;
    const detail = { ...(e.detail ?? {}) };
    if (line.hotel_id && !hotelIdOf(detail)) detail[HOTEL_ID_KEY] = line.hotel_id;
    return { ...e, city_name: e.city_name.trim() || offerHotelCity(line, cities), detail };
  });
}

/**
 * The offer's hotel line a booking is — never another's: its catalogue hotel
 * when both hold one, else its name; on its own dates and in its own city where
 * both say them. null when no line is, or more than one could be.
 */
export function offerHotelFor<T extends { hotel_id: string | null; hotel_name: string | null; check_in: string | null; check_out: string | null; city?: string }>(
  b: { title: string; city_name: string; start_date: string | null; end_date: string | null; detail?: Record<string, string> | null },
  lines: T[],
): T | null {
  const id = hotelIdOf(b.detail);
  const agree = (x: string | null | undefined, y: string | null | undefined) => !x || !y || x === y;
  const hits = lines.filter(
    (l) =>
      (id && l.hotel_id ? l.hotel_id === id : sameName(b.title, l.hotel_name)) &&
      agree(dayPart(b.start_date), dayPart(l.check_in)) &&
      agree(dayPart(b.end_date), dayPart(l.check_out)) &&
      (!b.city_name.trim() || !l.city?.trim() || sameCity(b.city_name, l.city)),
  );
  return hits.length === 1 ? hits[0] : null;
}

export type SeedMatch<T> = {
  /** what the pull inserts. */
  fresh: T[];
  /** bookings already on the case that ARE a planned one — given its origin_ref, so the next pull matches them outright. */
  links: { id: string; origin_ref: string }[];
};

/**
 * What a pull adds to a case: never a twin of what it already holds.
 *
 * Its own refs first — pressed again, the same plan adds nothing. Then the
 * rows the plan does not name (typed by hand before the pull brought them, or
 * pulled under an older ref) each stand in for what they cover: first the
 * surest pairs — the old ref (the farewell pulled undated), or the same kind,
 * day and city under the same name — then a hotel or a transfer of the same
 * kind, city and day under another name; the tours on the days of a car booked
 * for them («سيارة الجولات ٠١–٠٢»). Each row covers one booking (a tour car:
 * one tour a day), so two hotels on the same dates still need two. A row that
 * stands for one booking is linked to it.
 *
 * A hotel is its catalogue hotel (or, without one, its name): the same day
 * alone is not the same hotel. Another name stands in for a stay only when one
 * of the two was booked before its hotel was chosen, on the same nights. A city
 * matters wherever one is written — only a flight has none.
 */
export function newBookings<
  T extends Pick<PlannedBooking, "origin_ref" | "city_name" | "start_date" | "title"> & { kind: string; end_date?: string | null; detail?: Record<string, string> },
>(plan: T[], existing: ExistingBooking[]): SeedMatch<T> {
  const refs = new Set(existing.map((e) => e.origin_ref).filter(Boolean));
  const planned = new Set(plan.map((p) => p.origin_ref));
  const pool = existing
    .filter((e) => e.status !== "cancelled" && !(e.origin_ref && planned.has(e.origin_ref)))
    .map((e) => ({ ...e, start: dayPart(e.start_date), end: dayPart(e.end_date), used: new Set<string>() }));
  const pending = plan.filter((p) => !refs.has(p.origin_ref));
  const covered = new Set<T>();
  const links: SeedMatch<T>["links"] = [];
  const isTour = (p: T) => p.origin_ref.startsWith("tour:");
  type Held = (typeof pool)[number];
  const sameDay = (e: Held, p: T) => Boolean(e.start && e.start === dayPart(p.start_date) && (p.kind === "flight" || sameCity(e.city_name, p.city_name)));
  // the catalogue's hotel when both hold one — two ids are two hotels whatever their names
  const sameHotel = (e: Held, p: T) => {
    const [a, b] = [hotelIdOf(e.detail), hotelIdOf(p.detail)];
    return a && b ? a === b : sameName(e.title, p.title);
  };
  const sameNights = (e: Held, p: T) => !e.end || !p.end_date || e.end === dayPart(p.end_date);
  const standsFor = (e: Held, p: T) => p.kind !== "hotel" || ((unnamedStay(p.title) || unnamedStay(e.title)) && sameNights(e, p));
  const take = (p: T, hit: (typeof pool)[number] | undefined) => {
    if (!hit) return;
    const date = dayPart(p.start_date);
    hit.used.add(isTour(p) && date ? date : "*");
    covered.add(p);
    if (!isTour(p) && hit.id && hit.origin_ref !== p.origin_ref) links.push({ id: hit.id, origin_ref: p.origin_ref });
  };

  // 1. the surest pairs: the same drive under its old ref, or the same booking under the same name
  for (const p of pending) {
    if (isTour(p)) continue;
    take(
      p,
      pool.find(
        (e) =>
          e.used.size === 0 &&
          ((e.origin_ref && undated(e.origin_ref) === undated(p.origin_ref)) ||
            (e.kind === p.kind && sameDay(e, p) && (p.kind === "hotel" ? sameHotel(e, p) : sameName(e.title, p.title)))),
      ),
    );
  }
  // 2. what is left: the same kind, city and day under another name; a tour inside a tour car's days
  for (const p of pending) {
    if (covered.has(p)) continue;
    const date = dayPart(p.start_date);
    if (!date) continue;
    take(
      p,
      pool.find((e) =>
        isTour(p)
          ? (e.kind === "service" || e.kind === "transport") &&
            Boolean(e.start) &&
            sameCity(e.city_name, p.city_name) &&
            e.start! <= date &&
            date <= (e.end ?? e.start!) &&
            !e.used.has(date) &&
            !e.used.has("*")
          : e.kind === p.kind && e.used.size === 0 && sameDay(e, p) && standsFor(e, p),
      ),
    );
  }
  return { fresh: pending.filter((p) => !covered.has(p)), links };
}
