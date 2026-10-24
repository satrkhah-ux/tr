/**
 * «النظام بيسك» — the one-page entry, after the company's own system.
 *
 * The agent decides a few things once — the city, its nights, how many tour
 * days it gets — and everything that follows from them is filled in: the city's
 * dates, a hotel line with the trip's rooms and meals, and the day titles of the
 * programme. It writes the SAME draft the full generator does, so the preview,
 * the PDF and the pricing sheet work on it unchanged.
 *
 * Pure: no React, no Supabase.
 */

import {
  cityHotelLines,
  cityKeys,
  deriveCityDates,
  deriveHotelStays,
  emptyFlight,
  emptyRoomSpec,
  flightsLater,
  FLIGHTS_LATER_LINE,
  hopKey,
  hopMode,
  inCityTransferText,
  intercityModes,
  isTripService,
  MEAL_PLAN_BOARD,
  newCityKey,
  newStayId,
  resizeRooms,
  roomFromName,
  addStay,
  pickRoom,
  roomTypeNames,
  totalCityNights,
  transportRef,
  transportServices,
  withCityKeys,
  withRooms,
  type CityService,
  type ClientHotel,
  type DraftCity,
  type DraftData,
  type DraftDay,
  type DraftFlight,
  type DraftHotel,
  type DraftPricingItem,
  type DraftRoomSpec,
  type DraftServices,
  type LookupRoomType,
  type PackageProfit,
  type DraftTrip,
  type ArrivalEdge,
  type DepartureEdge,
  type HotelStay,
  type LookupAirport,
  type ServiceKind,
  type TourPick,
  type TransportLeg,
  keepNightlyRates as keepNightlyRatesByMark,
} from "./draft-types";
import { roomRank, seatsFromName } from "@/lib/catalog/model";
import { daysFromTours, departureDay, legInto } from "./itinerary";
// the tours' days moved to lib/offer/itinerary with the programme; their importers still find them here
export { cityDates, WELCOME, withTourCount, withTours } from "./itinerary";
import { AIRPORT_TRANSFER_LINE, meetsElsewhere } from "./advanced";
import { autoDepartureDate, finalOutbound, itineraryStartDate } from "./schedule";
import { withTypedTotal } from "./flight-fare";
import { normAr } from "@/lib/catalog/norm";

/**
 * A city as this screen holds it. The extra answer rides on the draft's own
 * city row (normalize passes city rows through untouched), so no column and no
 * migration: `tours` decides how many of the city's days are tour days.
 */
export type BasicCity = DraftCity;

/** The cities with their dates chained from where the itinerary starts. */
export function chainCities(data: Pick<DraftData, "trip" | "flights">, cities: BasicCity[]): BasicCity[] {
  return deriveCityDates(itineraryStartDate(data.trip, data.flights), cities);
}

/** Nights the trip still has to give a city — what the add bar offers first. */
export function remainingNights(data: Pick<DraftData, "trip" | "cities">): number {
  return Math.max(data.trip.nights - totalCityNights(data.cities), 0);
}

/**
 * The room a group usually takes, by how many sleep in each room: two people
 * in one room is «غرفة مزدوجة» (the owner's review, 2026-10-18: picked by hand
 * twice per file, and «ينقص» asked for it). The agent changes it when it differs.
 */
export function usualRoom(trip: Pick<DraftTrip, "adults" | "children" | "rooms">): ReturnType<typeof pickRoom> {
  const perRoom = Math.ceil(Math.max(trip.adults + trip.children, 1) / Math.max(trip.rooms, 1));
  const type = ["single", "double", "triple", "quadruple"][perRoom - 1] ?? "family";
  return pickRoom({ room_type_code: type });
}

/** A city's hotel line, born with the trip's rooms and meals so the agent only picks the hotel. */
export function hotelForCity(data: Pick<DraftData, "trip">, city: string, currency: string, cityKey?: string): DraftHotel {
  const board = data.trip.meal_plan ? MEAL_PLAN_BOARD[data.trip.meal_plan] : data.trip.default_board;
  // the trip's own room when it names one, else the usual one for the group
  const named = data.trip.default_room_type_name?.trim();
  const room = { ...emptyRoomSpec(), ...(named ? roomFromName(named) : usualRoom(data.trip)), board_type: board };
  return withRooms(
    {
      id: newStayId(),
      city_name: city,
      ...(cityKey ? { city_key: cityKey } : {}),
      // 0 = the whole city, however its nights change later (deriveHotelStays)
      nights: 0,
      hotel_id: null,
      hotel_name: "",
      hotel_name_en: "",
      rooms: [],
      room_type_id: null,
      room_type_name: "",
      board_type: null,
      rooms_count: 1,
      manual_price: null,
      manual_currency: currency,
    },
    Array.from({ length: Math.max(data.trip.rooms, 1) }, () => ({ ...room })),
  );
}

/** What the add bar may already know about the city's stay: the hotel, the room, how many. */
export type StayPick = {
  hotel?: { id: string; name: string } | null;
  room?: string;
  rooms?: number;
  /** what each room costs for the city's nights — typed on the bar with the rest. */
  price?: number | null;
};

function withStayPick(line: DraftHotel, pick: StayPick): DraftHotel {
  let next = pick.rooms && pick.rooms !== line.rooms.length ? resizeRooms(line, pick.rooms) : line;
  if (pick.hotel) next = { ...next, hotel_id: pick.hotel.id, hotel_name: pick.hotel.name, hotel_name_en: "" };
  if (pick.room?.trim()) next = renameRooms(next, pick.room.trim());
  if (pick.price != null) next = withRooms(next, next.rooms.map((r) => ({ ...r, price: pick.price ?? null })));
  return next;
}

/**
 * Add a city at the end, with its hotel line — and the hotel itself when the bar
 * already picked it. `country` only when it is not the trip's — a neighbour.
 */
export function addCity(
  data: DraftData,
  city: { name: string; nights: number; tours: number; country?: string } & StayPick,
  currency: string,
): Pick<DraftData, "cities" | "hotels"> & { joined?: "nights" | "stay" } {
  // The same city again, right after itself, is more nights there — not a second
  // row the group «moves» into from itself (with a transfer priced for the move).
  const at = data.cities.length - 1;
  const last = data.cities[at] as BasicCity | undefined;
  if (last && last.city_name === city.name) {
    const longer = setCityNights(data, at, last.nights + city.nights);
    // the nights added are free days: the city keeps its tours, or the bar's count when that is more — a stay
    // entered hotel by hotel was a tour more each time (the evaluator, 2026-10-24: «يوم حر» unless the agent adds one)
    const cities = longer.cities.map((c, i) =>
      i === at ? { ...c, tours: Math.max((c as BasicCity).tours ?? 0, city.tours) } : c,
    );
    // nothing picked on the bar: simply more nights where the group already is
    if (!city.hotel && !city.room?.trim() && city.price == null) return { cities, hotels: longer.hotels, joined: "nights" };
    // a hotel, a room or a price picked for these nights is never dropped (the owner, 2026-10-22: Istanbul 4 then
    // Istanbul 3 merged into one stay of 7 and the second hotel was lost): the new nights are a second stay
    // «بعده» with what was picked — the first stay keeps its own nights (the blank «rest» shares what is left)
    // the hotels as they were: the first stay still covers only its own nights, so its price is not stretched to the
    // city's new length (setCityNights scales a lone stay to it)
    const added = addStay(cities, data.hotels, at, "after");
    return {
      cities,
      hotels: added.hotels.map((h) => (h.id === added.id ? withStayPick({ ...h, nights: city.nights }, city) : h)),
      joined: "stay",
    };
  }
  // a stop of its own, with a hotel line of its own: كوالالمبور again at the end is not the first visit's hotel
  const keyed = withCityKeys(data.cities);
  const next: BasicCity = {
    key: newCityKey(keyed, city.name),
    city_name: city.name,
    nights: city.nights,
    tours: Math.min(city.tours, city.nights),
    check_in: null,
    check_out: null,
    ...(city.country && city.country !== data.trip.country ? { country: city.country } : {}),
  };
  return {
    cities: chainCities(data, [...keyed, next]),
    hotels: [...data.hotels, withStayPick(hotelForCity(data, city.name, currency, next.key), city)],
  };
}

/** Remove a city; its hotel lines go with it unless the same city is visited again. */
export function removeCity(data: DraftData, index: number): Pick<DraftData, "cities" | "hotels"> {
  const keyed = withCityKeys(data.cities);
  const cities = keyed.filter((_, i) => i !== index);
  // its own lines go; one another visit of the same city also reads (an older file's, by name) stays with it
  const shared = new Set(cities.flatMap((_, i) => cityHotelLines(cities, data.hotels, i)));
  const gone = new Set(cityHotelLines(keyed, data.hotels, index).filter((h) => h.city_key === keyed[index]?.key || !shared.has(h)));
  return {
    cities: chainCities(data, cities),
    hotels: data.hotels.filter((h) => !gone.has(h)),
  };
}

/**
 * True when the cities put one city twice in a row somewhere they did not
 * before — a «move» from a city to itself, priced as a transfer or a flight.
 * addCity makes that more nights instead; a reorder or «تعديل المدينة» that
 * would do it is refused (an older file that already has it is left alone).
 */
export function repeatsNeighbour(before: DraftCity[], after: DraftCity[]): boolean {
  const pairs = (list: DraftCity[]) => list.filter((c, i) => i > 0 && c.city_name === list[i - 1].city_name).length;
  return pairs(after) > pairs(before);
}

/** Whole days from `a` to `b`. */
const daysFrom = (a: string, b: string) => Math.round((isoDay(b) - isoDay(a)) / DAY_MS);

/**
 * The programme's days follow their stop when the stops move: a day the agent
 * wrote for Langkawi stays a Langkawi day — the same day of its stay — instead
 * of staying on its date under whichever city now sleeps there. A day the
 * screen writes needs nothing (it is written again); a slot whose stop brings
 * no day of its own is handed back to the screen.
 */
function carryDays(before: DraftCity[], after: DraftCity[], days: DraftDay[]): DraftDay[] {
  const stopOn = (cities: DraftCity[], date: string) => cities.findIndex((c) => c.check_in && c.check_out && date >= c.check_in && date < c.check_out);
  const slot = (c: DraftCity, date: string) => `${c.key}@${daysFrom(c.check_in!, date)}`;
  const was = new Map<string, DraftDay>();
  for (const d of days) {
    const k = d.date && d.kind !== "travel" ? stopOn(before, d.date) : -1;
    if (k >= 0) was.set(slot(before[k], d.date!), d);
  }
  return days.map((d) => {
    const k = d.date && d.kind !== "travel" ? stopOn(after, d.date) : -1;
    if (k < 0) return d;
    const from = was.get(slot(after[k], d.date!));
    if (from === d) return d;
    if (!from) return { ...d, title: "", activities: [], ai_generated: false, auto_title: "" };
    return { ...from, day_number: d.day_number, date: d.date, city_name: after[k].city_name, weather: from.date === d.date ? from.weather : null };
  });
}

/**
 * A city moved to another place in the trip (dragged, or its arrows): its hotel
 * lines go with it (they point at its key), every date chains again and the
 * days the agent wrote go with their stop. A night in the air belonged to the
 * move from the city before; a city that now follows another one takes that
 * night back — through setCityNights, so its hotel's typed total grows with
 * it — and lands the same day: the agent says again how the new move goes.
 * Nothing changes for a move nowhere, or one that puts a city twice in a row.
 */
export function moveCity(data: DraftData, from: number, to: number): Pick<DraftData, "cities" | "hotels" | "days"> {
  const keyed = withCityKeys(data.cities);
  const same = { cities: data.cities, hotels: data.hotels, days: data.days };
  if (from === to || !keyed[from] || to < 0 || to >= keyed.length) return same;
  const list = [...keyed];
  const [city] = list.splice(from, 1);
  // put somewhere by hand: the flights no longer place it (withCitiesFromFlights)
  list.splice(to, 0, { ...city, from_flight: undefined });
  if (repeatsNeighbour(keyed, list)) return same;
  const prevOf = new Map(keyed.map((c, i) => [c.key, keyed[i - 1]?.key]));
  const nextOf = new Map(keyed.map((c, i) => [c.key, keyed[i + 1]?.key]));
  const backs = list.flatMap((c, i) => (c.arrives_next_day && prevOf.get(c.key) !== list[i - 1]?.key ? [i] : []));
  // what the agent set on a way in or out (its car, its price) was for the old neighbour's road
  const roads = list.map((c, i) => {
    const gone = (s: CityService) => (s.id === "in" && prevOf.get(c.key) !== list[i - 1]?.key) || (s.id === "out" && nextOf.get(c.key) !== list[i + 1]?.key);
    return c.services?.some(gone) ? { ...c, services: c.services.filter((s) => !gone(s)) } : c;
  });
  let out: DraftData = { ...data, cities: chainCities(data, roads.map((c, i) => (backs.includes(i) ? { ...c, arrives_next_day: undefined } : c))) };
  for (const i of backs) out = { ...out, ...setCityNights(out, i, out.cities[i].nights + 1) };
  const dated = chainCities(data, keyed);
  return { cities: out.cities, hotels: out.hotels, days: carryDays(dated, out.cities, data.days) };
}

/**
 * The city of a stop changed in place («تعديل المدينة»): its nights and its tour
 * days stay, what belonged to the old city goes — the tours' services (another
 * city's programmes), the hotel and its price, the days the agent wrote about
 * it; the rooms and meals stay asked. A hotel line another visit of the old
 * city still reads (an older file's, matched by name) stays with that visit.
 */
export function replaceCity(data: DraftData, index: number, next: { name: string; country?: string }): Pick<DraftData, "cities" | "hotels" | "days"> {
  const keyed = withCityKeys(data.cities);
  const old = keyed[index];
  const name = next.name.trim();
  const own = (c?: string) => (c && c !== data.trip.country ? c : undefined);
  const country = own(next.country);
  const same = { cities: data.cities, hotels: data.hotels, days: data.days };
  if (!old || !name || (name === old.city_name && country === own(old.country))) return same;
  const cities = keyed.map((c, i) => {
    if (i !== index) return c;
    return {
      ...c,
      // its transfers and their prices were the old city's: the trip writes the new one's
      services: undefined,
      city_name: name,
      country,
      from_flight: undefined,
      tour_picks: c.tour_picks?.map((p) => (p.free ? p : { ...p, program_id: null, title: "", text: "", price: null })),
    };
  });
  if (repeatsNeighbour(keyed, cities)) return same;
  // removeCity's rule: its own lines, and a by-name line no other stop reads
  const others = new Set(keyed.flatMap((_, i) => (i === index ? [] : cityHotelLines(keyed, data.hotels, i))));
  const mine = new Set(cityHotelLines(keyed, data.hotels, index).filter((h) => h.city_key === old.key || !others.has(h)));
  const hotels = data.hotels.map((h) =>
    mine.has(h)
      ? withRooms(
          { ...h, city_name: name, city_key: old.key, hotel_id: null, hotel_name: "", hotel_name_en: "", sourcing: null, manual_price: null },
          h.rooms.map((r) => ({ ...r, room_type_id: null, price: null })),
        )
      : h,
  );
  const dated = chainCities(data, cities);
  const stop = dated[index];
  // the days written about the old city go back to the screen, which writes them for the new one
  const days = data.days.map((d) =>
    d.date && stop.check_in && stop.check_out && d.date >= stop.check_in && d.date < stop.check_out
      ? { ...d, title: "", activities: [], ai_generated: false, auto_title: "" }
      : d,
  );
  return { cities: dated, hotels, days };
}

/**
 * Every city holds a hotel line while the sale includes hotels — a city the flights created has none yet. A city
 * whose hotel the client booked himself holds none.
 */
export function withHotelLines(data: DraftData, currency: string): DraftHotel[] {
  if (!data.scope.hotels) return data.hotels;
  const keys = cityKeys(data.cities);
  const missing = data.cities.flatMap((c, i) =>
    c.city_name.trim() && !c.client_hotel && cityHotelLines(data.cities, data.hotels, i).length === 0 ? [hotelForCity(data, c.city_name, currency, keys[i])] : [],
  );
  return missing.length === 0 ? data.hotels : [...data.hotels, ...missing];
}

/** A stop's own hotel of the client's changed — the name, its dates, the address… (the owner, 2026-10-25, Order 7). */
export function setClientHotel(cities: DraftCity[], index: number, slice: Partial<ClientHotel>): DraftCity[] {
  return cities.map((c, i) => (i === index ? { ...c, client_hotel: { name: "", ...c.client_hotel, ...slice } } : c));
}

/**
 * «الفندق محجوز من العميل» on a stop of a sale with hotels (a mixed trip): on, its hotel lines go — with their
 * lines on the pricing sheet, so nothing of them is priced, booked or vouchered — and the client's hotel starts
 * from the one that was typed there; off, the stop is ours again (withHotelLines gives it a fresh line).
 */
export function setClientBooked(data: DraftData, index: number, on: boolean): Pick<DraftData, "cities" | "hotels" | "pricing"> {
  const city = data.cities[index];
  const same = { cities: data.cities, hotels: data.hotels, pricing: data.pricing };
  if (!city || on === Boolean(city.client_hotel)) return same;
  if (!on) return { ...same, cities: data.cities.map((c, i) => (i === index ? { ...c, client_hotel: undefined } : c)) };
  // removeCity's rule: its own lines, and a by-name line no other stop reads
  const keyed = withCityKeys(data.cities);
  const others = new Set(keyed.flatMap((_, i) => (i === index ? [] : cityHotelLines(keyed, data.hotels, i))));
  const gone = cityHotelLines(keyed, data.hotels, index).filter((h) => h.city_key === keyed[index].key || !others.has(h));
  const ids = new Set(gone.map((h) => h.id));
  const typed = gone.find((h) => h.hotel_name.trim());
  return {
    cities: setClientHotel(data.cities, index, typed ? { name: typed.hotel_name.trim(), hotel_id: typed.hotel_id } : {}),
    hotels: data.hotels.filter((h) => !ids.has(h.id)),
    pricing: { ...data.pricing, items: data.pricing.items.filter((it) => it.item_type !== "hotel" || !ids.has(it.ref ?? "")) },
  };
}

/**
 * The agent typed what a stay costs for ITS nights. When a stay's nights move —
 * the city got longer, a room change split it — the total moves with them at
 * the same nightly rate: a 3-night total offered for a 4-night stay is the
 * mistake this screen must not make.
 */
function keepNightlyRates(prev: HotelStay[], hotels: DraftHotel[], cities: DraftCity[]): DraftHotel[] {
  // ONE rule with the editor's (draft-types keepNightlyRates, run again on every commit): a line not
  // yet marked is marked at its nights BEFORE the change, then rescaled by the mark — so the
  // commit after it finds the mark moved and changes nothing (11 → 10 → 11 doubled 1.1 before)
  const was = new Map(prev.map((s) => [s.line.id, s.nights]));
  const marked = hotels.map((h) => (h.priced_nights || !was.get(h.id) ? h : { ...h, priced_nights: was.get(h.id) }));
  return keepNightlyRatesByMark(cities, marked);
}

/** How many hotel nights an edge takes from (−1) or adds to (+1) the city it sits on. */
const edgeDelta = (mode: ArrivalEdge | DepartureEdge | null | undefined) => (mode === "no_hotel" || mode === "no_hotel_day" ? -1 : mode === "prev_night" ? 1 : 0);

/**
 * «بكج متقدم»: the arrival's or the departure's edge chosen (null: as Basic has
 * it). The first or last city's hotel nights follow — a night without a hotel
 * leaves it, a night before the landing joins it — at the same nightly rate,
 * and the dates re-chain; the trip's nights stay what the tickets say
 * (edgeNights keeps the count whole). Choosing again, or null, undoes it.
 */
export function setEdge(data: DraftData, side: "in" | "out", mode: ArrivalEdge | DepartureEdge | null): Pick<DraftData, "cities" | "hotels"> {
  const at = side === "in" ? 0 : data.cities.length - 1;
  const city = data.cities[at];
  if (!city) return { cities: data.cities, hotels: data.hotels };
  const field = side === "in" ? "edge_in" : "edge_out";
  const was = city[field];
  if ((was ?? null) === mode) return { cities: data.cities, hotels: data.hotels };
  const cities = data.cities.map((c, i) => (i === at ? { ...c, [field]: mode ?? undefined } : c));
  const nights = Math.max(city.nights + edgeDelta(mode) - edgeDelta(was), 1);
  return setCityNights({ ...data, cities }, at, nights);
}

/** A city's nights changed: its stays keep their nightly rate, and a room change keeps a night after it. */
export function setCityNights(data: DraftData, index: number, nights: number): Pick<DraftData, "cities" | "hotels"> {
  const before = data.cities[index];
  if (!before || nights < 1) return { cities: data.cities, hotels: data.hotels };
  const prev = deriveHotelStays(data.cities, data.hotels);
  const cities = chainCities(
    data,
    // nights set by hand are the agent's: «التالي» from the flights leaves this stop alone
    withCityKeys(data.cities).map((c, i) => (i === index ? { ...c, nights, from_flight: undefined } : c)),
  );
  // the stays that run one after another give way; a same-dates stay follows its own (deriveHotelStays)
  const mine = new Set(cityHotelLines(cities, data.hotels, index).filter((h) => (h.dates ?? "after") === "after"));
  let hotels = data.hotels.map((h) => (mine.has(h) && h.nights > 0 ? { ...h, nights: Math.min(h.nights, Math.max(nights - 1, 0)) } : h));
  if (nights < 2) hotels = withoutRoomChange(cities, hotels, index);
  return { cities, hotels: keepNightlyRates(prev, hotels, cities) };
}

// ---------- «معلومات إضافية»: extra bed, room change ----------

/**
 * ponytail: the extra bed rides in the room's NAME, so the document, the client
 * link, the pricing line and the rate memory all print and key on it without a
 * new field. Give DraftRoomSpec an `extra_beds` count if it ever has to be
 * priced or reported on its own.
 */
export const EXTRA_BED = " + سرير إضافي";
export const baseRoomName = (name: string) => (name.endsWith(EXTRA_BED) ? name.slice(0, -EXTRA_BED.length) : name);
export const extraBeds = (line: Pick<DraftHotel, "rooms">) => line.rooms.filter((r) => r.room_type_name.endsWith(EXTRA_BED)).length;

/** The first `count` rooms get the extra bed. */
export function withExtraBeds(line: DraftHotel, count: number): DraftHotel {
  return withRooms(
    line,
    line.rooms.map((r, i) => ({ ...r, room_type_name: baseRoomName(r.room_type_name) + (i < count ? EXTRA_BED : "") })),
  );
}

/** A new room type for every room of the line (its catalogue codes with it); a room's extra bed stays with it. */
export function renameRooms(line: DraftHotel, name: string): DraftHotel {
  return withRooms(
    line,
    // another room: the hotel's own name for the old one does not follow
    line.rooms.map((r) => ({ ...r, ...roomFromName(name), room_type_name: name + (r.room_type_name.endsWith(EXTRA_BED) ? EXTRA_BED : ""), hotel_room_name: undefined })),
  );
}

/** Every line named after the city, on every visit to it. One stop's own lines: cityHotelLines. */
export const cityLines = (hotels: DraftHotel[], cityName: string) => hotels.filter((h) => h.city_name === cityName);

/**
 * The stay a room change moved to: the line right after the stop's first, in
 * the same hotel, running after it. Another hotel the agent added is not one.
 */
export function roomChangeLine(lines: DraftHotel[]): DraftHotel | undefined {
  const [main, next] = lines;
  if (!main || !next || (next.dates ?? "after") !== "after") return undefined;
  // two rows with no hotel yet are two stays still to fill — only a marked room change follows the first (the
  // evaluator, 2026-10-22: picking the first row's hotel was copied onto the second)
  if (!main.hotel_name.trim() && !next.hotel_name.trim()) return next.room_change ? next : undefined;
  return next.hotel_id === main.hotel_id && next.hotel_name === main.hotel_name ? next : undefined;
}

function withoutRoomChange(cities: DraftCity[], hotels: DraftHotel[], index: number): DraftHotel[] {
  const lines = cityHotelLines(cities, hotels, index);
  const change = roomChangeLine(lines);
  if (!change) return hotels;
  return hotels.filter((h) => h.id !== change.id).map((h) => (h.id === lines[0].id ? { ...h, nights: 0 } : h));
}

/**
 * Same hotel, another room after `after` nights: the city's stay splits in two
 * — the first keeps `after` nights, the second takes the rest. Each half carries
 * its own total, so the first is cut to its nights at the same rate.
 */
export function changeRoom(data: DraftData, index: number, after: number, roomName: string): Pick<DraftData, "hotels"> {
  const city = data.cities[index];
  const lines = cityHotelLines(data.cities, data.hotels, index);
  const [main] = lines;
  const second = roomChangeLine(lines);
  if (!city || !main || city.nights < 2) return { hotels: data.hotels };
  const nights = Math.min(Math.max(Math.trunc(after), 1), city.nights - 1);
  const prev = deriveHotelStays(data.cities, data.hotels);
  const next = renameRooms(
    second
      ? { ...second, nights: 0, room_change: true }
      : withRooms({ ...main, id: newStayId(), nights: 0, sourcing: null, dates: undefined, check_in: undefined, room_change: true }, main.rooms.map((r) => ({ ...r, price: null }))),
    roomName,
  );
  let hotels = data.hotels.map((h) => (h.id === main.id ? { ...main, nights } : h.id === next.id ? next : h));
  if (!second) {
    const at = hotels.findIndex((h) => h.id === main.id);
    hotels = [...hotels.slice(0, at + 1), next, ...hotels.slice(at + 1)];
  }
  return { hotels: keepNightlyRates(prev, hotels, data.cities) };
}

/** Undo the room change: one stay for the whole city again, at the first stay's nightly rate. */
export function clearRoomChange(data: DraftData, index: number): Pick<DraftData, "hotels"> {
  const prev = deriveHotelStays(data.cities, data.hotels);
  return { hotels: keepNightlyRates(prev, withoutRoomChange(data.cities, data.hotels, index), data.cities) };
}

// ---------- the trip's dates ----------

const DAY_MS = 86_400_000;
const isoDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDaysIso = (iso: string, days: number) => new Date(isoDay(iso) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The arrival, the departure and the nights are one fact told three ways: a new
 * departure date sets the nights; a new arrival or new nights move the departure.
 */
export function withTripDates(trip: DraftTrip, slice: Partial<DraftTrip>): DraftTrip {
  const next = { ...trip, ...slice };
  if (slice.departure_date !== undefined && next.arrival_date && next.departure_date) {
    next.nights = Math.max(Math.round((isoDay(next.departure_date) - isoDay(next.arrival_date)) / DAY_MS), 0);
  } else if (next.arrival_date && next.nights > 0) {
    next.departure_date = addDaysIso(next.arrival_date, next.nights);
  }
  return { ...next, days: next.nights > 0 ? next.nights + 1 : next.days };
}

/**
 * The programme is daysFromTours (lib/offer/itinerary) — one rule for this
 * screen and the generator. This screen also owns the days of its files from
 * before `auto_title`, read by their titles.
 */
export const basicDays = (data: DraftData): DraftDay[] => daysFromTours(data, true);

/** A stay's new total over its rooms: in the shares they had, or evenly when some had none. */
function splitTotal(rooms: DraftRoomSpec[], total: number | null): DraftRoomSpec[] {
  if (total == null) return rooms.map((r) => ({ ...r, price: null }));
  const before = rooms.reduce((sum, r) => sum + (r.price ?? 0), 0);
  const shares = before > 0 && rooms.every((r) => r.price != null);
  let left = total;
  return rooms.map((r, k) => {
    // the last room takes what is left, so the rooms always add up to the total
    const price = k === rooms.length - 1 ? left : Math.round((shares ? ((r.price ?? 0) * total) / before : total / rooms.length) * 100) / 100;
    left = Math.round((left - price) * 100) / 100;
    return { ...r, price };
  });
}

/**
 * What a price typed on the sheet writes onto its line. A typed figure is what
 * we pay (the «typed = cost» rule), so it is the line's cost as well as its sell
 * — the package profit then goes on it at issue exactly as the sheet shows it.
 * A line with no place to write back to stays the agent's own (`overridden`).
 */
export function typedSheetPrice(
  slice: { sell_price?: number | null; sell_currency?: string },
  atSource: boolean,
): Partial<DraftPricingItem> {
  return {
    ...slice,
    ...("sell_price" in slice ? { buy_price: slice.sell_price ?? null } : {}),
    ...(slice.sell_currency ? { buy_currency: slice.sell_currency } : {}),
    overridden: !atSource,
  };
}

/**
 * A price changed on the pricing sheet is changed where it was typed — the
 * stay's rooms, the tour, the transfer's row, the flight booking — so the two
 * never disagree. Null when the line has no such place (a visa, a line added by
 * hand, a supplier rate): the sheet keeps it as the agent's own.
 */
export function priceAtSource(
  data: DraftData,
  item: Pick<DraftPricingItem, "item_type" | "ref">,
  change: { price?: number | null; currency?: string },
): Partial<Pick<DraftData, "hotels" | "cities" | "flight_booking" | "flights">> | null {
  const ref = item.ref ?? "";
  if (item.item_type === "flight" && (ref === "flight:intl" || ref === "flight:dom")) {
    // a total typed on the sheet is a total: a «للفرد» booking becomes «إجمالي» at that figure
    const b = data.flight_booking;
    if (ref === "flight:intl") {
      const priced = change.price !== undefined ? withTypedTotal(b, "intl", change.price) : b;
      return { flight_booking: { ...priced, intl_currency: change.currency ?? b.intl_currency } };
    }
    const priced = change.price !== undefined ? withTypedTotal(b, "dom", change.price) : b;
    // the legs' own prices no longer add up to it: the total typed here is the booking's now
    const flights = change.price !== undefined ? data.flights.map((f) => (f.leg_order === "internal" && f.price != null ? { ...f, price: undefined } : f)) : data.flights;
    return { flight_booking: { ...priced, dom_currency: change.currency ?? b.dom_currency }, ...(flights !== data.flights ? { flights } : {}) };
  }
  // a transfer is typed on its row of the city card, per car in riyals like a tour — only its figure goes back.
  // ponytail: a list line in another currency (MYR) typed over here is riyals on the next sync, as a tour's is;
  // give CityService a currency if the lists' ringgit prices get typed over often.
  if (item.item_type === "transport" && change.price !== undefined) {
    const hit = transportServices(data.transport_plan, data.cities, deriveHotelStays(data.cities, data.hotels)).find((s) => transportRef(s.row) === ref);
    if (!hit || !data.cities[hit.city]) return null;
    return { cities: setService(data.cities, hit.city, hit.id, { price: change.price }) };
  }
  const tour = ref.match(/^tour:(.+):(\d+)$/);
  // a tour is typed in riyals — only its figure goes back
  if (tour && change.price !== undefined) {
    const at = Number(tour[2]);
    const c = data.cities.findIndex((x) => x.city_name === tour[1] && (x.tour_picks?.length ?? 0) > at);
    if (c < 0) return null;
    const price = change.price;
    return {
      cities: data.cities.map((x, i) => (i === c ? { ...x, tour_picks: (x.tour_picks ?? []).map((p, j) => (j === at ? { ...p, price } : p)) } : x)),
    };
  }
  if (item.item_type === "hotel") {
    const line = data.hotels.find((h) => h.id === ref);
    if (!line || line.sourcing) return null;
    const cur = change.currency ? { ...line, manual_currency: change.currency } : line;
    const next = change.price !== undefined ? withRooms(cur, splitTotal(cur.rooms, change.price)) : cur;
    return { hotels: data.hotels.map((h) => (h.id === line.id ? next : h)) };
  }
  return null;
}

/** Where a pricing line sits on the sheet: tours are services the city card wrote (ref «tour:…»). */
export type PriceGroup = "flights" | "hotels" | "transport" | "tours" | "services" | "visas" | "other";
export function priceGroupOf(item: Pick<DraftPricingItem, "item_type" | "ref">): PriceGroup {
  if (item.item_type === "hotel") return "hotels";
  if (item.item_type === "flight") return "flights";
  if (item.item_type === "transport") return "transport";
  if (item.item_type === "visa") return "visas";
  if (item.item_type === "service") return item.ref?.startsWith("tour:") ? "tours" : "services";
  return "other";
}

// ---------- a city visit's services: reception, farewell, transfers ----------

/** One non-tour row of a visit's services table, as the city card shows it. */
export type ServiceRow = {
  /** "in" / "out" — the trip's own way in and out; any other — a row the agent added. */
  id: string;
  kind: Exclude<ServiceKind, "tour">;
  auto: boolean;
  date: string | null;
  /** what the row says: the agent's words, else the trip's (`auto_text`). */
  text: string;
  auto_text: string;
  car_type: string;
  cars: number;
  /** one car's price as typed; null — the list's (on the pricing sheet). */
  price: number | null;
  /** its line on the pricing sheet. */
  ref: string;
  /** the plan's car it rides in unless it has its own. */
  leg: Pick<TransportLeg, "car_type" | "cars">;
  /** the flight's clock it meets: the landing for a reception, the take-off for a farewell — "" until the ticket says it. */
  clock: string;
};

/** «مطار كوالالمبور الدولي» — a leg's airport without its code; «مطار X» for a city alone. */
function airportWords(airport: string | undefined, city: string): string {
  const name = (airport ?? "").replace(/\s*\([A-Za-z0-9]{3,4}\)\s*$/, "").trim();
  return name ? (name.startsWith("مطار") ? name : `مطار ${name}`) : `مطار ${city}`;
}

/**
 * The flight that brings the group to stop `index` and the one that takes it
 * away: the first city is met off the flight that lands for it (else the
 * international one), the last seen off to the flight home; between cities,
 * the domestic leg into the city and the one into the next.
 */
function visitLegs(data: Pick<DraftData, "cities" | "flights">, index: number): { lands?: DraftFlight; leaves?: DraftFlight } {
  const { cities, flights } = data;
  const city = cities[index];
  if (!city) return {};
  const name = city.city_name.trim();
  const byDeparture = [...flights].sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""));
  // a ticket names the airport's city, which may not be the stop's (KUL for Selangor)
  const into = (to: DraftCity, from: string) => legInto(flights, to.city_name.trim(), to.check_in, from) ?? legInto(flights, to.city_name.trim(), to.check_in);
  const prev = cities[index - 1];
  const next = cities[index + 1];
  const lands = prev
    ? into(city, prev.city_name.trim())
    : (byDeparture.filter((f) => f.leg_order !== "inbound" && f.to_city?.trim() === name).at(-1) ?? finalOutbound(flights));
  const leaves = next
    ? into(next, name)
    : (byDeparture.find((f) => f.leg_order !== "outbound" && f.from_city?.trim() === name) ?? byDeparture.find((f) => f.leg_order === "inbound"));
  return { lands, leaves };
}

/**
 * What a row says until the agent writes their own: met at the airport the
 * group lands at and taken to the hotel — «… في سيلانجور» when that airport is
 * another city's (KUL for Selangor) — seen off from the hotel to the airport it
 * leaves from, or driven from the city before («براً» in the car, by train, by sea).
 */
export function serviceText(data: Pick<DraftData, "cities" | "flights" | "hotels" | "transport_plan">, index: number, kind: ServiceRow["kind"], id: string): string {
  const city = data.cities[index];
  if (!city) return "";
  const name = city.city_name.trim();
  const { lands, leaves } = visitLegs(data, index);
  if (kind === "reception") {
    const hotel = cityHotelLines(data.cities, data.hotels, index)[0]?.hotel_name.trim();
    const away = Boolean(lands?.to_city?.trim()) && lands!.to_city!.trim() !== name;
    const to = away ? `${hotel ? `فندق ${hotel}` : "الفندق"} في ${name}` : "الفندق";
    return `الاستقبال من ${airportWords(lands?.to_airport, lands?.to_city?.trim() || name)} والتوصيل إلى ${to}`;
  }
  if (kind === "farewell") return `التوصيل من فندق ${name} إلى ${airportWords(leaves?.from_airport, leaves?.from_city?.trim() || name)}`;
  const prev = data.cities[index - 1];
  if (id !== "in" || !prev) return inCityTransferText(name);
  const mode = hopMode(data.transport_plan, prev.city_name, name);
  if (mode === "car") return `التوصيل من فندق ${prev.city_name.trim()} إلى فندق ${name}`;
  return `الانتقال ${mode === "train" ? "بالقطار" : mode === "ship" ? "بالعبّارة" : "بالطيران"} من ${prev.city_name.trim()} إلى ${name}`;
}

/**
 * The services of stop `index` other than its tours, in the trip's order: the
 * way in (one reception at the airport, or one transfer from the city before),
 * the way out to the airport, then the rows the agent added. They are the
 * transport rows the pricing sheet prices (transportServices) — one each, never
 * twice. Dates: the trip's; the farewell to the flight home on the day home.
 */
export function cityServices(data: DraftData, index: number): ServiceRow[] {
  const city = data.cities[index];
  if (!city || !data.scope.transport) return [];
  const { lands, leaves } = visitLegs(data, index);
  const at = (iso: string | null | undefined) => {
    const t = (iso ?? "").slice(11, 16);
    return t && t !== "00:00" ? t : "";
  };
  return transportServices(data.transport_plan, data.cities, deriveHotelStays(data.cities, data.hotels))
    .filter((s) => s.city === index)
    .map((s) => {
      // a move to another hotel says which two (hotelMoves)
      const auto_text = s.words ?? serviceText(data, index, s.kind, s.id);
      return {
        id: s.id,
        kind: s.kind,
        auto: isTripService(s.id),
        date: s.row.date ?? (s.id === "out" ? departureDay(city) : null),
        text: s.own?.text ?? auto_text,
        auto_text,
        car_type: s.own?.car_type?.trim() || s.leg.car_type.trim(),
        cars: s.own?.cars ?? s.leg.cars,
        price: s.own?.price ?? null,
        ref: transportRef(s.row),
        leg: s.leg,
        clock: s.kind === "reception" ? at(lands?.arrival_at) : s.kind === "farewell" ? at(leaves?.departure_at) : "",
      };
    });
}

/** A service id for a row the agent adds. */
export const newServiceId = () => `svc-${Math.random().toString(36).slice(2, 10)}`;

/** One service of stop `index` changed — on "in" / "out", only what the agent changed is kept. */
export function setService(cities: DraftCity[], index: number, id: string, slice: Partial<Omit<CityService, "id">>): DraftCity[] {
  return cities.map((c, i) => {
    if (i !== index) return c;
    const list = c.services ?? [];
    return {
      ...c,
      services: list.some((s) => s.id === id) ? list.map((s) => (s.id === id ? { ...s, ...slice } : s)) : [...list, { id, ...slice }],
    };
  });
}

/** «+ إضافة خدمة»: a row of `kind` on `date` of stop `index`. */
export function addService(cities: DraftCity[], index: number, kind: ServiceRow["kind"], date: string | null): DraftCity[] {
  return setService(cities, index, newServiceId(), { kind, date });
}

/** A row taken away: the trip's own stays taken away (it would be written again), an added one goes. */
export function removeService(cities: DraftCity[], index: number, id: string): DraftCity[] {
  if (isTripService(id)) return setService(cities, index, id, { removed: true });
  return cities.map((c, i) => (i === index && c.services ? { ...c, services: c.services.filter((s) => s.id !== id) } : c));
}

/** The stop's tours, at their count — what the card's tours change writes. */
export const withPicks = (cities: DraftCity[], index: number, picks: TourPick[]): DraftCity[] =>
  cities.map((c, i) => (i === index ? { ...c, tour_picks: picks, tours: picks.length } : c));

// ---------- the international flight, as first planned ----------

/** «name (CODE)» — what the airport list shows and what a leg stores. */
export const airportDisplay = (a: LookupAirport) => (a.code ? `${a.name} (${a.code})` : a.name);

/**
 * The airport a typed value names — the list's own text first, then its (CODE),
 * then a bare code («TZX»), then its name, its English name or its city as
 * typed (hamza and ta-marbuta folded: «طرابزون», «Trabzon Airport») — the first
 * airport of that city when the city has several.
 */
export function findAirport(value: string, airports: LookupAirport[]): LookupAirport | null {
  const v = value.trim();
  if (!v) return null;
  const code = (v.match(/\(([A-Za-z0-9]{3,4})\)/)?.[1] ?? v.match(/^[A-Za-z]{3}$/)?.[0])?.toUpperCase();
  const key = normAr(v);
  return (
    airports.find((a) => airportDisplay(a) === v) ??
    (code ? airports.find((a) => a.code?.toUpperCase() === code) : undefined) ??
    airports.find((a) => normAr(a.name) === key || (a.name_en && normAr(a.name_en) === key)) ??
    airports.find((a) => a.city && normAr(a.city) === key) ??
    null
  );
}

// ---------- which airports come first ----------

/** The company is in Madinah: its groups fly out of Prince Mohammad bin Abdulaziz first. */
export const HOME_AIRPORT = "MED";
const isHomeCountry = (country: string | null | undefined) => (country ?? "").includes("السعود");

/**
 * The airport list in the order an agent looks for it: for a departure from
 * home, Madinah then the Kingdom's other airports; for the destination side,
 * the package's own cities' airports, then its countries' — then everything
 * else, as before.
 */
export function rankAirports(airports: LookupAirport[], first: "home" | string[], cities: string[] = []): LookupAirport[] {
  const want = first === "home" ? [] : first.map((c) => c.trim()).filter(Boolean);
  const stay = cities.map((c) => c.trim()).filter(Boolean);
  const rank = (a: LookupAirport) =>
    first === "home"
      ? a.code === HOME_AIRPORT ? 0 : isHomeCountry(a.country) ? 1 : 2
      : stay.includes((a.city ?? "").trim()) ? 0 : want.includes((a.country ?? "").trim()) ? 1 : 2;
  return airports
    .map((a, i) => ({ a, i, r: rank(a) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map((x) => x.a);
}

/** The countries a trip goes to: its own and any neighbour a city crosses into. */
export const tripCountries = (data: Pick<DraftData, "trip" | "cities">) => [
  ...new Set([data.trip.country, ...data.cities.map((c) => c.country ?? "")].map((c) => c.trim()).filter(Boolean)),
];

/** The airport a city is flown to: the one the trip already uses there, else the first the list links to it. */
export function cityAirport(city: string, airports: LookupAirport[], flights: DraftFlight[] = []): string {
  const name = city.trim();
  if (!name) return "";
  for (const f of flights) {
    if (f.to_city?.trim() === name && f.to_airport.trim()) return f.to_airport;
    if (f.from_city?.trim() === name && f.from_airport.trim()) return f.from_airport;
  }
  const hit = airports.find((a) => a.city?.trim() === name);
  return hit ? airportDisplay(hit) : "";
}

/**
 * Where the group flies in: the first city's own airport, else the country's
 * main gateway, else its first airport. ponytail: the gateways are a short map
 * of the company's destinations; a «main airport» column on countries would
 * replace it if the list grows.
 */
const GATEWAY: Record<string, string> = {
  MY: "KUL", ID: "CGK", TH: "BKK", TR: "IST", GE: "TBS", AZ: "GYD", BA: "SJJ", EG: "CAI", VN: "HAN", RU: "SVO",
  LK: "CMB", KR: "ICN", JP: "NRT", AE: "DXB", MV: "MLE", SG: "SIN", PH: "MNL", MA: "CMN", MU: "MRU", ZA: "JNB", GR: "ATH",
};
export function arrivalAirport(
  data: Pick<DraftData, "trip" | "cities" | "flights">,
  airports: LookupAirport[],
  iso2: string | null | undefined,
): string {
  const first = data.cities[0]?.city_name;
  const own = first ? cityAirport(first, airports) : "";
  if (own) return own;
  const country = (data.cities[0]?.country || data.trip.country).trim();
  const gate = airports.find((a) => a.code === GATEWAY[(iso2 ?? "").toUpperCase()]) ?? airports.find((a) => (a.country ?? "").trim() === country);
  return gate ? airportDisplay(gate) : "";
}

export type FlightPlan = { from: string; to: string; go: string; back: string; round: boolean };

/**
 * The planned route as flight legs: out on `go`, home on `back` the other way
 * (unless one-way), each with its airports' zone and city resolved. They replace
 * the international legs, keep the domestic ones, and mark the booking
 * `estimate` — a leg with no ticket yet is complete with its airports and day.
 * A day equal to the trip's own keeps following the trip; any other stays put.
 */
export function planInternational(
  data: Pick<DraftData, "trip" | "flights" | "flight_booking">,
  airports: LookupAirport[],
  plan: FlightPlan,
): Pick<DraftData, "flights" | "flight_booking"> {
  const leg = (order: "outbound" | "inbound", from: string, to: string, date: string): DraftFlight => {
    const a = findAirport(from, airports);
    const b = findAirport(to, airports);
    // the leg already there keeps what was typed on it — its number, its id, its clocks (moved with its day)
    const was = data.flights.find((f) => f.leg_order === order);
    const departure_at = date ? `${date}T${was?.departure_at?.slice(11, 16) || "00:00"}` : null;
    const shift = was?.departure_at && date ? daysFrom(was.departure_at.slice(0, 10), date) : 0;
    const arrival_at = was?.arrival_at && departure_at ? `${addDaysIso(was.arrival_at.slice(0, 10), shift)}${was.arrival_at.slice(10)}` : null;
    return {
      ...(was ?? emptyFlight(order, data.trip)),
      from_airport: from,
      to_airport: to,
      from_tz: a?.timezone ?? null,
      to_tz: b?.timezone ?? null,
      from_city: a?.city ?? "",
      to_city: b?.city ?? "",
      departure_at,
      arrival_at,
      date_user_set: Boolean(date) && date !== autoDepartureDate(data.trip, order),
      cabin_class: was?.cabin_class || data.flight_booking.cabin,
    };
  };
  const legs =
    plan.from || plan.to
      ? [leg("outbound", plan.from, plan.to, plan.go), ...(plan.round ? [leg("inbound", plan.to, plan.from, plan.back)] : [])]
      : [];
  return {
    flights: [...legs, ...data.flights.filter((f) => f.leg_order === "internal")],
    flight_booking: { ...data.flight_booking, estimate: true, mode: plan.round ? "round" : "oneway" },
  };
}

// ---------- the domestic flights the cities call for ----------

/**
 * Every move the group makes by air, written as a planned domestic leg so the
 * agent never types a route the cities already say: from where the
 * international flight lands to the first city, between cities, and from the
 * last city to where the flight home leaves — on the day of the move.
 *
 * A move is by air when the agent picked «طيران» for it; with domestic flights
 * on, a move between two cities that both have an airport starts as a flight
 * (written into `hop_modes`, so the programme and the pricing agree) — the
 * agent switches it to road on the city card.
 *
 * A leg the agent ticketed (its flight number in) is kept as it is; a leg these
 * rules wrote (`auto`) follows the cities, and goes when its move does. A leg
 * the agent added by hand is never touched.
 */
/** One move of the group from a place to the next, on its day; `before` — the city card it comes before (the cities' count: after the last). */
export type CityMove = { from: string; to: string; day: string | null; overnight?: boolean; before: number; fromAirport?: string; toAirport?: string };

/**
 * Every move the group makes: from where the international flight lands to the
 * first city, city to city, and from the last city to where the flight home
 * leaves — on the day of the move. `overnight`: it leaves the evening the city
 * before checks out and lands the next day (arrives_next_day).
 */
export function cityMoves(data: Pick<DraftData, "cities" | "flights">): CityMove[] {
  const cities = data.cities;
  if (cities.length === 0) return [];
  const intl = data.flights.filter((f) => f.leg_order !== "internal");
  const landing = finalOutbound(intl);
  const home = intl.filter((f) => f.leg_order === "inbound").sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""))[0];
  const moves: CityMove[] = [];
  if (landing?.to_city?.trim()) moves.push({ from: landing.to_city, to: cities[0].city_name, day: cities[0].check_in, before: 0, fromAirport: landing.to_airport });
  cities
    .slice(1)
    .forEach((c, i) =>
      moves.push({ from: cities[i].city_name, to: c.city_name, day: c.arrives_next_day ? cities[i].check_out : c.check_in, overnight: c.arrives_next_day, before: i + 1 }),
    );
  const last = cities[cities.length - 1];
  if (home?.from_city?.trim()) moves.push({ from: last.city_name, to: home.from_city, day: last.check_out, before: cities.length, toAirport: home.from_airport });
  return moves.map((m) => ({ ...m, from: m.from.trim(), to: m.to.trim() })).filter((m) => m.from && m.to && m.from !== m.to);
}

/** Domestic legs in travel order: by their day, a leg with none after the rest (stable). */
export const byTravelOrder = (legs: DraftFlight[]) =>
  [...legs].sort((a, b) => (a.departure_at ?? "9999").localeCompare(b.departure_at ?? "9999"));

export function withDomesticFlights(data: DraftData, airports: LookupAirport[]): Pick<DraftData, "flights" | "transport_plan"> {
  const plan = data.transport_plan;
  const cities = data.cities;
  if (cities.length === 0) return { flights: data.flights, transport_plan: plan };
  const intl = data.flights.filter((f) => f.leg_order !== "internal");
  const old = data.flights.filter((f) => f.leg_order === "internal");

  type Stop = { city: string; airport: string };
  const stop = (city: string, airport?: string): Stop => ({ city, airport: airport?.trim() || cityAirport(city, airports, intl) });
  const real = cityMoves(data).map((m) => ({ ...m, from: stop(m.from, m.fromAirport), to: stop(m.to, m.toAirport) }));

  // a move with no pick of its own, between two airports, flies once flights are on
  const modes = intercityModes(plan);
  const hop_modes = { ...plan.intercity.hop_modes };
  for (const m of real) {
    const key = hopKey(m.from.city, m.to.city);
    const picked = hop_modes[key];
    if (picked && modes.includes(picked)) continue;
    if (modes.includes("flight") && m.from.airport && m.to.airport) hop_modes[key] = "flight";
  }
  const transport_plan = { ...plan, intercity: { ...plan.intercity, hop_modes } };

  const ticketed = (f: DraftFlight) => Boolean(f.flight_no.trim());
  const taken = new Set<DraftFlight>();
  // a city the agent's own domestic flights land in that day is reached by them — a connection through another
  // airport included — and never planned a second time; a city visited twice is flown into twice (Bangkok, then
  // Phuket, then Bangkok again — the evaluator, 2026-10-24)
  const flownByAgent = (m: (typeof real)[number]) =>
    old.some((f) => !f.auto && f.to_city?.trim() === m.to.city && (!m.day || !f.departure_at || f.departure_at.slice(0, 10) === m.day));
  // a move between two cities by air whose city has no airport of its own (Selangor, flown from KUL) gets its leg
  // all the same, the airport left for the agent to pick on the hop — a hop by air is never silently not booked
  // (AD-6-7907: «طيران» from Selangor and no flight sold). To or from the international flight, only between airports.
  const between = (m: (typeof real)[number]) => m.before > 0 && m.before < cities.length;
  const legs = real
    .filter((m) => hopMode(transport_plan, m.from.city, m.to.city) === "flight" && ((m.from.airport && m.to.airport) || between(m)) && !flownByAgent(m))
    .map((m): DraftFlight => {
      const mine = old.find((f) => !taken.has(f) && f.from_city?.trim() === m.from.city && f.to_city?.trim() === m.to.city);
      if (mine) taken.add(mine);
      if (mine && (ticketed(mine) || !mine.auto)) return mine;
      // an airport or a day the agent changed on the leg stays theirs
      const from = mine?.from_airport.trim() || m.from.airport;
      const to = mine?.to_airport.trim() || m.to.airport;
      const a = findAirport(from, airports);
      const b = findAirport(to, airports);
      const time = mine?.departure_at?.slice(11, 16) || "00:00";
      const departure_at = mine?.date_user_set ? mine.departure_at : m.day ? `${m.day}T${time}` : null;
      // the landing time typed on it stays, on the day it lands — the next one over an overnight move
      const lands = mine?.arrival_at?.slice(11, 16);
      const arrival_at = lands && departure_at ? `${addDaysIso(departure_at.slice(0, 10), m.overnight ? 1 : 0)}T${lands}` : (mine?.arrival_at ?? null);
      return {
        ...(mine ?? emptyFlight("internal", data.trip)),
        from_airport: from,
        to_airport: to,
        from_tz: a?.timezone ?? mine?.from_tz ?? null,
        to_tz: b?.timezone ?? mine?.to_tz ?? null,
        from_city: m.from.city,
        to_city: m.to.city,
        departure_at,
        arrival_at,
        cabin_class: mine?.cabin_class || data.flight_booking.cabin,
        auto: true,
      };
    });
  // the agent's own legs stay; the ones these rules wrote go with their move — all of them in travel order, so an
  // edited leg never jumps to the end of the list under the agent's hand (the evaluator, 2026-10-24: 03/12 above 26/11)
  const kept = old.filter((f) => !taken.has(f) && (!f.auto || ticketed(f)));
  return { flights: [...intl, ...byTravelOrder([...legs, ...kept])], transport_plan };
}

// ---------- «يشمل» that follows the file ----------

/** The company's own «يشمل» lines that say what the file holds — kept in step with it. */
const SCOPE_LINES: { text: string; on: (d: DraftData) => boolean; otherwiseExcluded?: boolean }[] = [
  { text: "الطيران الدولي", on: (d) => d.scope.flights_intl, otherwiseExcluded: true },
  { text: "الطيران الداخلي", on: (d) => d.scope.flights_domestic && d.flights.some((f) => f.leg_order === "internal") },
  { text: "الفنادق", on: (d) => d.scope.hotels },
  { text: "الجولات السياحية", on: (d) => d.transport_plan.tours.enabled },
  // «بكج متقدم» that meets or leaves the group elsewhere never promises «من المطار»
  { text: AIRPORT_TRANSFER_LINE, on: (d) => d.scope.transport && !meetsElsewhere(d.advanced) },
  // «أضف لاحقاً»: the document prints it where the flights would be (OfferDocument)
  { text: FLIGHTS_LATER_LINE, on: flightsLater },
];

/**
 * «يشمل / لا يشمل» as the file actually is: a flight booked is included (and no
 * longer «لا يشمل»), a domestic flight only when there is one, hotels, tours
 * and transfers only when sold. The meals are said once — by the meal plan's
 * own line — so the list's «وجبة الإفطار» goes, and «وجبة الغداء والعشاء» is
 * not excluded from a plan that serves them. Lines the agent wrote stay.
 */
export function withScopeLines(data: DraftData): DraftServices {
  let includes = [...data.services.includes];
  let excludes = [...data.services.excludes];
  for (const line of SCOPE_LINES) {
    if (line.on(data)) {
      if (!includes.includes(line.text)) includes.push(line.text);
      excludes = excludes.filter((x) => x !== line.text);
    } else {
      includes = includes.filter((x) => x !== line.text);
      if (line.otherwiseExcluded && !excludes.includes(line.text)) excludes.push(line.text);
    }
  }
  const meal = data.trip.meal_plan;
  if (meal) includes = includes.filter((x) => x.trim() !== "وجبة الإفطار");
  if (meal === "lunch" || meal === "dinner" || meal === "all") excludes = excludes.filter((x) => x.trim() !== "وجبة الغداء والعشاء");
  return { ...data.services, includes, excludes };
}

// ---------- room types, the clear ones first ----------

/** The room types every client understands — offered first, before any hotel's own names. */
export const STANDARD_ROOMS = [
  "غرفة مفردة",
  "غرفة مزدوجة",
  "غرفة مزدوجة بسريرين منفصلين",
  "غرفة ثلاثية",
  "غرفة رباعية",
  "غرفة عائلية",
  "غرفتان متصلتان",
  "جناح",
  "جناح عائلي",
  "فيلا",
];

/**
 * What the room field suggests: the chosen hotel's own rooms first, in category
 * order (single, double … suite, villa), then the clear names — never another
 * hotel's. `withGlobal` (the full generator) keeps the rest of the shared list after them.
 */
export function roomSuggestions(roomTypes: LookupRoomType[], hotelId: string | null | undefined, withGlobal = false): string[] {
  const own = hotelId
    ? roomTypes.filter((r) => r.hotel_id === hotelId).map((r) => r.name.trim()).sort((a, b) => roomRank(a) - roomRank(b))
    : [];
  const shared = withGlobal ? roomTypeNames(roomTypes.filter((r) => r.hotel_id === null)) : [];
  return [...new Set([...own, ...STANDARD_ROOMS, ...shared])].filter(Boolean);
}

// ---------- the package's profit ----------

/** The profit a file carries: the one stated on it, else the default margin — when no line has a profit of its own. */
export function packageProfitFor(pricing: Pick<DraftData["pricing"], "profit" | "items">, defaultPct: number | null): PackageProfit | undefined {
  if (pricing.profit) return pricing.profit;
  if (!defaultPct) return undefined;
  const own = pricing.items.some((i) => i.profit_pct != null || i.profit_amount != null);
  return own ? undefined : { mode: "pct", value: defaultPct };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The package's profit laid onto its lines, the way the sheet already prices a
 * profit: a margin is every line's own «٪»; a whole amount is shared over the
 * lines in proportion to what each costs in the quote currency, each share in
 * the line's own currency (per unit). The lines' typed figures stay the cost.
 * No profit stated leaves the lines as they are.
 *
 * `rates`: quote-currency units per one unit of each currency (rebase()).
 */
export function withPackageProfit(
  items: DraftPricingItem[],
  profit: PackageProfit | undefined,
  rates: Record<string, number>,
  quote: string,
): DraftPricingItem[] {
  if (!profit) return items;
  const bare = (i: DraftPricingItem) => ({ ...i, profit_pct: null, profit_amount: null });
  if (profit.value == null || !Number.isFinite(profit.value) || profit.value === 0) return items.map(bare);
  if (profit.mode === "pct") return items.map((i) => ({ ...i, profit_pct: profit.value, profit_amount: null }));
  const qty = (i: DraftPricingItem) => (i.quantity > 0 ? i.quantity : 1);
  const rate = (i: DraftPricingItem) => (i.buy_currency || quote) === quote ? 1 : (rates[i.buy_currency || quote] ?? 0);
  const cost = items.map((i) => (i.buy_price == null ? 0 : i.buy_price * qty(i) * rate(i)));
  const total = cost.reduce((a, b) => a + b, 0);
  if (total <= 0) return items.map(bare);
  const shared = items.map((i, k) =>
    cost[k] > 0 ? { ...i, profit_pct: null, profit_amount: round2((profit.value! * cost[k]) / total / rate(i) / qty(i)) } : bare(i),
  );
  // the cents rounding took or gave go to the costliest line, so the amount is the amount
  const given = shared.reduce((sum, i) => sum + (i.profit_amount ?? 0) * qty(i) * rate(i), 0);
  const big = cost.indexOf(Math.max(...cost));
  const fix = profit.value - given;
  if (Math.abs(fix) >= 0.005) {
    const b = shared[big];
    shared[big] = { ...b, profit_amount: round2((b.profit_amount ?? 0) + fix / rate(b) / qty(b)) };
  }
  return shared;
}

// ---------- the car the group rides in ----------

/** Not chosen for a group by size alone: a limousine, an accessible vehicle. */
const SPECIAL_CAR = /vip|ليموزين|ذوي الاحتياجات|مجهزة/i;

/**
 * The car a group of `people` rides in: the smallest ordinary car that seats it
 * — with a seat to spare from three people up, for the luggage — else enough of
 * the largest. Null when the list has no sizes.
 */
export function carForGroup(carTypes: { name: string; pax: number | null }[], people: number): { car_type: string; cars: number } | null {
  // the seats column first; a type nobody filled in still says them in its name («باص 40 راكب»)
  const seats = carTypes
    .map((c) => ({ name: c.name, pax: c.pax ?? seatsFromName(c.name) }))
    .filter((c) => (c.pax ?? 0) > 0 && !SPECIAL_CAR.test(c.name))
    .sort((a, b) => (a.pax ?? 0) - (b.pax ?? 0));
  if (seats.length === 0 || people <= 0) return null;
  const need = people >= 3 ? people + 1 : people;
  const fits = seats.find((c) => (c.pax ?? 0) >= need);
  if (fits) return { car_type: fits.name, cars: 1 };
  const big = seats[seats.length - 1];
  return { car_type: big.name, cars: Math.ceil(need / (big.pax ?? 1)) };
}

/** Every car the trip still lacks — reception, tours, between cities, farewell — takes the one that seats the group. */
export function withGroupCars(plan: DraftData["transport_plan"], car: { car_type: string; cars: number } | null): DraftData["transport_plan"] {
  if (!car) return plan;
  const fill = <T extends { car_type: string; cars: number }>(leg: T): T => (leg.car_type.trim() ? leg : { ...leg, ...car });
  return {
    ...plan,
    airport: fill(plan.airport),
    tours: fill(plan.tours),
    intercity: fill(plan.intercity),
    ...(plan.farewell ? { farewell: fill(plan.farewell) } : {}),
  };
}

/** The group grew or shrank: a car that was the group's size follows; one the agent chose stays. */
export function resizeGroupCars(
  plan: DraftData["transport_plan"],
  before: { car_type: string; cars: number } | null,
  after: { car_type: string; cars: number } | null,
): DraftData["transport_plan"] {
  if (!before || !after) return plan;
  const follow = <T extends { car_type: string; cars: number }>(leg: T): T =>
    leg.car_type === before.car_type && leg.cars === before.cars ? { ...leg, ...after } : leg;
  return {
    ...plan,
    airport: follow(plan.airport),
    tours: follow(plan.tours),
    intercity: follow(plan.intercity),
    ...(plan.farewell ? { farewell: follow(plan.farewell) } : {}),
  };
}

// ---------- «بكج متقدم» → the flight plan ----------

/**
 * The airports chosen in «بكج متقدم» written into the PLANNED international
 * flights: the outbound lands where the client arrives, the flight home leaves
 * from where they leave — another airport, another country if so. Null when
 * there is nothing to change. A ticketed booking (a flight number in) is never
 * rewritten: the card says the two disagree and the agent decides.
 */
export function withAdvancedAirports(
  data: Pick<DraftData, "trip" | "flights" | "flight_booking" | "advanced">,
  airports: LookupAirport[],
): Pick<DraftData, "flights" | "flight_booking"> | null {
  const adv = data.advanced;
  if (!adv?.on) return null;
  if (data.flights.some((f) => f.leg_order !== "internal" && f.flight_no.trim())) return null;
  const pick = (on: boolean, by: string, label: string) => (on && by === "flight" ? findAirport(label, airports) : null);
  const land = pick(adv.parts.arrival, adv.arrive_by, adv.arrive_at);
  const leave = pick(adv.parts.departure, adv.leave_by, adv.leave_from);
  if (!land && !leave) return null;
  const out = data.flights.filter((f) => f.leg_order === "outbound");
  const back = data.flights.find((f) => f.leg_order === "inbound");
  const oldTo = out.at(-1)?.to_airport ?? "";
  const to = land ? airportDisplay(land) : oldTo;
  // a flight home that left from where they landed keeps doing so after the landing moves
  const leaveFrom = leave ? airportDisplay(leave) : !back || back.from_airport === oldTo ? to : back.from_airport;
  if (to === oldTo && leaveFrom === (back?.from_airport ?? "")) return null;
  const home = airports.find((a) => a.code === HOME_AIRPORT);
  const planned = planInternational(data, airports, {
    from: out[0]?.from_airport || (home ? airportDisplay(home) : ""),
    to,
    go: (out[0]?.departure_at ?? data.trip.arrival_date ?? "").slice(0, 10),
    back: (back?.departure_at ?? data.trip.departure_date ?? "").slice(0, 10),
    // leaving from somewhere is a flight home
    round: Boolean(back) || Boolean(leave),
  });
  const leaveAt = leave ?? findAirport(leaveFrom, airports);
  return {
    ...planned,
    flights: planned.flights.map((f) =>
      f.leg_order === "inbound" && leaveFrom !== to
        ? { ...f, from_airport: leaveFrom, from_tz: leaveAt?.timezone ?? null, from_city: leaveAt?.city ?? "" }
        : f,
    ),
  };
}
