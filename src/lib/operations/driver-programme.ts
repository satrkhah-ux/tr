/**
 * What the driver — or the city's local agent — is sent (the owner, 2026-10-17):
 * TWO messages for the whole of their part of the trip, instead of one card per
 * drive. The programme (with the arrival sign attached), then the hotels.
 *
 * Bilingual labels, Arabic content (the driver abroad may not read Arabic, the
 * agent who forwards it does). A fact we do not have yet is never printed as
 * «—»: a flight's number or time reads «يُبلَّغ لاحقاً», and a hotel's missing
 * address or phone is left out and raised as a warning before anything is sent.
 *
 * Pure: no React, no Supabase.
 */

import type { FlightLeg } from "@/lib/data/operation-bookings";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { linkOf, type ServiceKind } from "./drivers";
import { CLIENT_HOTEL, OUTSIDE_US } from "./seed-plan";
import type { TransportCity } from "./wizard/transport";

export const LATER = "يُبلَّغ لاحقاً / TBA";

export type ProgrammeTrip = {
  kind: ServiceKind;
  title: string;
  city: string;
  date: string | null;
  /** the meeting / start time, "" while unknown. */
  time: string;
  /** «SV834 RUH → KUL» — the flight a reception or drop-off meets (drivers.ts DRV.flight). */
  flight: string;
  car: string;
};

export type ProgrammeStay = {
  name: string;
  name_en: string | null;
  city: string;
  check_in: string | null;
  check_out: string | null;
  address: string | null;
  phone: string | null;
  /** the hotel's own google_maps link from /hotels. */
  map: string | null;
  /** the city's coordinates (cities.lat / lng) — places a name search when the hotel has no link. */
  coords: { lat: number; lng: number } | null;
};

export type ProgrammeInput = {
  serial: string;
  from: string | null;
  to: string | null;
  customer: string;
  travellers: number;
  country: string;
  /** the recipient's trips only — their city or cities. */
  trips: ProgrammeTrip[];
  /** the hotels of those cities. */
  stays: ProgrammeStay[];
  /** every leg of the case's flight bookings (operation_bookings.flight_legs). */
  legs: FlightLeg[];
  /** IATA code → the airport's Arabic name. */
  airports: Record<string, string>;
  emergency: string;
};

/** 2026-10-20 → 20/10 */
const dm = (iso: string | null | undefined) => {
  const m = iso?.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : "";
};
const dmy = (iso: string | null | undefined) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/** The local date and time an ISO-with-offset stamp names — the airport's own clock, no conversion. */
function local(iso: string | null | undefined): { date: string; time: string } | null {
  const m = iso?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : null;
}

const plus = (s: string) => s.replace(/[?#&%/\\]+/g, " ").trim().replace(/\s+/g, "+");

/**
 * A map link a driver can tap and read: the hotel's own link from /hotels,
 * else its name searched around its city. Spaces as «+», never percent-encoded.
 */
export function hotelMap(stay: Pick<ProgrammeStay, "name" | "name_en" | "city" | "map" | "coords">): string {
  const own = stay.map?.trim();
  if (own && /^https?:\/\//.test(own)) return own;
  const name = /[A-Za-z]/.test(stay.name_en ?? "") ? stay.name_en!.trim() : stay.name.trim();
  return stay.coords
    ? `https://www.google.com/maps/search/${plus(name)}/@${stay.coords.lat},${stay.coords.lng},14z`
    : `https://www.google.com/maps/search/${plus(`${name} ${stay.city}`)}`;
}

/**
 * Who gets a city's part: its driver once named, else the supplier its trips
 * are with — the local agent. Cities with the same recipient travel together;
 * a city with a different one is never sent the others' trips or hotels.
 * "" while the city has neither.
 */
export function recipientKey(city: TransportCity): string {
  const { name, phone } = city.driver;
  if (phone) return `tel:${phone.replace(/\D/g, "")}`;
  if (name) return `drv:${normalizeName(name)}`;
  return city.supplierId ? `sup:${city.supplierId}` : "";
}

/**
 * The hotels the client booked himself (Order 7): no booking of ours, but written on the drives and tours that go
 * to them (seed-plan CLIENT_HOTEL) — the driver is told where they are all the same. Once per city.
 */
export function clientStays(trips: { city: string; detail?: Record<string, string> | null }[]): ProgrammeStay[] {
  const out = new Map<string, ProgrammeStay>();
  for (const t of trips) {
    const name = t.detail?.[CLIENT_HOTEL.name]?.split(` — ${OUTSIDE_US}`)[0].trim();
    const key = `${normalizeName(t.city)}|${normalizeName(name)}`;
    if (!name || out.has(key)) continue;
    const address = t.detail?.[CLIENT_HOTEL.address]?.trim() || null;
    const phone = t.detail?.[CLIENT_HOTEL.phone]?.trim() || null;
    out.set(key, { name, name_en: null, city: t.city, check_in: null, check_out: null, address, phone, map: address && /^https?:\/\//.test(address) ? address : null, coords: null });
  }
  return [...out.values()];
}

/** The hotel of a city on a day — the stay covering it, else the city's first. */
function stayOn(stays: ProgrammeStay[], city: string, date: string | null): ProgrammeStay | null {
  const here = stays.filter((s) => normalizeName(s.city) === normalizeName(city));
  return here.find((s) => date && (s.check_in ?? "") <= date && date <= (s.check_out ?? s.check_in ?? "")) ?? here[0] ?? null;
}

const hotelName = (s: ProgrammeStay) => (s.name_en && /[A-Za-z]/.test(s.name_en) && s.name_en !== s.name ? `${s.name} / ${s.name_en}` : s.name);

/** The leg a reception or drop-off meets: by number, else by route — on its day when the route repeats. */
function legOf(trip: ProgrammeTrip, legs: FlightLeg[]): { leg: FlightLeg | null; from: string; to: string; flight_no: string } | null {
  const link = linkOf(trip.flight);
  if (!link) return null;
  const at = (l: FlightLeg) => local(trip.kind === "farewell" ? l.departs_at : l.arrives_at)?.date;
  const route = legs.filter((l) => l.from === link.from && l.to === link.to);
  const leg =
    (link.flight_no ? legs.find((l) => l.flight_no === link.flight_no) : undefined) ??
    route.find((l) => trip.date && at(l) === trip.date) ??
    route[0] ??
    null;
  return { leg, from: link.from, to: link.to, flight_no: leg?.flight_no || link.flight_no };
}

/** «✈️ الوصول / Arrival: مطار طرابزون TZX · 20/10 · رحلة / Flight TK2834 · 14:30». */
function airportLine(trip: ProgrammeTrip, input: ProgrammeInput): string | null {
  const hit = legOf(trip, input.legs);
  if (!hit) return null;
  const arrival = trip.kind === "reception";
  const code = arrival ? hit.to : hit.from;
  const when = local(arrival ? hit.leg?.arrives_at : hit.leg?.departs_at);
  return [
    `✈️ ${arrival ? "الوصول / Arrival" : "المغادرة / Departure"}: ${[input.airports[code], code].filter(Boolean).join(" ")}`,
    dm(when?.date ?? trip.date) || null,
    `رحلة / Flight: ${hit.flight_no || LATER}`,
    `الوقت / Time: ${when?.time ?? LATER}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One line of the programme, as the owner wrote them: «21/10 · 09:00 · جولة حيدر نبي». */
function tripLine(trip: ProgrammeTrip, input: ProgrammeInput): string {
  const stay = stayOn(input.stays, trip.city, trip.date);
  const airport = () => {
    const code = linkOf(trip.flight)?.from;
    return (code && input.airports[code]) || `المطار${code ? ` ${code}` : ""}`;
  };
  const what =
    trip.kind === "reception"
      ? `استقبال من المطار ← ${stay ? hotelName(stay) : trip.title}`
      : trip.kind === "farewell"
        ? `توديع ← ${airport()}`
        : trip.kind === "tour"
          ? trip.title.replace(/^جولة:\s*/, "")
          : trip.title;
  return [dm(trip.date), trip.time, what].filter(Boolean).join(" · ");
}

const when = (t: ProgrammeTrip) => `${t.date ?? "9999"} ${t.time || "99:99"}`;

/** Message 1 — the programme. */
export function programmeMessage(input: ProgrammeInput): string {
  const trips = [...input.trips].sort((a, b) => when(a).localeCompare(when(b)));
  const cars = [...new Set(trips.map((t) => t.car).filter(Boolean))];
  const airports = trips.filter((t) => t.kind === "reception" || t.kind === "farewell").map((t) => airportLine(t, input));
  return [
    `برنامج السائق / Driver programme — ${input.serial}`,
    `الحجز / Booking: ${input.serial}${input.from ? ` · ${dmy(input.from)} → ${dmy(input.to ?? input.from)}` : ""}`,
    `اسم الزبون / Guest: ${input.customer || "—"} · ${input.travellers} مسافر / pax`,
    input.country ? `الدولة / Country: ${input.country}` : null,
    cars.length > 0 ? `السيارة / Car: ${cars.join("، ")}` : null,
    ...airports,
    "",
    "البرنامج / Programme:",
    ...trips.map((t) => tripLine(t, input)),
    "",
    `للطوارئ / Emergency: ${input.emergency}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export type HotelGap = { hotel: string; missing: ("address" | "phone")[] };

/** Message 2 — the hotels, and what is missing from them (warned, never printed as «—»). */
export function hotelsMessage(input: Pick<ProgrammeInput, "serial" | "stays">): { body: string; gaps: HotelGap[] } {
  const gaps: HotelGap[] = [];
  const blocks = input.stays.map((s) => {
    const missing = [...(s.address?.trim() ? [] : ["address" as const]), ...(s.phone?.trim() ? [] : ["phone" as const])];
    if (missing.length > 0) gaps.push({ hotel: s.name, missing });
    return [
      `🏨 ${hotelName(s)} — ${s.city}`,
      `الدخول / Check-in: ${dm(s.check_in) || LATER} · الخروج / Check-out: ${dm(s.check_out) || LATER}`,
      s.address?.trim() ? `العنوان / Address: ${s.address.trim()}` : null,
      s.phone?.trim() ? `الهاتف / Phone: ${s.phone.trim()}` : null,
      `الموقع / Map: ${hotelMap(s)}`,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");
  });
  return { body: [`فنادق الرحلة / Hotels — ${input.serial}`, ...blocks.flatMap((b) => ["", b])].join("\n"), gaps };
}

/**
 * What changed since the programme last sent to this driver — a flight's time
 * filled in, a tour moved — as its own short message, or null when nothing did.
 */
export function programmeUpdate(previous: string | null, current: string, serial: string): string | null {
  if (!previous || previous.trim() === current.trim()) return null;
  const before = new Set(previous.split("\n").map((l) => l.trim()));
  const changed = current
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !before.has(l) && l !== "البرنامج / Programme:");
  return changed.length > 0 ? [`تحديث / Update — ${serial}`, ...changed].join("\n") : null;
}
