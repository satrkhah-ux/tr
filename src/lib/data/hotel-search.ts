"use server";

import { getServerUser } from "@/lib/supabase/server";
import { getRates } from "./rates-actions";
import { getActiveMarkupRules } from "./markup-rules";
import { getDraft, saveDraftStages } from "./drafts";
import { ensureHotelContentCached } from "./hotel-content";
import { getEnabledHotelSuppliers, getSupplierAdapter } from "@/lib/providers/hotel-registry";
import type { HotelSearchQuery } from "@/lib/providers/hotel-supplier";
import { priceSupplierRate } from "@/lib/pricing/price-line";
import type { MarkupContext } from "@/lib/pricing/markup";
import { deriveCityDates, type DraftHotel, type DraftHotelSourcing, type DraftPricingItem } from "@/lib/offer/draft-types";
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

export type SearchResult =
  | { ok: true; hotels: SearchHotel[]; fetched_at: string; check_in: string; check_out: string }
  | { ok: false; error: TranslationKey };

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
export async function searchHotelsForCity(draftId: string, cityName: string): Promise<SearchResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const resolved = await resolveStay(draftId, cityName);
  if (!resolved) return { ok: false, error: "pg.supplier.noDates" };
  const { data, stay } = resolved;

  const [{ sarPer }, rules, suppliers] = await Promise.all([getRates(), getActiveMarkupRules(), getEnabledHotelSuppliers()]);
  const fxDate = new Date().toISOString().slice(0, 10);
  const query: HotelSearchQuery = {
    city: cityName,
    check_in: stay.check_in,
    check_out: stay.check_out,
    adults: data.trip.adults,
    children: data.trip.children,
    rooms: stay.rooms,
  };

  const hotels: SearchHotel[] = [];
  for (const supplier of suppliers) {
    let results;
    try {
      results = await supplier.searchHotels(query);
    } catch {
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
  }

  return { ok: true, hotels, fetched_at: new Date().toISOString(), check_in: stay.check_in, check_out: stay.check_out };
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
    const base: DraftHotel = existing ?? {
      city_name: c.city_name,
      hotel_id: null,
      hotel_name: "",
      room_type_id: null,
      room_type_name: "",
      board_type: null,
      rooms_count: 1,
    };
    if (c.city_name !== cityName) return base;
    return {
      ...base,
      hotel_id: null, // supplier hotel — not an internal mapping
      hotel_name: content?.name_ar || base.hotel_name || rate.hotel_name,
      room_type_id: null,
      room_type_name: rate.room_category_raw,
      board_type: rate.board_type,
      sourcing,
    };
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
