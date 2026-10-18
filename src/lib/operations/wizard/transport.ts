import type { OperationBooking } from "@/lib/data/operation-bookings";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { DRV, driverServiceKind, meetTime, type ServiceKind } from "@/lib/operations/drivers";
import type { RequestState } from "@/lib/operations/supplier-request";
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

/** «na» with no drive or tour on the file; done once every city has its supplier and its confirmation. */
export function transportState(data: Pick<WizardCase, "bookings" | "supplierWork">): StepState {
  const cities = transportCities(data);
  if (cities.length === 0) return "na";
  return cities.every((c) => c.supplied && c.confirmed) ? "done" : "todo";
}

/**
 * Before «جاهز للسفر»: a supplier and a confirmation for every city; the
 * driver's name is asked for but does not block — it is often known only the
 * day before.
 */
export function transportReadiness(data: Pick<WizardCase, "bookings" | "supplierWork">): ReadinessItem[] {
  const cities = transportCities(data);
  if (cities.length === 0) return [];
  return [
    { step: "transport", key: "supplier", ok: cities.every((c) => c.supplied) },
    { step: "transport", key: "confirmed", ok: cities.every((c) => c.confirmed) },
    { step: "transport", key: "driver", ok: cities.every((c) => c.trips.every((t) => t.driver.name)), optional: true },
  ];
}
