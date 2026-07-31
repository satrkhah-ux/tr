"use server";

import { getServerUser } from "@/lib/supabase/server";
import { getRates } from "./rates-actions";
import { getActiveMarkupRules } from "./markup-rules";
import { getDraft, getGeneratorLookups, saveDraftStages } from "./drafts";
import { ensureHotelContentCached } from "./hotel-content";
import { getEnabledHotelSuppliers, getSupplierAdapter } from "@/lib/providers/hotel-registry";
import type { HotelSearchQuery } from "@/lib/providers/hotel-supplier";
import { priceSupplierRate } from "@/lib/pricing/price-line";
import type { MarkupContext } from "@/lib/pricing/markup";
import {
  findLookupCountry,
  deriveCityDates,
  normalizeDraftHotel,
  withRooms,
  type DraftHotel,
  type DraftHotelSourcing,
  type DraftPricingItem,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import type { BoardType } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";

const BASE = "SAR";

/** A live rate priced for the AGENT (sell only — no net). rate_key is a staff token. */
export type SearchRate = {
  rate_key: string;
  room_name: string;
  board_type: BoardType;
  refundable: boolean;
  cancellation_policy: string;
  sell: number;
  currency: string;
  valid_until: string | null;
  blocked: boolean;
};

export type SearchHotel = {
  supplier: string;
  supplier_hotel_id: string;
  name_ar: string;
  star_rating: number | null;
  thumbnail_url: string | null;
  rates: SearchRate[];
};

/**
 * Why each supplier returned what it did.
 *
 * An empty result had exactly one appearance — «لا توجد فنادق مطابقة» — whether
 * the supplier was unreachable, the country was unresolvable, or the city
 * genuinely has no availability. Those need different actions from the agent,
 * and only one of them is about hotels.
 */
export type SupplierNote = {
  supplier: string;
  name: string;
  hotels: number;
  reason: "ok" | "no_country" | "nothing" | "error";
};

export type SearchResult =
  | {
      ok: true;
      hotels: SearchHotel[];
      fetched_at: string;
      check_in: string;
      check_out: string;
      notes: SupplierNote[];
    }
  | { ok: false; error: TranslationKey };

/** Suppliers the agent may pick between on the hotels stage. */
export type SupplierChoice = { code: string; name: string; live: boolean };

export async function listHotelSourceOptions(): Promise<SupplierChoice[]> {
  const user = await getServerUser();
  if (!user) return [];
  const suppliers = await getEnabledHotelSuppliers();
  return suppliers.map((s) => ({ code: s.code, name: s.name, live: typeof s.prebook === "function" }));
}

type Stay = { check_in: string; check_out: string; rooms: number };

async function resolveStay(draftId: string, cityName: string) {
  const record = await getDraft(draftId);
  if (!record) return null;
  const data = record.data;
  const cities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
  const city = cities.find((c) => c.city_name === cityName);
  const check_in = city?.check_in ?? data.trip.arrival_date;
  const check_out = city?.check_out ?? data.trip.departure_date;
  const hotel = data.hotels.find((h) => h.city_name === cityName);
  const rooms = hotel && hotel.rooms_count > 0 ? hotel.rooms_count : 1;
  if (!check_in || !check_out) return null;
  return { data, stay: { check_in, check_out, rooms } as Stay };
}

function contextFor(country: string | null, city: string, supplierId: string, date: string | null): MarkupContext {
  return { country: country || null, city, supplier_id: supplierId, stars: null, date, customer_type: "individual" };
}

/**
 * Search the ENABLED suppliers for a city + the schedule-derived dates + occupancy.
 * Returns hotels with a thumbnail + LIVE rates priced to the client SELL (net is
 * NEVER sent to the browser). Rates are always fresh — nothing here is cached.
 */
export async function searchHotelsForCity(
  draftId: string,
  cityName: string,
  /** search ONE supplier. Omitted = every enabled one, as before. */
  supplierCode?: string,
): Promise<SearchResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const resolved = await resolveStay(draftId, cityName);
  if (!resolved) return { ok: false, error: "pg.supplier.noDates" };
  const { data, stay } = resolved;

  const [{ sarPer }, rules, all] = await Promise.all([getRates(), getActiveMarkupRules(), getEnabledHotelSuppliers()]);
  const suppliers = supplierCode ? all.filter((s) => s.code === supplierCode) : all;
  const fxDate = new Date().toISOString().slice(0, 10);

  // THE field this call used to omit. A real supplier resolves a city inside a
  // country, so TBO returned an empty list for every search from this screen —
  // which read as "no hotels in Baku" rather than "we never told it which Baku".
  const countryCode = await resolveCountryCode(data.trip.country);

  const query: HotelSearchQuery = {
    city: cityName,
    check_in: stay.check_in,
    check_out: stay.check_out,
    adults: data.trip.adults,
    children: data.trip.children,
    rooms: stay.rooms,
    country_code: countryCode,
    // Hotel net rates are nationality-dependent (resident vs GCC vs other), so
    // the wrong one quotes a price the supplier will not honour.
    nationality: "SA",
  };

  const notes: SupplierNote[] = [];
  const hotels: SearchHotel[] = [];
  for (const supplier of suppliers) {
    const before = hotels.length;
    // A supplier that needs a country and has none cannot be asked; say that
    // rather than showing an empty list it did not produce.
    if (!countryCode && supplier.code !== "mock") {
      notes.push({ supplier: supplier.code, name: supplier.name, hotels: 0, reason: "no_country" });
      continue;
    }
    let results;
    try {
      results = await supplier.searchHotels(query);
    } catch {
      notes.push({ supplier: supplier.code, name: supplier.name, hotels: 0, reason: "error" });
      continue;
    }
    for (const h of results) {
      const rates: SearchRate[] = [];
      for (const rate of h.rates) {
        const ctx = contextFor(data.trip.country, cityName, rate.supplier_id, data.trip.arrival_date);
        const priced = priceSupplierRate(rate, rules, ctx, sarPer, BASE, fxDate);
        if (!priced.ok) continue; // can't price (no fx / no rule) — omit rather than mislead
        rates.push({
          rate_key: rate.rate_key,
          room_name: rate.room_category_raw,
          board_type: rate.board_type,
          refundable: rate.refundable,
          cancellation_policy: rate.cancellation_policy,
          sell: priced.line.sell,
          currency: BASE,
          valid_until: rate.valid_until,
          blocked: priced.line.blocks.length > 0,
        });
      }
      if (rates.length > 0) {
        hotels.push({
          supplier: supplier.code,
          supplier_hotel_id: h.supplier_hotel_id,
          name_ar: h.name_ar,
          star_rating: h.star_rating,
          thumbnail_url: h.thumbnail_url,
          rates,
        });
      }
    }
    notes.push({
      supplier: supplier.code,
      name: supplier.name,
      hotels: hotels.length - before,
      reason: hotels.length > before ? "ok" : "nothing",
    });
  }

  return {
    ok: true,
    hotels,
    fetched_at: new Date().toISOString(),
    check_in: stay.check_in,
    check_out: stay.check_out,
    notes,
  };
}

/**
 * The draft's country name → ISO-2.
 *
 * `trip.country` is free text an agent typed, and the countries table holds one
 * canonical spelling with the code — so this reuses `findLookupCountry`'s
 * spelling tolerance («إندونيسيا» vs «اندونيسيا») rather than adding a second,
 * stricter matcher that would fail on the same data.
 */
async function resolveCountryCode(countryName: string): Promise<string | null> {
  if (!countryName?.trim()) return null;
  try {
    const { countries } = await getGeneratorLookups();
    const hit = findLookupCountry(countries, countryName.trim());
    return hit?.iso2?.trim().toUpperCase() || null;
  } catch {
    return null;
  }
}

export type SelectResult = { ok: true; blocked: boolean } | { ok: false; error: TranslationKey };

/**
 * Select a specific rate for a city's hotel line. This is the auto-save:
 *  1) cache the hotel's STATIC content ONCE (image/facilities/stars),
 *  2) RE-FETCH the exact rate fresh (refuse if it expired),
 *  3) price it (markup + floor), and persist the chosen rate onto the draft hotel.
 */
export async function selectHotelRate(
  draftId: string,
  cityName: string,
  supplierCode: string,
  supplierHotelId: string,
  rateKey: string,
): Promise<SelectResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const resolved = await resolveStay(draftId, cityName);
  if (!resolved) return { ok: false, error: "pg.supplier.noDates" };
  const { data, stay } = resolved;

  const adapter = await getSupplierAdapter(supplierCode);
  if (!adapter) return { ok: false, error: "pg.supplier.noRates" };

  // (2) re-fetch the LIVE rate fresh — never trust a possibly-expired list
  let freshRates;
  try {
    freshRates = await adapter.searchRates({
      city: cityName,
      check_in: stay.check_in,
      check_out: stay.check_out,
      adults: data.trip.adults,
      children: data.trip.children,
      rooms: stay.rooms,
      supplier_hotel_id: supplierHotelId,
      // Same omission as the search had: without these the re-fetch comes back
      // empty and the agent is told the rate expired, seconds after seeing it.
      country_code: await resolveCountryCode(data.trip.country),
      nationality: "SA",
    });
  } catch {
    return { ok: false, error: "pg.supplier.rateExpired" };
  }
  const rate = freshRates.find((r) => r.rate_key === rateKey);
  if (!rate) return { ok: false, error: "pg.supplier.rateExpired" };
  // never accept a rate whose validity has already lapsed (even if still listed)
  const today = new Date().toISOString().slice(0, 10);
  if (rate.valid_until && rate.valid_until < today) return { ok: false, error: "pg.supplier.rateExpired" };

  // (1) cache STATIC content once
  const content = await ensureHotelContentCached(supplierCode, supplierHotelId);

  // (3) price + floor
  const [{ sarPer }, rules] = await Promise.all([getRates(), getActiveMarkupRules()]);
  const fxDate = new Date().toISOString().slice(0, 10);
  const ctx = contextFor(data.trip.country, cityName, rate.supplier_id, data.trip.arrival_date);
  const priced = priceSupplierRate(rate, rules, ctx, sarPer, BASE, fxDate);
  if (!priced.ok) return { ok: false, error: "pg.supplier.noRates" };
  const line = priced.line;

  const sourcing: DraftHotelSourcing = {
    supplier_id: line.supplier_id,
    supplier_name: line.supplier_name,
    rate_key: line.rate_key,
    net_base: line.net,
    net_source_currency: line.net_source_currency,
    fx_rate: line.fx_rate,
    fx_date: line.fx_date,
    ref_sell_base: line.ref_sell_base,
    sell_base: line.sell,
    markup_amount: line.markup_amount,
    markup_pct: line.markup_pct,
    margin_pct: line.margin_pct,
    min_margin_pct: line.rule_min_margin_pct,
    cancellation_policy: line.cancellation_policy,
    excluded_surcharges: line.excluded_surcharges.map((s) => ({ name: s.name, amount: s.amount, currency: s.currency })),
    valid_until: line.valid_until,
    room_category: line.room_category,
    room_name: rate.room_category_raw,
    refundable: line.refundable,
    blocked: line.blocks.length > 0,
    image_url: content?.image_url ?? null,
    facilities: content?.facilities ?? [],
    star_rating: content?.star_rating ?? null,
    supplier_hotel_id: supplierHotelId,
    rate_fetched_at: new Date().toISOString(),
  };

  // set the chosen hotel on the city's line (rebuild from cities like the stage does)
  const hotels: DraftHotel[] = data.cities.map((c) => {
    const existing = data.hotels.find((h) => h.city_name === c.city_name);
    const base: DraftHotel = existing ?? normalizeDraftHotel({ city_name: c.city_name });
    if (c.city_name !== cityName) return base;
    // The supplier rate describes ONE room product; every room on this line
    // becomes that product (withRooms keeps rooms_count and the mirrors in step).
    return withRooms(
      {
        ...base,
        hotel_id: null, // supplier hotel — not an internal mapping
        hotel_name: content?.name_ar || base.hotel_name || rate.hotel_name,
        // the content cache carries no Latin name; whatever the agent typed stays
        sourcing,
      },
      base.rooms.map(() => ({
        room_type_id: null,
        room_type_name: rate.room_category_raw,
        board_type: rate.board_type,
      })),
    );
  });

  // keep the offer rollup in sync (one hotel pricing item per line)
  const desc = `${cityName} — ${content?.name_ar || rate.hotel_name}`;
  const item: DraftPricingItem = {
    item_type: "hotel",
    description: desc,
    quantity: 1,
    buy_price: line.net,
    buy_currency: BASE,
    sell_price: line.sell,
    sell_currency: BASE,
  };
  const items = [...data.pricing.items];
  const idx = items.findIndex((p) => p.item_type === "hotel" && p.description.startsWith(`${cityName} — `));
  if (idx >= 0) items[idx] = item;
  else items.push(item);

  await saveDraftStages(draftId, { hotels, pricing: { ...data.pricing, items, display_currency: BASE } });
  return { ok: true, blocked: sourcing.blocked };
}
