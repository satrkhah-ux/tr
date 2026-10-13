/**
 * Build the pricing sheet from what the draft already knows.
 *
 * Every number on this sheet used to be typed twice: once on the hotel card as
 * «سعر الإقامة», once more here. The second typing is where a quote goes wrong
 * — a digit dropped, a line forgotten, a transfer priced from memory.
 *
 * So the sheet is derived. A line is created for every stay, flight leg,
 * transfer, visa and included service, and each one is priced from the best
 * source available, in a fixed order of trust:
 *
 *   a supplier's quote  >  what the agent typed  >  what this room last cost
 *   >  the agency's own price list  >  nothing, and the line says so
 *
 * Pure: no React, no Supabase. The caller loads the reference rows and passes
 * them in, which is what makes the matching testable — and matching is where
 * the money is lost.
 */

import {
  deriveCityDates,
  FREE_DAY_TITLE,
  deriveHotelStays,
  pricingRefFor,
  stayTotal,
  TRANSPORT_AIRPORT,
  TRANSPORT_HOTEL_PREFIX,
  TRANSPORT_MODE_AR,
  TRANSPORT_TOURS,
  type DraftData,
} from "./draft-types";
import { itineraryStartDate } from "./schedule";
import type { DraftPricingItem } from "./draft-types";
import { splitTourName } from "@/lib/catalog/model";

/** A transfer price from the reference list. */
export type TransferPrice = {
  from_city: string;
  to_city: string;
  car_type: string | null;
  price: number;
  currency: string | null;
  /** when the row was written — two rows for one road and vehicle, the newer wins. */
  created_at?: string | null;
  /** the old system's row id, for imported rows — what orders them when the timestamp cannot. */
  legacy_id?: number | null;
};

/** One of the agency's own vehicles — what «نوع السيارة» can be. */
export type FleetVehicle = { name: string; pax: number };

/** A per-country service price from the reference list. */
export type ServicePrice = {
  service_type: string | null;
  arabic_name: string | null;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  /** as on TransferPrice: the same service filed twice, the newer row is the price. */
  created_at?: string | null;
  legacy_id?: number | null;
};

/** What a room last cost here — hotel_rate_memory, plus the offer history. */
export type RoomPrice = {
  hotel_id: string | null;
  hotel_name: string;
  room_type_name: string;
  board_type: string | null;
  price: number;
  currency: string;
  /** true for hotel_rate_memory rows (0054): `price` is ONE night of ONE room. */
  per_night?: boolean;
};

export type PricingReference = {
  transfers: TransferPrice[];
  services: ServicePrice[];
  rooms: RoomPrice[];
  fleet: FleetVehicle[];
  /** the company's tours price list for the trip's country (/cars/tours). */
  tours?: TourPrice[];
  /** transfers priced from a point to an area (0072 from/to kind + id) — read before the text rows. */
  points?: PointTransfer[];
};

/**
 * A tour on the company's price list. Since 0072 a tour is one record priced per
 * vehicle (tour_prices): `car_type` names the vehicle; an entry without one is
 * the tour's own single price. `program_id` is the ready programme it is.
 */
export type TourPrice = { name: string; price: number; currency: string; car_type?: string | null; program_id?: string | null };

/**
 * The listed price of a tour — the programme it was picked from, else the same
 * name however it was spelled — for the car it goes in. A tour priced per car
 * is only priced for a car it lists: a sedan's price is not the bus's. The old
 * per-car names («جولة X (فان)») still find the grouped tour.
 */
export function findTourPrice(
  list: TourPrice[] | undefined,
  title: string,
  carType?: string | null,
  programId?: string | null,
): TourPrice | null {
  const rows = list ?? [];
  const key = normalizeName(title);
  let hits = programId ? rows.filter((t) => t.program_id === programId) : [];
  if (hits.length === 0 && key) hits = rows.filter((t) => normalizeName(t.name) === key);
  let car = baseVehicle(carType);
  if (hits.length === 0) {
    const split = splitTourName(title);
    if (!split) return null;
    hits = rows.filter((t) => normalizeName(t.name) === normalizeName(split.base));
    car = car || baseVehicle(split.car);
  }
  const perCar = hits.filter((t) => t.car_type?.trim());
  if (car && perCar.length > 0) return perCar.find((t) => baseVehicle(t.car_type) === car) ?? null;
  return hits.find((t) => !t.car_type?.trim()) ?? (perCar.length === 1 ? perCar[0] : null);
}

/**
 * Arabic typed by different people is different text: «إسطنبول» and
 * «اسطنبول», «عُمان» and «عمان». Matching on the raw string finds almost
 * nothing, and a transfer that does not match is a transfer priced at zero.
 */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/\s+/g, " ");
}

/** The vehicle, without the «× 2» the count adds — the price is per vehicle. */
function baseVehicle(carType: string | null | undefined): string {
  return normalizeName((carType ?? "").replace(/\s*×\s*\d+\s*$/, ""));
}

/** How many vehicles a derived transport row describes. */
function vehicleCount(carType: string | null | undefined): number {
  const m = (carType ?? "").match(/×\s*(\d+)\s*$/);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Two rows for the same road and vehicle (or the same service): the newer one is the price. */
function latest<T extends { created_at?: string | null; legacy_id?: number | null }>(rows: T[]): T {
  const time = (row: T) => (row.created_at ? Date.parse(row.created_at) || 0 : 0);
  return rows.reduce((best, row) => {
    if (time(row) !== time(best)) return time(row) > time(best) ? row : best;
    // The legacy import stamped every row with one timestamp and kept the
    // retired prices beside the current one. The old system's current price is
    // always the row it wrote LAST (452 roads of 452) — and never the higher
    // number: retired prices run both ways, some in another currency.
    // ponytail: a road whose every legacy row was retired still quotes the last
    // of them. Upgrade: delete the retired legacy rows.
    return (row.legacy_id ?? -1) > (best.legacy_id ?? -1) ? row : best;
  });
}

/**
 * The price of one leg.
 *
 * The exact direction first, the reverse only when the list knows the road one
 * way: the way back is the same car over the same road, but some roads ARE
 * priced per direction (جوهور بارو ↔ جنتنج on the 16-seat bus: 1000 one way,
 * 1100 the other). The vehicle must match exactly — a sedan's price on a
 * 40-seat bus is not an approximation, it is a wrong number.
 *
 * No vehicle chosen yet: the smallest of the agency's own vehicles that seats
 * the group AND has a price on this road. The old "cheapest on the road"
 * priced a two-seat car for nine people.
 */
export function findTransferPrice(
  list: TransferPrice[],
  from: string,
  to: string,
  carType: string | null,
  pax = 1,
  fleet: FleetVehicle[] = [],
): TransferPrice | null {
  const a = normalizeName(from);
  const b = normalizeName(to);
  if (!a || !b) return null;

  const pick = (x: string, y: string, vehicle: string) => {
    const rows = list.filter(
      (row) => normalizeName(row.from_city) === x && normalizeName(row.to_city) === y && baseVehicle(row.car_type) === vehicle,
    );
    return rows.length > 0 ? latest(rows) : null;
  };
  const priceFor = (vehicle: string) => pick(a, b, vehicle) ?? pick(b, a, vehicle);

  const car = baseVehicle(carType);
  if (car) return priceFor(car);

  for (const vehicle of [...fleet].sort((x, y) => x.pax - y.pax)) {
    if (vehicle.pax < pax) continue;
    const hit = priceFor(baseVehicle(vehicle.name));
    if (hit) return hit;
  }
  return null;
}

/**
 * Airport ↔ city, when the plan only says «المطار».
 *
 * The list names the airport («مطار كوالالمبور الدولي → ايبوه»), so which
 * airport is decided, in this order:
 *   1. the airports this draft lands at (`flown` = arrival airports for the
 *      way in, departure airports for the way out) — a transit airport drops
 *      out on its own, having no row to this city;
 *   2. no flights yet: the airport named after the city;
 *   3. the only airport the list has for this city.
 * Still more than one (Penang is reached from KUL and from PEN) → null, and
 * the agent decides. A wrong airport is a wrong price that looks right — so
 * flights that name an airport the list spells differently («مطار صبيحة كوكجن»
 * against «مطار صبيحة جوكشين الدولي») never fall back to the city's namesake.
 */
export function findAirportTransfer(
  list: TransferPrice[],
  city: string,
  leaving: boolean,
  flown: string[],
  carType: string | null,
  pax = 1,
  fleet: FleetVehicle[] = [],
): TransferPrice | null {
  const c = normalizeName(city);
  if (!c) return null;

  const isAirport = (name: string) => normalizeName(name).includes("مطار");
  const rows = list.filter(
    (row) =>
      (isAirport(row.from_city) && normalizeName(row.to_city) === c) ||
      (isAirport(row.to_city) && normalizeName(row.from_city) === c),
  );
  const airports = [...new Set(rows.map((row) => normalizeName(isAirport(row.from_city) ? row.from_city : row.to_city)))];
  // «مطار كوالالمبور الدولي (KUL)» is how a flight stores it; the list has the name.
  // The airports table and the list name the same airport two ways («مطار إسطنبول»
  // and «مطار اسطنبول الدولي»), so either name containing the other is a match.
  const flownNames = flown.map((a) => normalizeName(a.replace(/\s*\([A-Z0-9]{3,5}\)\s*$/, ""))).filter(Boolean);

  const byFlight = airports.filter((a) => flownNames.some((f) => a.includes(f) || f.includes(a)));
  const byName = airports.filter((a) => a.includes(c));
  const pool = byFlight.length > 0 ? byFlight : flownNames.length > 0 ? airports : byName.length > 0 ? byName : airports;
  if (pool.length !== 1) return null;

  // The departure leg is the same road the other way: city → airport is tried
  // first, and findTransferPrice falls back to the arrival row.
  return leaving
    ? findTransferPrice(rows, c, pool[0], carType, pax, fleet)
    : findTransferPrice(rows, pool[0], c, carType, pax, fleet);
}

// ---------- transfers priced from a point to an area (data model 0072) ----------

/** What a transfer starts or ends at: an airport, station or port (rows of /airports), or a city. */
export type PointKind = "airport" | "station" | "port" | "city";

/** A transfer row with its two ends resolved: what each end is, its name, and an airport's code. */
export type PointTransfer = {
  from_kind: PointKind;
  from_name: string;
  from_code: string | null;
  to_kind: PointKind;
  to_name: string;
  to_code: string | null;
  car_type: string | null;
  price: number;
  currency: string | null;
  created_at?: string | null;
};

/**
 * Reception or farewell: the price from the airport the group uses to the city
 * it stays in, for its car — then, when no airport row has it, the city's own
 * in-city row (city → same city). The car is the leg's own, else the smallest
 * of the fleet that seats the group (findTransferPrice), as for any road.
 *
 * Which airport: the one the flights name (by IATA code, else by name); with no
 * flight, the only one listed for the city. Two candidates and no flight to
 * decide between them → no price; the agent decides, as findAirportTransfer does.
 */
export function resolveAirportCity(
  rows: PointTransfer[],
  city: string,
  leaving: boolean,
  flown: string[],
  carType: string | null,
  pax = 1,
  fleet: FleetVehicle[] = [],
): TransferPrice | null {
  const c = normalizeName(city);
  if (!c) return null;
  const isPoint = (kind: PointKind) => kind !== "city";
  const isCity = (kind: PointKind, name: string) => kind === "city" && normalizeName(name) === c;
  const end = (r: PointTransfer, side: "from" | "to") =>
    side === "from" ? { code: r.from_code?.toUpperCase() ?? null, name: normalizeName(r.from_name) } : { code: r.to_code?.toUpperCase() ?? null, name: normalizeName(r.to_name) };
  const pointOf = (r: PointTransfer) => (isPoint(r.from_kind) ? end(r, "from") : end(r, "to"));
  const keyOf = (p: { code: string | null; name: string }) => p.code || p.name;

  const touching = rows.filter(
    (r) => (isPoint(r.from_kind) && isCity(r.to_kind, r.to_name)) || (isPoint(r.to_kind) && isCity(r.from_kind, r.from_name)),
  );
  // «مطار كوالالمبور الدولي (KUL)» is how a flight stores an airport
  const codes = flown.map((f) => f.match(/\(([A-Z]{3})\)\s*$/)?.[1] ?? (/^[A-Z]{3}$/.test(f.trim()) ? f.trim() : null)).filter(Boolean);
  const names = flown.map((f) => normalizeName(f.replace(/\s*\([A-Z0-9]{3,5}\)\s*$/, ""))).filter(Boolean);
  const points = [...new Map(touching.map((r) => [keyOf(pointOf(r)), pointOf(r)])).values()];
  const byFlight = points.filter(
    (p) => (p.code && codes.includes(p.code)) || (p.name !== "" && names.some((n) => p.name.includes(n) || n.includes(p.name))),
  );
  const pool = byFlight.length > 0 ? byFlight : points;

  const POINT = "@point";
  const asRoad = (list: PointTransfer[], pointKey: string | null): TransferPrice[] =>
    list.map((r) => {
      const label = (kind: PointKind, side: "from" | "to") => (isPoint(kind) && keyOf(end(r, side)) === pointKey ? POINT : c);
      return { from_city: label(r.from_kind, "from"), to_city: label(r.to_kind, "to"), car_type: r.car_type, price: r.price, currency: r.currency, created_at: r.created_at };
    });

  if (pool.length === 1) {
    const key = keyOf(pool[0]);
    const road = asRoad(touching.filter((r) => keyOf(pointOf(r)) === key), key).filter((r) => r.price > 0);
    const hit = leaving ? findTransferPrice(road, c, POINT, carType, pax, fleet) : findTransferPrice(road, POINT, c, carType, pax, fleet);
    if (hit) return hit;
  }
  const inCity = asRoad(rows.filter((r) => isCity(r.from_kind, r.from_name) && isCity(r.to_kind, r.to_name)), null).filter((r) => r.price > 0);
  return findTransferPrice(inCity, c, c, carType, pax, fleet);
}

/** The agency's price for a named service in this country. */
export function findServicePrice(list: ServicePrice[], label: string): ServicePrice | null {
  const wanted = normalizeName(label);
  if (!wanted) return null;
  // The import filed some services two and three times over, retired prices
  // and all, under one timestamp — the same story as the transfer list.
  const hits = list.filter((row) => normalizeName(row.service_type) === wanted || normalizeName(row.arabic_name) === wanted);
  return hits.length > 0 ? latest(hits) : null;
}

/** What this exact room last cost — by hotel id first, then by name. */
export function findRoomPrice(
  list: RoomPrice[],
  hotelId: string | null,
  hotelName: string,
  roomTypeName: string,
  boardType: string | null,
): RoomPrice | null {
  const room = normalizeName(roomTypeName);
  if (!room) return null;
  const name = normalizeName(hotelName);
  const sameHotel = list.filter((r) => (hotelId && r.hotel_id === hotelId) || (!hotelId && normalizeName(r.hotel_name) === name));
  if (sameHotel.length === 0) return null;
  const sameRoom = sameHotel.filter((r) => normalizeName(r.room_type_name) === room);
  if (sameRoom.length === 0) return null;
  // Prefer the same board; otherwise the room's price is still closer than
  // nothing, and the agent is looking right at it.
  return sameRoom.find((r) => (r.board_type ?? "") === (boardType ?? "")) ?? sameRoom[0];
}

/** Where a suggested figure came from, so the screen can say so. */
export type PriceSource = "supplier" | "typed" | "remembered" | "list" | "none";

export type SuggestedItem = DraftPricingItem & { source: PriceSource };

/**
 * One priced line per thing the programme contains.
 *
 * `labels` are the few words the description needs in the agent's language;
 * passing them in keeps this module free of the i18n layer.
 */
export function suggestPricing(
  data: DraftData,
  reference: PricingReference,
  labels: { hotel: string; airline: string },
): SuggestedItem[] {
  const currency = data.pricing.display_currency || "SAR";
  const stays = deriveHotelStays(
    deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities),
    data.hotels,
  );

  const items: SuggestedItem[] = [];

  for (const stay of stays) {
    const line = stay.line;
    const room = line.rooms[0];
    const remembered = findRoomPrice(
      reference.rooms,
      line.hotel_id,
      line.hotel_name,
      room?.room_type_name ?? line.room_type_name,
      room?.board_type ?? line.board_type,
    );

    const typed = stayTotal(line);
    const recalled = remembered
      ? remembered.price * Math.max(line.rooms.length, 1) * (remembered.per_night ? Math.max(stay.nights, 1) : 1)
      : null;

    // The order of trust, most binding first. A typed or remembered price is
    // what the room COSTS us — it was bought from a supplier — so it fills the
    // buy side too, exactly like a list price: «إجمالي الشراء» used to count
    // the transfers alone and call everything else profit.
    // ponytail: sell starts AT cost (0 profit); the agent adds the margin on the
    // pricing card. Apply markup_rules here if management wants it automatic.
    const [sell, buy, cur, source]: [number | null, number | null, string, PriceSource] = line.sourcing
      ? [line.sourcing.sell_base, line.sourcing.net_base, "SAR", "supplier"]
      : typed != null
        ? [typed, typed, line.manual_currency || currency, "typed"]
        : remembered
          ? [recalled, recalled, remembered.currency, "remembered"]
          : [null, null, currency, "none"];

    items.push({
      item_type: "hotel",
      description: `${stay.city_name} — ${line.hotel_name || labels.hotel}`,
      ref: pricingRefFor(stay),
      // ONE, because the figure is already the whole stay: the rooms are priced
      // individually on the card and added up there. Multiplying by the room
      // count here would charge a two-room stay twice.
      quantity: 1,
      buy_price: buy,
      buy_currency: cur,
      sell_price: sell,
      sell_currency: cur,
      source,
    });
  }

  // Flights are priced the way they are bought: ONE figure for the whole
  // booking (every traveller, every leg), typed on the flights card. A booking
  // without its figure yet still gets its line, unpriced, so it is not lost.
  const bookings: { ref: string; legs: typeof data.flights; price: number | null; currency: string; label: string }[] = [
    {
      ref: "flight:intl",
      legs: data.flights.filter((f) => f.leg_order !== "internal"),
      price: data.flight_booking.intl_price,
      currency: data.flight_booking.intl_currency || currency,
      label: "طيران دولي",
    },
    {
      ref: "flight:dom",
      legs: data.flights.filter((f) => f.leg_order === "internal"),
      price: data.flight_booking.dom_price,
      currency: data.flight_booking.dom_currency || currency,
      label: "طيران داخلي",
    },
  ];
  for (const b of bookings) {
    if (b.legs.length === 0) continue;
    const numbers = b.legs
      .map((f) => `${f.airline || labels.airline} ${f.flight_no}`.trim())
      .filter(Boolean)
      .join(" · ");
    items.push({
      item_type: "flight",
      description: numbers ? `${b.label} — ${numbers}` : b.label,
      ref: b.ref,
      // the figure is already the whole booking — and what we paid for it
      quantity: 1,
      buy_price: b.price,
      buy_currency: b.currency,
      sell_price: b.price,
      sell_currency: b.currency,
      source: b.price != null ? "typed" : "none",
    });
  }

  // The derived rows say «المطار» and «فندق ايبوه»; the list says
  // «مطار كوالالمبور الدولي» and «ايبوه». The labels are read back as keys.
  const pax = Math.max(data.trip.adults + data.trip.children, 1);
  // The way in is priced from where the flights land, the way out from where
  // they leave: arriving at SAW and leaving from IST are two different roads.
  const landed = data.flights.map((f) => f.to_airport);
  const departed = data.flights.map((f) => f.from_airport);
  const hotelCity = (place: string) =>
    place.startsWith(TRANSPORT_HOTEL_PREFIX) ? place.slice(TRANSPORT_HOTEL_PREFIX.length) : place;
  // 0 is how the old system left a price blank, not a price: quoted as one, it
  // is a free transfer that no «بلا سعر» count would ever flag.
  const transfers = reference.transfers.filter((row) => row.price > 0);

  for (const tr of data.transport) {
    // the domestic flight booking already prices a move made by air, and a
    // tour's own price includes its car (the owner, 2026-10-13)
    if (tr.car_type === TRANSPORT_MODE_AR.flight || tr.from_place === TRANSPORT_TOURS) continue;
    const arriving = tr.from_place === TRANSPORT_AIRPORT;
    const leaving = tr.to_place === TRANSPORT_AIRPORT;
    const hit =
      // One line for every tour of the trip, and the list cannot say which
      // tours the package holds. Never through transfers: a same-city row there
      // is a move from one hotel to another, not a tour day.
      tr.from_place === TRANSPORT_TOURS
        ? null
        : arriving || leaving
          ? // a row priced from the airport to the city (0072) first, then the text rows
            (resolveAirportCity(
              reference.points ?? [],
              hotelCity(arriving ? tr.to_place : tr.from_place),
              leaving,
              leaving ? departed : landed,
              tr.car_type,
              pax,
              reference.fleet,
            ) ??
            findAirportTransfer(
              transfers,
              hotelCity(arriving ? tr.to_place : tr.from_place),
              leaving,
              leaving ? departed : landed,
              tr.car_type,
              pax,
              reference.fleet,
            ))
          : findTransferPrice(transfers, tr.from_place, tr.to_place, tr.car_type, pax, reference.fleet);
    items.push({
      item_type: "transport",
      description: `${tr.from_place} ← ${tr.to_place}${tr.car_type ? ` (${tr.car_type})` : ""}`,
      // The vehicle is part of the ref: a leg re-planned from one car to two
      // vans is a different line, not the old one with a new price on it.
      ref: `transport:${tr.from_place}>${tr.to_place}>${tr.car_type ?? ""}`,
      // «فان × 2» is two vehicles at the one-vehicle price.
      quantity: vehicleCount(tr.car_type),
      // The list price is what the agency PAYS — the legacy system put its
      // margin in the exchange rate. Both sides carry it: the profit controls
      // appear (they need a buy), and an agent without the internal view still
      // sees a figure rather than a total that silently left the car out.
      buy_price: hit?.price ?? null,
      buy_currency: hit?.currency || currency,
      sell_price: hit?.price ?? null,
      sell_currency: hit?.currency || currency,
      source: hit ? "list" : "none",
    });
  }

  // «شريحة اتصال × 2» in «يشمل» is bought too: one line, its price asked
  for (const line of data.services.includes) {
    const sims = line.match(/^شريحة اتصال × (\d+)$/);
    if (!sims) continue;
    items.push({
      item_type: "service",
      description: "شريحة اتصال",
      ref: "sim",
      quantity: Number(sims[1]),
      buy_price: null,
      buy_currency: currency,
      sell_price: null,
      sell_currency: currency,
      source: "none",
    });
  }

  // The tours the basic screen picked, each at the price typed beside it.
  for (const city of data.cities) {
    (city.tour_picks ?? []).slice(0, city.tours ?? 0).forEach((pick, i) => {
      // a free day is never a line on the bill
      if (pick.free || pick.title.trim() === FREE_DAY_TITLE || (!pick.title.trim() && pick.price == null)) return;
      // a tour typed without a price takes the list's, when the list knows it
      // for the car the tour goes in — its own, else the trip's tours car
      const car = pick.car_type?.trim() || data.transport_plan.tours.car_type;
      const listed = pick.price == null ? findTourPrice(reference.tours, pick.title, car, pick.program_id) : null;
      items.push({
        item_type: "service",
        description: pick.title.trim() || `جولة سياحية في ${city.city_name}`,
        ref: `tour:${city.city_name}:${i}`,
        quantity: 1,
        buy_price: listed ? listed.price : pick.price,
        buy_currency: listed ? listed.currency : "SAR",
        sell_price: listed ? listed.price : pick.price,
        sell_currency: listed ? listed.currency : "SAR",
        source: listed ? "list" : pick.price != null ? "typed" : "none",
      });
    });
  }

  for (const v of data.visas) {
    const description = v.visa_type || v.country;
    if (!description.trim()) continue;
    items.push({
      item_type: "visa",
      description,
      quantity: v.count > 0 ? v.count : 1,
      buy_price: null,
      buy_currency: currency,
      sell_price: null,
      sell_currency: currency,
      source: "none",
    });
  }

  if (data.scope.services) {
    for (const label of data.services.includes) {
      if (!label.trim()) continue;
      const hit = findServicePrice(reference.services, label);
      // «يشمل» holds statements too — «الفنادق», «خدمة عملاء 24 ساعة» — and a
      // statement is not something we sell. Only a line the agency's service
      // list prices becomes a pricing line; the rest stay words on the paper.
      if (!hit) continue;
      items.push({
        item_type: "service",
        description: label,
        quantity: 1,
        buy_price: hit?.buy_price ?? null,
        buy_currency: hit?.buy_currency || currency,
        sell_price: hit?.sell_price ?? null,
        sell_currency: hit?.sell_currency || currency,
        source: "list",
      });
    }
  }

  return items;
}

/**
 * Add what is missing, keep what is there.
 *
 * Re-running after the programme changed must add the new city's hotel without
 * touching the fare someone negotiated an hour ago — so an existing line wins
 * on its ref, or on its description for the files written before refs existed.
 *
 * The one exception is a line with NO price at all: it is filled, because a
 * re-run after the price list was fixed must be able to price the lines an
 * earlier run left empty. Anything a human priced — either side — is left alone.
 * Only a suggestion with a SELL price fills: a buy alone leaves the client
 * figure empty, and would mark the line as priced so no later run could fix it.
 *
 * A line with a ref is filled from that ref alone: one hotel stayed in twice
 * is two lines with one description, and each stay has its own price.
 */
/**
 * The pricing sheet, brought in line with the draft and the agency's lists.
 *
 * Unlike `mergeSuggestions` (which only fills blanks), this is what the
 * pricing page runs every time it opens: the lines are DERIVED. A flight or a
 * hotel takes the price typed on its own card; a transfer, tour, service or
 * visa takes today's list price. Only three kinds of line are left alone:
 *   • one the agent changed by hand here (`overridden`) — its list price is
 *     still recorded, so it can be restored;
 *   • one the agent added by hand (`manual`);
 *   • anything the draft no longer produces is dropped (a removed hotel must
 *     not stay on the bill), unless it is one of the two above.
 */
export function syncSuggestions(
  existing: DraftPricingItem[],
  suggested: SuggestedItem[],
): DraftPricingItem[] {
  const key = (i: Pick<DraftPricingItem, "item_type" | "ref" | "description">) =>
    i.ref ? `ref:${i.ref}` : `${i.item_type}:${i.description.trim()}`;
  const byKey = new Map(existing.map((i) => [key(i), i]));
  const out: DraftPricingItem[] = [];
  const used = new Set<string>();
  for (const { source: _source, ...s } of suggested) {
    const k = key(s);
    used.add(k);
    const prior = byKey.get(k);
    if (prior?.overridden) {
      out.push({ ...prior, list_sell: s.sell_price });
    } else {
      out.push({ ...s, list_sell: s.sell_price });
    }
  }
  for (const item of existing) {
    if (used.has(key(item))) continue;
    if (item.overridden || item.manual) out.push(item);
  }
  return out;
}

export function mergeSuggestions(
  existing: DraftPricingItem[],
  suggested: SuggestedItem[],
): { items: DraftPricingItem[]; added: number; filled: number; priced: number } {
  const byRef = new Set(existing.map((i) => i.ref).filter(Boolean) as string[]);
  const byText = new Set(existing.map((i) => i.description.trim()));

  let filled = 0;
  const kept = existing.map((line) => {
    if (line.buy_price != null || line.sell_price != null) return line;
    const hit = suggested.find(
      (s) =>
        s.item_type === line.item_type &&
        (line.ref ? s.ref === line.ref : s.description.trim() === line.description.trim()) &&
        s.sell_price != null,
    );
    if (!hit) return line;
    filled++;
    return {
      ...line,
      buy_price: hit.buy_price,
      buy_currency: hit.buy_currency,
      sell_price: hit.sell_price,
      sell_currency: hit.sell_currency,
    };
  });

  const fresh = suggested.filter((s) => !(s.ref && byRef.has(s.ref)) && !byText.has(s.description.trim()));
  return {
    items: [...kept, ...fresh.map(({ source: _source, ...item }) => item)],
    added: fresh.length,
    filled,
    // every line this run gave a number — new or filled
    priced: fresh.filter((s) => s.sell_price != null).length + filled,
  };
}
