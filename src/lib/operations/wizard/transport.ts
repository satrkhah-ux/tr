import type { OperationBooking } from "@/lib/data/operation-bookings";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { DRV, driverServiceKind, flightLegs, linkOf, meetTime, type ServiceKind } from "@/lib/operations/drivers";
import type { RequestState } from "@/lib/operations/supplier-request";
import { shift, TOUR_AFTER_LANDING, TOUR_BEFORE_TAKEOFF, TOUR_MINUTES } from "@/lib/operations/seed-plan";
import { notPulled } from "./pull";
import type { ReadinessItem, StepState, WizardCase } from "./types";

/**
 * «المواصلات» (the owner, 2026-10-17): the reception and farewell transfers AND
 * the tour cars, worked BY CITY. A city's trips go to one ground agent, in one
 * request, and come back under one confirmation; its driver is typed once.
 * Before, 4 transfers + 3 tours were 7 separate bookings, each with its own
 * executor, request and confirmation.
 *
 * Nothing is stored per city: a city is the bookings that name it, and every
 * action writes the same per-booking columns the one-page case writes — so the
 * voucher, the drivers' sheet and the client's page read what they always read.
 *
 * Pure: no React, no Supabase.
 */

export type Driver = { name: string; phone: string };

export type TransportTrip = {
  booking: OperationBooking;
  kind: ServiceKind;
  /** the meeting / start time as the booking holds it — "" while «يُحدَّد لاحقاً». */
  time: string;
  driver: Driver;
};

export type TransportCity = {
  /** normalised, for grouping and the usual-agent lookup — "" when no booking names a city. */
  key: string;
  /** as the bookings write it. */
  name: string;
  /** by date, then time. */
  trips: TransportTrip[];
  /** the supplier most of its trips are handed to — what the picker opens on. */
  supplierId: string | null;
  /** every trip handed to one of our suppliers (readiness). */
  supplied: boolean;
  /** every trip confirmed (readiness). */
  confirmed: boolean;
  /** where the city's request stands — its worst trip still open. */
  request: RequestState;
  /** the oldest request still unanswered, for «بلا رد منذ … س». */
  sentAt: string | null;
  /** the driver most of its trips carry — what «السائق للمدينة» opens on. */
  driver: Driver;
};

/** The city a trip belongs to: the booking's own, else the one its detail names (a tour). */
export const cityOf = (b: Pick<OperationBooking, "city_name" | "detail">) => b.city_name.trim() || (b.detail?.["المدينة"] ?? "").trim();

const driverOf = (b: OperationBooking): Driver => ({ name: (b.detail?.[DRV.driver] ?? "").trim(), phone: (b.detail?.[DRV.phone] ?? "").trim() });

const sameDriver = (a: Driver, b: Driver) => a.name === b.name && a.phone === b.phone;

/** The value most items carry; the earliest on a tie. */
function mostCommon<T>(items: T[], same: (a: T, b: T) => boolean): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const item of items) {
    const count = items.filter((x) => same(x, item)).length;
    if (count > bestCount) [best, bestCount] = [item, count];
  }
  return best;
}

// an open request is as good as its worst trip: nobody asked < declined < silent too long < sent
const WORST: RequestState[] = ["none", "declined", "overdue", "sent"];

/** The case's drives and tours, one card per city, in the order the trip reaches them. */
export function transportCities(data: Pick<WizardCase, "bookings" | "supplierWork">): TransportCity[] {
  const work = new Map((data.supplierWork?.bookings ?? []).map((w) => [w.booking_id, w]));
  const byCity = new Map<string, TransportTrip[]>();
  for (const b of data.bookings) {
    if (b.status === "cancelled") continue;
    const kind = driverServiceKind(b);
    if (!kind) continue;
    const key = normalizeName(cityOf(b));
    byCity.set(key, [...(byCity.get(key) ?? []), { booking: b, kind, time: meetTime(b), driver: driverOf(b) }]);
  }

  const when = (t: TransportTrip) => `${t.booking.start_date ?? "9999"} ${t.time || "99:99"}`;
  return [...byCity.entries()]
    .map(([key, list]): TransportCity => {
      const trips = [...list].sort((a, b) => when(a).localeCompare(when(b)));
      const open = trips.filter((t) => t.booking.status !== "confirmed");
      const states = open.map((t) => work.get(t.booking.id)?.state ?? "none");
      const sent = open.map((t) => work.get(t.booking.id)?.sent_at).filter((s): s is string => !!s).sort();
      const supplierIds = trips.map((t) => (t.booking.assignee_kind === "supplier" ? t.booking.assignee_supplier_id : null));
      return {
        key,
        name: trips.map((t) => cityOf(t.booking)).find(Boolean) ?? "",
        trips,
        supplierId: mostCommon(supplierIds.filter((s): s is string => !!s), (a, b) => a === b),
        supplied: supplierIds.every(Boolean),
        confirmed: open.length === 0,
        request: open.length === 0 ? "confirmed" : (WORST.find((s) => states.includes(s)) ?? "none"),
        sentAt: sent[0] ?? null,
        driver: mostCommon(trips.map((t) => t.driver).filter((d) => d.name || d.phone), sameDriver) ?? { name: "", phone: "" },
      };
    })
    .sort((a, b) => when(a.trips[0]).localeCompare(when(b.trips[0])));
}

/** A leg the case flies, as wall clocks («YYYY-MM-DDTHH:mm»): null while not timed; its days even then. */
type CaseLeg = { from: string; to: string; departs: string | null; arrives: string | null; leaves: string | null; lands: string | null };

/**
 * Every leg of the case's flights: the ticket's (flight_legs) once read, else
 * the plan's lines — whose day is known before their time («2026-10-07 يُحدَّد لاحقاً»).
 */
function caseLegs(bookings: OperationBooking[]): CaseLeg[] {
  const leg = (from: string, to: string, departs: string | null, arrives: string | null, day: string | null): CaseLeg => {
    const leaves = departs?.slice(0, 10) ?? day;
    return { from, to, departs, arrives, leaves, lands: arrives?.slice(0, 10) ?? leaves };
  };
  return bookings
    .filter((b) => b.kind === "flight")
    .flatMap((b) =>
      b.flight_legs?.length
        ? b.flight_legs.map((l) => leg(l.from, l.to, l.departs_at?.slice(0, 16) ?? null, l.arrives_at?.slice(0, 16) ?? null, null))
        : flightLegs(b.detail ?? {}).map(({ key, leg: l }) =>
            leg(l.from, l.to, l.departure, l.arrival, b.detail[key]?.split("·")[2]?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null),
          ),
    );
}

const plus = (at: string, minutes: number) => {
  const s = shift(at, minutes);
  return `${s.date}T${s.time}`;
};

/** «تعارض مع الرحلة»: a tour set off before the group has landed and settled, or ending too near its take-off. */
export type TourClash = "arrival" | "departure";

/**
 * The tours whose time fights their day's flight (AD-2-3599: tours pulled at
 * 09:00 on the day the group lands, and on the day it flies home) — the rule a
 * new pull keeps (seed-plan.ts), checked on what was pulled before it and never
 * rewritten here:
 *   - the day the group reaches the tour's city (a hotel there checks in, or its
 *     reception): set off TOUR_AFTER_LANDING after the landing at the latest;
 *   - the day it leaves (a hotel there checks out, or its farewell): back
 *     TOUR_BEFORE_TAKEOFF before the take-off, a tour lasting TOUR_MINUTES.
 * A flight that day whose time is not known yet clashes with any fixed time —
 * the pull would have written «يُحدَّد لاحقاً». The city's airports are read off
 * its receptions and farewells; a city without them takes any flight that day.
 * Tour id → which clash.
 */
export function tourClashes(bookings: OperationBooking[]): Map<string, TourClash> {
  const live = bookings.filter((b) => b.status !== "cancelled");
  const legs = caseLegs(live);
  const out = new Map<string, TourClash>();
  if (legs.length === 0) return out;
  for (const tour of live) {
    const day = tour.start_date;
    const time = meetTime(tour);
    if (driverServiceKind(tour) !== "tour" || !day || !/^\d{2}:\d{2}$/.test(time)) continue;
    const city = normalizeName(cityOf(tour));
    const there = live.filter((b) => normalizeName(cityOf(b)) === city);
    const kinds = there.map((b) => ({ b, kind: driverServiceKind(b), link: linkOf(b.detail?.[DRV.flight]) }));
    const airports = new Set(kinds.flatMap(({ kind, link }) => (!link ? [] : kind === "reception" ? [link.to] : kind === "farewell" ? [link.from] : [])));
    const here = (code: string) => airports.size === 0 || airports.has(code);
    const starts = `${day}T${time}`;

    const arriving = kinds.some(({ b, kind }) => b.start_date === day && (b.kind === "hotel" || kind === "reception"));
    const landings = arriving ? legs.filter((l) => l.lands === day && here(l.to)) : [];
    if (landings.some((l) => !l.arrives || starts < plus(l.arrives, TOUR_AFTER_LANDING))) {
      out.set(tour.id, "arrival");
      continue;
    }
    const leaving = kinds.some(({ b, kind }) => (b.kind === "hotel" && b.end_date === day) || (kind === "farewell" && b.start_date === day));
    const takeoffs = leaving ? legs.filter((l) => l.leaves === day && here(l.from)) : [];
    const ends = plus(starts, TOUR_MINUTES);
    if (takeoffs.some((l) => !l.departs || ends > plus(l.departs, -TOUR_BEFORE_TAKEOFF))) out.set(tour.id, "departure");
  }
  return out;
}

/** A trip whose driver was set apart from the city's — shown, and kept when the city's driver changes. */
export const driverDiffers = (trip: TransportTrip, city: TransportCity) =>
  Boolean(trip.driver.name || trip.driver.phone) && !sameDriver(trip.driver, city.driver);

/**
 * The trips «السائق للمدينة» writes to: every trip still without a driver or
 * carrying the city's current one. A trip given a different driver on its own
 * keeps him — editing the city never undoes an exception made on purpose.
 */
export function driverTargets(city: TransportCity): string[] {
  return city.trips.filter((t) => !driverDiffers(t, city)).map((t) => t.booking.id);
}

/**
 * The trips a city's request is about: those not yet confirmed, all with one
 * supplier — the message goes to that supplier and marks each of them asked.
 * null when a trip has no supplier or the city's trips sit with several.
 */
export function requestTrips(city: TransportCity): { supplierId: string; ids: string[] } | null {
  const open = city.trips.filter((t) => t.booking.status !== "confirmed").map((t) => t.booking);
  const supplierId = open[0]?.assignee_supplier_id;
  if (!supplierId || open.some((b) => b.assignee_kind !== "supplier" || b.assignee_supplier_id !== supplierId)) return null;
  return { supplierId, ids: open.map((b) => b.id) };
}

/** «na» with no drive or tour in the offer; done once every city has its supplier and its confirmation. */
export function transportState(data: Pick<WizardCase, "bookings" | "supplierWork" | "offerKinds">): StepState {
  const cities = transportCities(data);
  if (cities.length === 0) return notPulled(data, "transport") ? "todo" : "na";
  return cities.every((c) => c.supplied && c.confirmed) ? "done" : "todo";
}

/**
 * Before «جاهز للسفر»: a supplier and a confirmation for every city; the
 * driver's name is asked for but does not block — it is often known only the
 * day before.
 */
export function transportReadiness(data: Pick<WizardCase, "bookings" | "supplierWork">): ReadinessItem[] {
  const cities = transportCities(data);
  if (cities.length === 0) return notPulled(data, "transport") ? [{ step: "transport", key: "pulled", ok: false }] : [];
  const items: ReadinessItem[] = [
    { step: "transport", key: "supplier", ok: cities.every((c) => c.supplied) },
    { step: "transport", key: "confirmed", ok: cities.every((c) => c.confirmed) },
    { step: "transport", key: "driver", ok: cities.every((c) => c.trips.every((t) => t.driver.name)), optional: true },
  ];
  // a warning, listed only while a tour's time fights its flight
  if (tourClashes(data.bookings).size > 0) items.push({ step: "transport", key: "tour_times", ok: false, optional: true, warning: true });
  return items;
}
