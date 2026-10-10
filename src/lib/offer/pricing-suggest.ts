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

import { deriveCityDates, deriveHotelStays, pricingRefFor, type DraftData } from "./draft-types";
import { itineraryStartDate } from "./schedule";
import type { DraftPricingItem } from "./draft-types";

/** A transfer price from the reference list. */
export type TransferPrice = {
  from_city: string;
  to_city: string;
  car_type: string | null;
  price: number;
  currency: string | null;
};

/** A per-country service price from the reference list. */
export type ServicePrice = {
  service_type: string | null;
  arabic_name: string | null;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
};

/** What a room last cost here — hotel_rate_memory, plus the offer history. */
export type RoomPrice = {
  hotel_id: string | null;
  hotel_name: string;
  room_type_name: string;
  board_type: string | null;
  price: number;
  currency: string;
};

export type PricingReference = {
  transfers: TransferPrice[];
  services: ServicePrice[];
  rooms: RoomPrice[];
};

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

/**
 * The price of one leg.
 *
 * A route is matched in BOTH directions: the list holds «إسطنبول → المطار» and
 * the programme needs the way back too, and it is the same car over the same
 * road. The vehicle must match exactly — a sedan's price on a 40-seat bus is
 * not an approximation, it is a wrong number.
 */
export function findTransferPrice(
  list: TransferPrice[],
  from: string,
  to: string,
  carType: string | null,
): TransferPrice | null {
  const a = normalizeName(from);
  const b = normalizeName(to);
  const car = baseVehicle(carType);
  if (!a || !b) return null;

  const sameRoute = list.filter((row) => {
    const rf = normalizeName(row.from_city);
    const rt = normalizeName(row.to_city);
    return (rf === a && rt === b) || (rf === b && rt === a);
  });
  if (sameRoute.length === 0) return null;

  // No vehicle chosen yet: the cheapest on that road is a floor the agent can
  // see and correct, not a guess at which car they meant.
  if (!car) return sameRoute.reduce((low, row) => (row.price < low.price ? row : low));

  const exact = sameRoute.filter((row) => baseVehicle(row.car_type) === car);
  return exact.length > 0 ? exact.reduce((low, row) => (row.price < low.price ? row : low)) : null;
}

/** The agency's price for a named service in this country. */
export function findServicePrice(list: ServicePrice[], label: string): ServicePrice | null {
  const wanted = normalizeName(label);
  if (!wanted) return null;
  return (
    list.find((row) => normalizeName(row.service_type) === wanted || normalizeName(row.arabic_name) === wanted) ?? null
  );
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

    // The order of trust, most binding first.
    const [sell, buy, cur, source]: [number | null, number | null, string, PriceSource] = line.sourcing
      ? [line.sourcing.sell_base, line.sourcing.net_base, "SAR", "supplier"]
      : line.manual_price != null
        ? [line.manual_price, null, line.manual_currency || currency, "typed"]
        : remembered
          ? [remembered.price, null, remembered.currency, "remembered"]
          : [null, null, currency, "none"];

    items.push({
      item_type: "hotel",
      description: `${stay.city_name} — ${line.hotel_name || labels.hotel}`,
      ref: pricingRefFor(stay),
      // Per ROOM for the whole stay: the quantity carries the room count, and
      // the stay card asks for one room's price.
      quantity: line.rooms_count > 0 ? line.rooms_count : 1,
      buy_price: buy,
      buy_currency: cur,
      sell_price: sell,
      sell_currency: cur,
      source,
    });
  }

  for (const f of data.flights) {
    const description = `${f.airline || labels.airline} ${f.flight_no}`.trim();
    if (!description) continue;
    items.push({
      item_type: "flight",
      description,
      // A fare is per traveller, and the sheet multiplies — so the head count
      // belongs here rather than in the agent's arithmetic.
      quantity: Math.max(data.trip.adults + data.trip.children, 1),
      buy_price: null,
      buy_currency: currency,
      sell_price: null,
      sell_currency: currency,
      source: "none",
    });
  }

  for (const tr of data.transport) {
    const hit = findTransferPrice(reference.transfers, tr.from_place, tr.to_place, tr.car_type);
    items.push({
      item_type: "transport",
      description: `${tr.from_place} ← ${tr.to_place}${tr.car_type ? ` (${tr.car_type})` : ""}`,
      // «فان × 2» is two vehicles at the one-vehicle price.
      quantity: vehicleCount(tr.car_type),
      buy_price: null,
      buy_currency: hit?.currency || currency,
      sell_price: hit ? hit.price : null,
      sell_currency: hit?.currency || currency,
      source: hit ? "list" : "none",
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
      items.push({
        item_type: "service",
        description: label,
        quantity: 1,
        buy_price: hit?.buy_price ?? null,
        buy_currency: hit?.buy_currency || currency,
        sell_price: hit?.sell_price ?? null,
        sell_currency: hit?.sell_currency || currency,
        source: hit ? "list" : "none",
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
 */
export function mergeSuggestions(
  existing: DraftPricingItem[],
  suggested: SuggestedItem[],
): { items: DraftPricingItem[]; added: number; priced: number } {
  const byRef = new Set(existing.map((i) => i.ref).filter(Boolean) as string[]);
  const byText = new Set(existing.map((i) => i.description.trim()));

  const fresh = suggested.filter((s) => !(s.ref && byRef.has(s.ref)) && !byText.has(s.description.trim()));
  return {
    items: [...existing, ...fresh.map(({ source: _source, ...item }) => item)],
    added: fresh.length,
    priced: fresh.filter((s) => s.sell_price != null).length,
  };
}
