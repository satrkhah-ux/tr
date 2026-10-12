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
  deriveCityDates,
  deriveHotelStays,
  emptyRoomSpec,
  FREE_DAY_TITLE,
  hopMode,
  MEAL_PLAN_BOARD,
  newStayId,
  resizeRooms,
  withRooms,
  type DraftCity,
  type DraftData,
  type DraftDay,
  type DraftHotel,
  type DraftTrip,
  type HotelStay,
  type TourPick,
  type TransportMode,
} from "./draft-types";
import { draftDaySkeleton } from "./itinerary";
import { itineraryStartDate } from "./schedule";

/**
 * A city as this screen holds it. The extra answer rides on the draft's own
 * city row (normalize passes city rows through untouched), so no column and no
 * migration: `tours` decides how many of the city's days are tour days.
 */
export type BasicCity = DraftCity;

/** The day titles this screen writes — and therefore may rewrite. A title the agent typed is never touched. */
const AUTO_TITLE = /^(الوصول إلى |الانتقال إلى |جولة سياحية في |السفر إلى |المغادرة$|العودة إلى )/;
const isAutoTitle = (title: string) => !title.trim() || title === FREE_DAY_TITLE || AUTO_TITLE.test(title);

/** The cities with their dates chained from where the itinerary starts. */
export function chainCities(data: Pick<DraftData, "trip" | "flights">, cities: BasicCity[]): BasicCity[] {
  return deriveCityDates(itineraryStartDate(data.trip, data.flights), cities);
}

/** Nights the trip still has to give a city — what the add bar offers first. */
export function remainingNights(data: Pick<DraftData, "trip" | "cities">): number {
  return Math.max(data.trip.nights - data.cities.reduce((sum, c) => sum + c.nights, 0), 0);
}

/** A city's hotel line, born with the trip's rooms and meals so the agent only picks the hotel. */
export function hotelForCity(data: Pick<DraftData, "trip">, city: string, currency: string): DraftHotel {
  const board = data.trip.meal_plan ? MEAL_PLAN_BOARD[data.trip.meal_plan] : data.trip.default_board;
  const room = { ...emptyRoomSpec(), room_type_name: data.trip.default_room_type_name, board_type: board };
  return withRooms(
    {
      id: newStayId(),
      city_name: city,
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
export type StayPick = { hotel?: { id: string; name: string } | null; room?: string; rooms?: number };

function withStayPick(line: DraftHotel, pick: StayPick): DraftHotel {
  let next = pick.rooms && pick.rooms !== line.rooms.length ? resizeRooms(line, pick.rooms) : line;
  if (pick.hotel) next = { ...next, hotel_id: pick.hotel.id, hotel_name: pick.hotel.name, hotel_name_en: "" };
  if (pick.room?.trim()) next = renameRooms(next, pick.room.trim());
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
): Pick<DraftData, "cities" | "hotels"> {
  // The same city again, right after itself, is more nights there — not a second
  // row the group «moves» into from itself (with a transfer priced for the move).
  const at = data.cities.length - 1;
  const last = data.cities[at] as BasicCity | undefined;
  if (last && last.city_name === city.name) {
    const longer = setCityNights(data, at, last.nights + city.nights);
    // a hotel picked now fills the city's line only if it has none yet
    const [main] = cityLines(longer.hotels, city.name);
    return {
      cities: longer.cities.map((c, i) =>
        i === at ? { ...c, tours: Math.min(((c as BasicCity).tours ?? 0) + city.tours, c.nights) } : c,
      ),
      hotels: main && !main.hotel_name.trim() ? longer.hotels.map((h) => (h.id === main.id ? withStayPick(h, city) : h)) : longer.hotels,
    };
  }
  const next: BasicCity = {
    city_name: city.name,
    nights: city.nights,
    tours: Math.min(city.tours, city.nights),
    check_in: null,
    check_out: null,
    ...(city.country && city.country !== data.trip.country ? { country: city.country } : {}),
  };
  const hasHotel = data.hotels.some((h) => h.city_name === city.name);
  return {
    cities: chainCities(data, [...data.cities, next]),
    hotels: hasHotel ? data.hotels : [...data.hotels, withStayPick(hotelForCity(data, city.name, currency), city)],
  };
}

/** Remove a city; its hotel lines go with it unless the same city is visited again. */
export function removeCity(data: DraftData, index: number): Pick<DraftData, "cities" | "hotels"> {
  const gone = data.cities[index];
  const cities = data.cities.filter((_, i) => i !== index);
  const stillThere = cities.some((c) => c.city_name === gone?.city_name);
  return {
    cities: chainCities(data, cities),
    hotels: stillThere ? data.hotels : data.hotels.filter((h) => h.city_name !== gone?.city_name),
  };
}

/** Every city holds a hotel line while the sale includes hotels — a city the flights created has none yet. */
export function withHotelLines(data: DraftData, currency: string): DraftHotel[] {
  if (!data.scope.hotels) return data.hotels;
  const missing = [...new Set(data.cities.map((c) => c.city_name))].filter((name) => !data.hotels.some((h) => h.city_name === name));
  return missing.length === 0 ? data.hotels : [...data.hotels, ...missing.map((name) => hotelForCity(data, name, currency))];
}

/**
 * The agent typed what a stay costs for ITS nights. When a stay's nights move —
 * the city got longer, a room change split it — the total moves with them at
 * the same nightly rate: a 3-night total offered for a 4-night stay is the
 * mistake this screen must not make.
 */
function keepNightlyRates(prev: HotelStay[], hotels: DraftHotel[], cities: DraftCity[]): DraftHotel[] {
  const was = new Map(prev.map((s) => [s.line.id, s.nights]));
  const now = new Map(deriveHotelStays(cities, hotels).map((s) => [s.line.id, s.nights]));
  return hotels.map((h) => {
    const a = was.get(h.id);
    const b = now.get(h.id);
    if (h.sourcing || !a || !b || a === b) return h;
    return withRooms(
      h,
      h.rooms.map((r) => (r.price == null ? r : { ...r, price: Math.round(((r.price * b) / a) * 100) / 100 })),
    );
  });
}

/** A city's nights changed: its stays keep their nightly rate, and a room change keeps a night after it. */
export function setCityNights(data: DraftData, index: number, nights: number): Pick<DraftData, "cities" | "hotels"> {
  const before = data.cities[index];
  if (!before || nights < 1) return { cities: data.cities, hotels: data.hotels };
  const prev = deriveHotelStays(data.cities, data.hotels);
  const cities = chainCities(
    data,
    data.cities.map((c, i) => (i === index ? { ...c, nights, tours: Math.min((c as BasicCity).tours ?? 0, nights) } : c)),
  );
  let hotels = data.hotels.map((h) =>
    h.city_name === before.city_name && h.nights > 0 ? { ...h, nights: Math.min(h.nights, Math.max(nights - 1, 0)) } : h,
  );
  if (nights < 2) hotels = withoutRoomChange(hotels, before.city_name);
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

/** A new room type for every room of the line; a room's extra bed stays with it. */
export function renameRooms(line: DraftHotel, name: string): DraftHotel {
  return withRooms(
    line,
    line.rooms.map((r) => ({ ...r, room_type_id: null, room_type_name: name + (r.room_type_name.endsWith(EXTRA_BED) ? EXTRA_BED : "") })),
  );
}

/** The city's stays in order: the main one, and the one a room change moves to. */
export const cityLines = (hotels: DraftHotel[], cityName: string) => hotels.filter((h) => h.city_name === cityName);

function withoutRoomChange(hotels: DraftHotel[], cityName: string): DraftHotel[] {
  const [main, ...rest] = cityLines(hotels, cityName);
  if (!main || rest.length === 0) return hotels;
  const gone = new Set(rest.map((h) => h.id));
  return hotels.filter((h) => !gone.has(h.id)).map((h) => (h.id === main.id ? { ...h, nights: 0 } : h));
}

/**
 * Same hotel, another room after `after` nights: the city's stay splits in two
 * — the first keeps `after` nights, the second takes the rest. Each half carries
 * its own total, so the first is cut to its nights at the same rate.
 */
export function changeRoom(data: DraftData, cityName: string, after: number, roomName: string): Pick<DraftData, "hotels"> {
  const city = data.cities.find((c) => c.city_name === cityName);
  const [main, second] = cityLines(data.hotels, cityName);
  if (!city || !main || city.nights < 2) return { hotels: data.hotels };
  const nights = Math.min(Math.max(Math.trunc(after), 1), city.nights - 1);
  const prev = deriveHotelStays(data.cities, data.hotels);
  const next = renameRooms(
    second
      ? { ...second, nights: 0 }
      : withRooms({ ...main, id: newStayId(), nights: 0, sourcing: null }, main.rooms.map((r) => ({ ...r, price: null }))),
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
export function clearRoomChange(data: DraftData, cityName: string): Pick<DraftData, "hotels"> {
  const prev = deriveHotelStays(data.cities, data.hotels);
  return { hotels: keepNightlyRates(prev, withoutRoomChange(data.hotels, cityName), data.cities) };
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

/** The first thing that happens on arrival — the company's own welcome, on every file. */
export const WELCOME = "الاستقبال من المطار من قبل موظف ترافليون والتوجه إلى الفندق";

/** How the group reaches a city it moves to, as the day's activities say it. */
function moveLines(mode: TransportMode, city: string, flightNo: string): string[] {
  if (mode === "flight") {
    return [
      "تسجيل الخروج من الفندق والتوجه إلى المطار",
      `السفر إلى ${city} على الطيران الداخلي${flightNo ? ` (${flightNo})` : ""}`,
      `الاستقبال من مطار ${city} والتوجه إلى الفندق`,
    ];
  }
  const how = mode === "train" ? "بالقطار" : mode === "ship" ? "بالعبّارة" : "براً";
  return ["تسجيل الخروج من الفندق", `الانتقال ${how} إلى ${city} والتوجه إلى الفندق`];
}

/** Resize a city's tour picks to its tour count, keeping what was chosen. */
export function withTourCount(picks: TourPick[] | undefined, count: number): TourPick[] {
  const list = (picks ?? []).slice(0, count);
  while (list.length < count) list.push({ program_id: null, title: "", text: "", price: null });
  return list;
}

/**
 * The programme, written from the cities and how the group moves between them:
 * the arrival with the company's welcome, the day of each move (a domestic
 * flight reads «to the airport — the flight — met at the next airport»), each
 * city's tour days with the tour the agent picked, free days, and the way home.
 *
 * A day is the screen's while its title is still the one the screen wrote
 * (`auto_title`, or an old auto title); the first hand edit makes it the
 * agent's, and it is never rewritten again.
 */
export function basicDays(data: DraftData): DraftDay[] {
  const days = draftDaySkeleton(data);
  const cities = data.cities as BasicCity[];
  const plan = data.transport_plan;
  const stay = days.map((d, i) => (d.kind === "travel" ? -1 : i)).filter((i) => i >= 0);
  const firstStay = stay[0] ?? -1;
  const lastDay = days.length - 1;

  // tours switched off in «البرنامج يشمل»: every day that is not a move is free
  const toursOn = plan.tours.enabled;
  let cityIndex = -1;
  let tourIndex = 0;
  return days.map((day, i) => {
    if (day.kind === "travel") return day;
    const moved = i === firstStay || days[i - 1]?.city_name !== day.city_name;
    if (moved && i !== lastDay) {
      cityIndex += 1;
      tourIndex = 0;
    }
    const city = cities[cityIndex];
    const tours = toursOn ? (city?.tours ?? 0) : 0;
    let title: string;
    let activities: string[] = [];
    if (i === lastDay) {
      title = "المغادرة";
      activities = ["تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة"];
    } else if (i === firstStay) {
      title = `الوصول إلى ${day.city_name}`;
      activities = [WELCOME];
    } else if (moved) {
      const from = days[i - 1]?.city_name ?? "";
      const mode = hopMode(plan, from, day.city_name);
      const leg = data.flights.find((f) => f.leg_order === "internal" && f.to_city?.trim() === day.city_name);
      title = mode === "flight" ? `السفر إلى ${day.city_name}` : `الانتقال إلى ${day.city_name}`;
      activities = moveLines(mode, day.city_name, leg?.flight_no.trim() ?? "");
    } else if (tourIndex < tours) {
      const pick = city?.tour_picks?.[tourIndex];
      tourIndex += 1;
      title = pick?.title.trim() || `جولة سياحية في ${day.city_name}`;
      activities = pick?.text.trim() ? [pick.text.trim()] : [];
    } else title = FREE_DAY_TITLE;

    const owned = day.auto_title !== undefined ? day.title === day.auto_title : isAutoTitle(day.title);
    return owned ? { ...day, title, activities, auto_title: title } : day;
  });
}
