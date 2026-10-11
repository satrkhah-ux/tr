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
  emptyRoomSpec,
  FREE_DAY_TITLE,
  MEAL_PLAN_BOARD,
  newStayId,
  withRooms,
  type DraftCity,
  type DraftData,
  type DraftDay,
  type DraftHotel,
} from "./draft-types";
import { draftDaySkeleton } from "./itinerary";
import { itineraryStartDate } from "./schedule";

/**
 * A city as this screen holds it. The extra answer rides on the draft's own
 * city row (normalize passes city rows through untouched), so no column and no
 * migration: `tours` decides how many of the city's days are tour days.
 */
export type BasicCity = DraftCity & { tours?: number };

/** The day titles this screen writes — and therefore may rewrite. A title the agent typed is never touched. */
const AUTO_TITLE = /^(الوصول إلى |الانتقال إلى |جولة سياحية في |السفر إلى |المغادرة$)/;
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

/** Add a city at the end, with its hotel line. */
export function addCity(
  data: DraftData,
  city: { name: string; nights: number; tours: number },
  currency: string,
): Pick<DraftData, "cities" | "hotels"> {
  const next: BasicCity = {
    city_name: city.name,
    nights: city.nights,
    tours: Math.min(city.tours, city.nights),
    check_in: null,
    check_out: null,
  };
  const hasHotel = data.hotels.some((h) => h.city_name === city.name);
  return {
    cities: chainCities(data, [...data.cities, next]),
    hotels: hasHotel ? data.hotels : [...data.hotels, hotelForCity(data, city.name, currency)],
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

/**
 * A city's nights changed. Its rooms keep their price PER NIGHT — the agent
 * typed a nightly rate, and a 3-night total offered to a 4-night stay is the
 * mistake this screen must not make.
 */
export function setCityNights(data: DraftData, index: number, nights: number): Pick<DraftData, "cities" | "hotels"> {
  const before = data.cities[index];
  if (!before || nights < 1) return { cities: data.cities, hotels: data.hotels };
  const cities = data.cities.map((c, i) =>
    i === index ? { ...c, nights, tours: Math.min((c as BasicCity).tours ?? 0, nights) } : c,
  );
  const scale = nights / Math.max(before.nights, 1);
  const hotels = data.hotels.map((h) =>
    h.city_name !== before.city_name || h.sourcing
      ? h
      : withRooms(
          h,
          h.rooms.map((r) => (r.price == null ? r : { ...r, price: Math.round(r.price * scale * 100) / 100 })),
        ),
  );
  return { cities: chainCities(data, cities), hotels };
}

/**
 * The programme, written from the cities: the day the group lands, the days it
 * moves, its tour days in each city, free days, and the day it flies home.
 *
 * Only titles this screen wrote (or empty ones) are rewritten, so anything the
 * agent typed — here or in the full generator — survives every change.
 */
export function basicDays(data: DraftData): DraftDay[] {
  const days = draftDaySkeleton(data);
  const cities = data.cities as BasicCity[];
  const stay = days.map((d, i) => (d.kind === "travel" ? -1 : i)).filter((i) => i >= 0);
  const firstStay = stay[0] ?? -1;
  const lastDay = days.length - 1;

  let cityIndex = -1;
  let toursLeft = 0;
  return days.map((day, i) => {
    if (day.kind === "travel") return day;
    const moved = i === firstStay || days[i - 1]?.city_name !== day.city_name;
    if (moved && i !== lastDay) {
      cityIndex += 1;
      toursLeft = cities[cityIndex]?.tours ?? 0;
    }
    let title: string;
    if (i === lastDay) title = "المغادرة";
    else if (i === firstStay) title = `الوصول إلى ${day.city_name}`;
    else if (moved) title = `الانتقال إلى ${day.city_name}`;
    else if (toursLeft > 0) {
      toursLeft -= 1;
      title = `جولة سياحية في ${day.city_name}`;
    } else title = FREE_DAY_TITLE;
    return isAutoTitle(day.title) ? { ...day, title } : day;
  });
}
