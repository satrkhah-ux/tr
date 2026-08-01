"use server";

import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
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
  deriveHotelStays,
  pricingRefFor,
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

/**
 * One hotel offered to the agent, whatever produced it.
 *
 * The internal list and a live supplier answer different questions, but the
 * agent is making ONE decision, so they arrive in one shape and render through
 * one row. Two result layouts on one screen is what made the stage feel random:
 * the columns moved depending on which tab you were on.
 */
export type HotelRateOption = {
  /** what identifies this rate to the selector — a supplier rate_key, or the hotel id. */
  key: string;
  room: string;
  board: BoardType | null;
  per_night: number;
  total: number;
  currency: string;
  /** null = we do not know (an internal hotel carries no supplier terms). */
  refundable: boolean | null;
  policy: string | null;
  /** provenance in words, e.g. «آخر عرض 2026-06-11». */
  note?: string;
  blocked?: boolean;
};

export type HotelOption = {
  /** "internal" | a supplier code. */
  source: string;
  id: string;
  name: string;
  name_en: string | null;
  stars: number | null;
  image: string | null;
  /** empty = we hold the hotel but have never priced it; the agent types one. */
  rates: HotelRateOption[];
};

/** A live rate priced for the AGENT (sell only — no net). rate_key is a staff token. */
export type SearchRate = {
  rate_key: string;
  room_name: string;
  board_type: BoardType;
  refundable: boolean;
  cancellation_policy: string;
  sell: number;
  /**
   * Sell ÷ nights. The number an agent actually compares hotels by — leaving it
   * out makes them divide in their head against a total for a different number
   * of nights, which is where the comparison goes wrong.
   */
  per_night: number;
  currency: string;
  valid_until: string | null;
  blocked: boolean;
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
      hotels: HotelOption[];
      fetched_at: string;
      check_in: string;
      check_out: string;
      nights: number;
      notes: SupplierNote[];
    }
  | { ok: false; error: TranslationKey };

/** What the agent typed into the search box, beyond the stay itself. */
export type SearchFilters = {
  hotel_name?: string | null;
};

/**
 * A hotel from OUR OWN list, with what we last charged for it.
 *
 * The hotels table holds no price — 155 hotels with a name, stars and a phone
 * number. The only honest price for one of them is the price we actually quoted
 * last time, so that is what this carries, along with when, so the agent can see
 * at a glance whether it is a figure from last month or from last winter.
 */
type LastQuote = {
  per_night: number;
  currency: string;
  board_type: BoardType | null;
  room_type_name: string | null;
  /** check-in of the offer it came from — the age of the number matters. */
  quoted_for: string | null;
};

export type InternalSearchResult =
  | { ok: true; hotels: HotelOption[] }
  | { ok: false; error: TranslationKey };

/**
 * The company's own hotels for a city, each with its most recent quoted price.
 *
 * Deliberately not a live search: these are the hotels we have contracts or a
 * history with. Sorted by "we have priced this" first, because a hotel with a
 * known price is the one an agent can actually build a package from.
 */
export async function searchInternalHotels(
  draftId: string,
  cityName: string,
  /** the stay being filled — its nights turn a per-night price into a total. */
  stayId?: string | null,
  filters?: SearchFilters,
): Promise<InternalSearchResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };

  try {
    const record = await getDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };
    // Same nights the supplier search would quote, so the two tabs' totals are
    // comparable rather than each meaning something slightly different.
    const resolved = await resolveStay(draftId, cityName, stayId);
    const nightsWanted = Math.max(1, resolved?.stay.nights ?? 1);
    const supabase = await createSupabaseServerClient();

    // Two small queries rather than getGeneratorLookups(), which runs nine —
    // this is a search box, and it re-runs every time the agent presses it.
    // The country still has to be resolved: «طرابلس» is a real city in two of
    // them, and picking the wrong one lists the wrong hotels.
    const { data: countryRows } = await supabase.from("countries").select("id, arabic_name");
    const country = findLookupCountry(
      ((countryRows ?? []) as { id: string; arabic_name: string }[]).map((c) => ({
        id: c.id,
        name: c.arabic_name,
        iso2: null,
        cities: [],
      })),
      record.data.trip.country,
    );
    if (!country) return { ok: true, hotels: [] };

    const { data: cityRows } = await supabase
      .from("cities")
      .select("id, arabic_name")
      .eq("country_id", country.id)
      .eq("arabic_name", cityName)
      .limit(1);
    const city = ((cityRows ?? []) as { id: string }[])[0];
    if (!city) return { ok: true, hotels: [] };
    const wanted = (filters?.hotel_name ?? "").trim();
    let query = supabase
      .from("hotels")
      .select("id, arabic_name, english_name, stars")
      .eq("city_id", city.id)
      .order("stars", { ascending: false });
    if (wanted) query = query.ilike("arabic_name", `%${wanted}%`);
    const { data } = await query;
    const rows = (data ?? []) as { id: string; arabic_name: string; english_name: string | null; stars: number | null }[];
    if (rows.length === 0) return { ok: true, hotels: [] };

    // The price history, newest first, for exactly these hotels. One query, not
    // one per hotel — this list runs to 155 rows in a busy city.
    const { data: priced } = await supabase
      .from("offer_hotels")
      .select("hotel_id, nights, board_type, room_type_name, sell_price, sell_currency, check_in")
      .in("hotel_id", rows.map((r) => r.id))
      .not("sell_price", "is", null)
      .order("check_in", { ascending: false, nullsFirst: false })
      .limit(400);

    const lastFor = new Map<string, LastQuote>();
    for (const h of (priced ?? []) as {
      hotel_id: string;
      nights: number | null;
      board_type: string | null;
      room_type_name: string | null;
      sell_price: number;
      sell_currency: string | null;
      check_in: string | null;
    }[]) {
      if (lastFor.has(h.hotel_id)) continue; // ordered desc — the first is the latest
      const nights = h.nights && h.nights > 0 ? h.nights : 1;
      lastFor.set(h.hotel_id, {
        // Stored per night, because the past stay's length is rarely this one's
        // — quoting its total would price a different trip.
        per_night: Math.round((Number(h.sell_price) / nights) * 100) / 100,
        currency: h.sell_currency ?? BASE,
        board_type: (h.board_type as BoardType | null) ?? null,
        room_type_name: h.room_type_name,
        quoted_for: h.check_in,
      });
    }

    const hotels: HotelOption[] = rows.map((r) => {
      const last = lastFor.get(r.id) ?? null;
      return {
        source: "internal",
        id: r.id,
        name: r.arabic_name,
        name_en: r.english_name,
        stars: r.stars,
        image: null,
        // A hotel we have never priced still belongs in the list — it just has
        // no rate to show, and the agent types one. Hiding it would make our
        // own inventory look emptier than it is.
        rates: last
          ? [
              {
                key: r.id,
                room: last.room_type_name || "—",
                board: last.board_type,
                per_night: last.per_night,
                total: last.per_night * nightsWanted,
                currency: last.currency,
                // Our own list carries no supplier terms; saying "refundable"
                // would be inventing a promise.
                refundable: null,
                policy: null,
                note: last.quoted_for ? `آخر عرض ${last.quoted_for}` : "سعر سابق",
              },
            ]
          : [],
      };
    });
    // Priced first: a hotel we have never quoted is one the agent has to price
    // from scratch, which is the slower job.
    hotels.sort(
      (a, b) => Number(b.rates.length > 0) - Number(a.rates.length > 0) || (b.stars ?? 0) - (a.stars ?? 0),
    );
    return { ok: true, hotels };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Suppliers the agent may pick between on the hotels stage. */
export type SupplierChoice = { code: string; name: string; live: boolean };

export async function listHotelSourceOptions(): Promise<SupplierChoice[]> {
  const user = await getServerUser();
  if (!user) return [];
  const suppliers = await getEnabledHotelSuppliers();
  return suppliers.map((s) => ({ code: s.code, name: s.name, live: typeof s.prebook === "function" }));
}

type Stay = { check_in: string; check_out: string; rooms: number; nights: number };

/**
 * The dates and occupancy to quote.
 *
 * Resolves ONE STAY, not one city: a city split across two hotels has two spans,
 * and searching either half against the city's full dates asks the supplier for
 * nights the guest will spend somewhere else — and prices them.
 *
 * `stayId` is optional so the older per-city callers keep working; without it
 * the city's first stay is used, which for a single-hotel city is the city.
 */
async function resolveStay(draftId: string, cityName: string, stayId?: string | null) {
  const record = await getDraft(draftId);
  if (!record) return null;
  const data = record.data;
  const cities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
  const stays = deriveHotelStays(cities, data.hotels);
  const mine = stays.filter((s) => s.city_name === cityName);
  const stay = (stayId ? mine.find((s) => s.line.id === stayId) : null) ?? mine[0] ?? null;

  const city = cities.find((c) => c.city_name === cityName);
  const check_in = stay?.check_in ?? city?.check_in ?? data.trip.arrival_date;
  const check_out = stay?.check_out ?? city?.check_out ?? data.trip.departure_date;
  const rooms = stay && stay.line.rooms_count > 0 ? stay.line.rooms_count : 1;
  const nights = stay?.nights ?? city?.nights ?? 0;
  if (!check_in || !check_out) return null;
  return { data, stay: { check_in, check_out, rooms, nights } as Stay };
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
  /** which stay in the city — its nights and dates are what gets quoted. */
  stayId?: string | null,
  filters?: SearchFilters,
): Promise<SearchResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const resolved = await resolveStay(draftId, cityName, stayId);
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
    hotel_name: filters?.hotel_name?.trim() || null,
  };

  const notes: SupplierNote[] = [];
  const hotels: HotelOption[] = [];
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
          // Computed once here rather than in every card, so the number the
          // agent compares by is the same one everywhere it appears.
          per_night: stay.nights > 0 ? Math.round((priced.line.sell / stay.nights) * 100) / 100 : priced.line.sell,
          currency: BASE,
          valid_until: rate.valid_until,
          blocked: priced.line.blocks.length > 0,
        });
      }
      if (rates.length > 0) {
        hotels.push({
          source: supplier.code,
          id: h.supplier_hotel_id,
          name: h.name_ar,
          name_en: null,
          stars: h.star_rating,
          image: h.thumbnail_url,
          // Cheapest first, so the collapsed row shows the price the hotel
          // competes on rather than whichever room the supplier listed first.
          rates: rates
            .map((r) => ({
              key: r.rate_key,
              room: r.room_name,
              board: r.board_type,
              per_night: r.per_night,
              total: r.sell,
              currency: r.currency,
              refundable: r.refundable,
              policy: r.cancellation_policy || null,
              blocked: r.blocked,
            }))
            .sort((a, b) => a.per_night - b.per_night),
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
    nights: stay.nights,
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
  /** which stay in the city receives it. Omitted = the city's first. */
  stayId?: string | null,
): Promise<SelectResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const resolved = await resolveStay(draftId, cityName, stayId);
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

  // Write onto THE chosen stay, leaving every other line — including the other
  // hotels in the same city — exactly as it was. Rebuilding the array from
  // cities (as this used to) would have collapsed a two-hotel city into one.
  const targetId =
    stayId ?? data.hotels.find((h) => h.city_name === cityName)?.id ?? null;
  const existingForCity = data.hotels.some((h) => h.city_name === cityName);
  const lines: DraftHotel[] = existingForCity
    ? data.hotels
    : [...data.hotels, normalizeDraftHotel({ city_name: cityName })];

  const hotels: DraftHotel[] = lines.map((base) => {
    const isTarget = targetId ? base.id === targetId : base.city_name === cityName;
    if (!isTarget) return base;
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

  // Keep the offer rollup in sync — ONE pricing item per stay.
  //
  // The old lookup matched the first item whose description started with the
  // city name, which with two hotels in a city overwrote the first hotel's price
  // with the second's and published a total that was missing a stay.
  const hotelName = content?.name_ar || rate.hotel_name;
  const target = hotels.find((h) => (targetId ? h.id === targetId : h.city_name === cityName));
  const ref = target ? pricingRefFor({ line: target, city_name: cityName }) : `${cityName} — ${hotelName}`;
  const item: DraftPricingItem = {
    item_type: "hotel",
    description: `${cityName} — ${hotelName}`,
    ref,
    quantity: 1,
    buy_price: line.net,
    buy_currency: BASE,
    sell_price: line.sell,
    sell_currency: BASE,
  };
  const items = [...data.pricing.items];
  const idx = items.findIndex(
    (p) =>
      p.item_type === "hotel" &&
      // by ref where there is one, else the legacy per-city description
      (p.ref ? p.ref === ref : p.description.startsWith(`${cityName} — `)),
  );
  if (idx >= 0) items[idx] = { ...items[idx], ...item };
  else items.push(item);

  await saveDraftStages(draftId, { hotels, pricing: { ...data.pricing, items, display_currency: BASE } });
  return { ok: true, blocked: sourcing.blocked };
}
