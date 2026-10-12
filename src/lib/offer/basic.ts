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
  emptyFlight,
  emptyRoomSpec,
  FREE_DAY_TITLE,
  hopKey,
  hopMode,
  intercityModes,
  MEAL_PLAN_BOARD,
  newStayId,
  resizeRooms,
  withRooms,
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
  type HotelStay,
  type LookupAirport,
  type TourPick,
  type TransportMode,
} from "./draft-types";
import { draftDaySkeleton } from "./itinerary";
import { autoDepartureDate, finalOutbound, itineraryStartDate } from "./schedule";

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
    data.cities.map((c, i) => (i === index ? { ...c, nights } : c)),
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
 * The days a city's tours go on, in the order they are handed out: the days
 * after the group arrives first (the arrival day is spent arriving), then the
 * arrival day itself — only once those are taken does a day get a second tour.
 */
export function tourDays(city: Pick<DraftCity, "check_in" | "nights">): string[] {
  const all = cityDates(city);
  return [...all.slice(1), ...all.slice(0, 1)];
}

/** Every date the group sleeps in the city — the days a tour may be put on. */
export function cityDates(city: Pick<DraftCity, "check_in" | "nights">): string[] {
  if (!city.check_in) return [];
  return Array.from({ length: Math.max(city.nights, 1) }, (_, k) => addDaysIso(city.check_in!, k));
}

/**
 * Every tour gets its day written down — the first of `days` no tour has yet;
 * once they are all taken, the days are shared in turn. A tour that already
 * has a day keeps it.
 */
export function fillTourDates(picks: TourPick[], days: string[]): TourPick[] {
  if (days.length === 0) return picks;
  const used = new Set(picks.map((p) => p.date).filter(Boolean));
  let turn = 0;
  return picks.map((p) => {
    if (p.date) return p;
    const date = days.find((d) => !used.has(d)) ?? days[turn++ % days.length];
    used.add(date);
    return { ...p, date };
  });
}

/**
 * The city's tours at a count, each with its day, in date order. A day the city
 * no longer has (its dates moved) is let go and the tour takes the next free one.
 */
export function withTours(city: Pick<DraftCity, "check_in" | "nights" | "tour_picks">, count: number): TourPick[] {
  const own = cityDates(city);
  const kept = withTourCount(city.tour_picks, count).map((p) => (p.date && own.length > 0 && !own.includes(p.date) ? { ...p, date: null } : p));
  return fillTourDates(kept, tourDays(city)).sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
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

  // 1. which city each day is in, and what kind of day it is
  type Kind = "travel" | "arrive" | "move" | "last" | "stay";
  const cityOf: number[] = [];
  const kindOf: Kind[] = [];
  let at = -1;
  days.forEach((day, i) => {
    if (day.kind === "travel") {
      cityOf.push(-1);
      kindOf.push("travel");
      return;
    }
    const moved = i === firstStay || days[i - 1]?.city_name !== day.city_name;
    if (moved && i !== lastDay) at += 1;
    cityOf.push(at);
    kindOf.push(i === lastDay ? "last" : i === firstStay ? "arrive" : moved ? "move" : "stay");
  });

  // 2. each city's tours: a tour with a date goes on that day; the rest take the
  // city's free days in turn. A client may want more tours than the city has
  // days — they share a day rather than being refused — and a city with no free
  // day at all takes them on the day the group arrives.
  const toursOn = plan.tours.enabled;
  const toursOf = new Map<number, TourPick[]>();
  const put = (day: number, pick: TourPick) => toursOf.set(day, [...(toursOf.get(day) ?? []), pick]);
  cities.forEach((city, c) => {
    const count = toursOn ? (city.tours ?? 0) : 0;
    if (count === 0) return;
    const cityDays = days.map((_, i) => i).filter((i) => cityOf[i] === c);
    const free = cityDays.filter((i) => kindOf[i] === "stay");
    const undated: TourPick[] = [];
    // the same days the city card shows
    for (const pick of withTours(city, count)) {
      const named = { ...pick, title: pick.free ? FREE_DAY_TITLE : pick.title.trim() || `جولة سياحية في ${city.city_name}` };
      const day = pick.date ? cityDays.find((i) => days[i].date === pick.date) : undefined;
      if (day !== undefined) put(day, named);
      else undated.push(named);
    }
    const open = free.filter((i) => !toursOf.has(i));
    const slots = open.length > 0 ? open : free.length > 0 ? free : cityDays.slice(0, 1);
    undated.forEach((pick, k) => {
      if (slots.length > 0) put(slots[k % slots.length], pick);
    });
  });

  // 3. the days
  return days.map((day, i) => {
    if (day.kind === "travel") return day;
    const kind = kindOf[i];
    let title: string;
    let activities: string[] = [];
    if (kind === "last") {
      title = "المغادرة";
      activities = ["تسجيل الخروج من الفندق والتوجه إلى المطار للمغادرة"];
    } else if (kind === "arrive") {
      title = `الوصول إلى ${day.city_name}`;
      activities = [WELCOME];
    } else if (kind === "move") {
      const from = days[i - 1]?.city_name ?? "";
      const mode = hopMode(plan, from, day.city_name);
      const leg = data.flights.find((f) => f.leg_order === "internal" && f.to_city?.trim() === day.city_name);
      title = mode === "flight" ? `السفر إلى ${day.city_name}` : `الانتقال إلى ${day.city_name}`;
      activities = moveLines(mode, day.city_name, leg?.flight_no.trim() ?? "");
    } else title = FREE_DAY_TITLE;

    // «يوم حر» picked on purpose keeps the day free; it is not a tour
    const tours = (toursOf.get(i) ?? []).filter((t) => !t.free);
    if (tours.length > 0) {
      const line = (t: TourPick) => (t.text.trim() ? `${t.title}: ${t.text.trim()}` : t.title);
      if (kind === "stay") {
        // the day is named after its first tour; any more the client asked for follow it
        title = tours[0].title;
        activities = [...(tours[0].text.trim() ? [tours[0].text.trim()] : []), ...tours.slice(1).map(line)];
      } else activities = [...activities, ...tours.map(line)];
      // the car each tour goes in — the trip's tour car unless the tour has its own — said once
      const cars = [...new Set(tours.map((t) => t.car_type?.trim() || plan.tours.car_type.trim()).filter(Boolean))];
      if (cars.length > 0) activities = [...activities, `التنقل بـ${cars.join(" و")}`];
    }

    const owned = day.auto_title !== undefined ? day.title === day.auto_title : isAutoTitle(day.title);
    return owned ? { ...day, title, activities, auto_title: title } : day;
  });
}

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
 * A price changed on the pricing sheet is changed where it was typed — the
 * stay's rooms, the tour, the flight booking — so the two never disagree.
 * Null when the line has no such place (a transfer from the list, a visa, a
 * line added by hand, a supplier rate): the sheet keeps it as the agent's own.
 */
export function priceAtSource(
  data: DraftData,
  item: Pick<DraftPricingItem, "item_type" | "ref">,
  change: { price?: number | null; currency?: string },
): Partial<Pick<DraftData, "hotels" | "cities" | "flight_booking">> | null {
  const ref = item.ref ?? "";
  if (item.item_type === "flight" && (ref === "flight:intl" || ref === "flight:dom")) {
    const b = data.flight_booking;
    if (ref === "flight:intl") return { flight_booking: { ...b, intl_price: change.price !== undefined ? change.price : b.intl_price, intl_currency: change.currency ?? b.intl_currency } };
    return { flight_booking: { ...b, dom_price: change.price !== undefined ? change.price : b.dom_price, dom_currency: change.currency ?? b.dom_currency } };
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

// ---------- the international flight, as first planned ----------

/** «name (CODE)» — what the airport list shows and what a leg stores. */
export const airportDisplay = (a: LookupAirport) => (a.code ? `${a.name} (${a.code})` : a.name);

/** The airport a typed value names — the list's own text first, then its (CODE). */
export function findAirport(value: string, airports: LookupAirport[]): LookupAirport | null {
  const v = value.trim();
  if (!v) return null;
  const code = v.match(/\(([A-Za-z0-9]{3,4})\)/)?.[1]?.toUpperCase();
  return airports.find((a) => airportDisplay(a) === v) ?? (code ? (airports.find((a) => a.code?.toUpperCase() === code) ?? null) : null);
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
    return {
      ...emptyFlight(order, data.trip),
      from_airport: from,
      to_airport: to,
      from_tz: a?.timezone ?? null,
      to_tz: b?.timezone ?? null,
      from_city: a?.city ?? "",
      to_city: b?.city ?? "",
      departure_at: date ? `${date}T00:00` : null,
      date_user_set: Boolean(date) && date !== autoDepartureDate(data.trip, order),
      cabin_class: data.flight_booking.cabin,
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
export function withDomesticFlights(data: DraftData, airports: LookupAirport[]): Pick<DraftData, "flights" | "transport_plan"> {
  const plan = data.transport_plan;
  const cities = data.cities;
  if (cities.length === 0) return { flights: data.flights, transport_plan: plan };
  const intl = data.flights.filter((f) => f.leg_order !== "internal");
  const old = data.flights.filter((f) => f.leg_order === "internal");
  const landing = finalOutbound(intl);
  const home = intl.filter((f) => f.leg_order === "inbound").sort((a, b) => (a.departure_at ?? "").localeCompare(b.departure_at ?? ""))[0];

  type Stop = { city: string; airport: string };
  const stop = (city: string, airport?: string): Stop => ({ city: city.trim(), airport: airport?.trim() || cityAirport(city, airports, intl) });
  const moves: { from: Stop; to: Stop; day: string | null }[] = [];
  if (landing?.to_city?.trim()) moves.push({ from: stop(landing.to_city, landing.to_airport), to: stop(cities[0].city_name), day: cities[0].check_in });
  cities.slice(1).forEach((c, i) => moves.push({ from: stop(cities[i].city_name), to: stop(c.city_name), day: c.check_in }));
  const last = cities[cities.length - 1];
  if (home?.from_city?.trim()) moves.push({ from: stop(last.city_name), to: stop(home.from_city, home.from_airport), day: last.check_out });
  const real = moves.filter((m) => m.from.city && m.to.city && m.from.city !== m.to.city);

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
  const legs = real
    .filter((m) => hopMode(transport_plan, m.from.city, m.to.city) === "flight" && m.from.airport && m.to.airport)
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
      return {
        ...(mine ?? emptyFlight("internal", data.trip)),
        from_airport: from,
        to_airport: to,
        from_tz: a?.timezone ?? mine?.from_tz ?? null,
        to_tz: b?.timezone ?? mine?.to_tz ?? null,
        from_city: m.from.city,
        to_city: m.to.city,
        departure_at: mine?.date_user_set ? mine.departure_at : m.day ? `${m.day}T${time}` : null,
        cabin_class: mine?.cabin_class || data.flight_booking.cabin,
        auto: true,
      };
    });
  // the agent's own legs stay; the ones these rules wrote go with their move
  const kept = old.filter((f) => !taken.has(f) && (!f.auto || ticketed(f)));
  return { flights: [...intl, ...legs, ...kept], transport_plan };
}

// ---------- «يشمل» that follows the file ----------

/** The company's own «يشمل» lines that say what the file holds — kept in step with it. */
const SCOPE_LINES: { text: string; on: (d: DraftData) => boolean; otherwiseExcluded?: boolean }[] = [
  { text: "الطيران الدولي", on: (d) => d.scope.flights_intl, otherwiseExcluded: true },
  { text: "الطيران الداخلي", on: (d) => d.flights.some((f) => f.leg_order === "internal") },
  { text: "الفنادق", on: (d) => d.scope.hotels },
  { text: "الجولات السياحية", on: (d) => d.transport_plan.tours.enabled },
  { text: "الإستقبال والتوديع من المطار إلى الفندق والعكس", on: (d) => d.scope.transport },
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

/** What the room field suggests: the clear names, then the chosen hotel's own — never every hotel's. */
export function roomSuggestions(roomTypes: LookupRoomType[], hotelId: string | null | undefined): string[] {
  const own = hotelId ? roomTypes.filter((r) => r.hotel_id === hotelId).map((r) => r.name.trim()) : [];
  return [...new Set([...STANDARD_ROOMS, ...own])].filter(Boolean);
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
  const seats = carTypes.filter((c) => (c.pax ?? 0) > 0 && !SPECIAL_CAR.test(c.name)).sort((a, b) => (a.pax ?? 0) - (b.pax ?? 0));
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
