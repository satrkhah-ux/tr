"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import {
  deriveCityDates,
  emptyDraftData,
  normalizeDraftData,
  type DraftData,
  type GeneratorLookups,
  type ReusableProgram,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { validateDraft } from "@/lib/offer/draft-validation";
import { createOffer, publishOffer, type OfferHotelInput, type OfferPricingItemInput } from "./offers";

/**
 * Package-generator drafts. One row per draft; each stage page auto-saves its
 * slice through saveDraftStages (shallow top-level merge → concurrent stages
 * never clobber each other). Drafts are internal-only (may carry buy pricing).
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

// ---------- CRUD ----------
export type DraftSummary = {
  id: string;
  title: string | null;
  destination: string | null;
  customer_name: string | null;
  produced_serial: string | null;
  updated_at: string;
};

export async function listDrafts(): Promise<DraftSummary[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("offer_drafts")
      .select("id, title, data, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    return ((data ?? []) as { id: string; title: string | null; data: Record<string, unknown>; updated_at: string }[]).map(
      (row) => {
        const draft = normalizeDraftData(row.data);
        return {
          id: row.id,
          title: row.title,
          destination: draft.trip.destination || draft.trip.country || null,
          customer_name: draft.customer.customer_name || null,
          produced_serial: draft.produced_serial,
          updated_at: row.updated_at,
        };
      },
    );
  } catch {
    return [];
  }
}

export type CreateDraftResult = { ok: true; id: string } | { ok: false; error: TranslationKey };

export async function createDraft(): Promise<CreateDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { data, error } = await supabase
      .from("offer_drafts")
      .insert({ data: emptyDraftData() as unknown as Record<string, unknown> })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type DraftRecord = { id: string; data: DraftData; updated_at: string };

export async function getDraft(draftId: string): Promise<DraftRecord | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("offer_drafts")
      .select("id, data, updated_at")
      .eq("id", draftId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: string; data: Record<string, unknown>; updated_at: string };
    return { id: row.id, data: normalizeDraftData(row.data), updated_at: row.updated_at };
  } catch {
    return null;
  }
}

export type SaveDraftResult = { ok: boolean; error?: TranslationKey };

/** Merge one or more stage slices into the draft (shallow, top-level keys). */
export async function saveDraftStages(draftId: string, slices: Partial<DraftData>): Promise<SaveDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { data: existing } = await supabase.from("offer_drafts").select("data").eq("id", draftId).maybeSingle();
    if (!existing) return { ok: false, error: "err.loadFailed" };
    const current = normalizeDraftData((existing as { data: Record<string, unknown> }).data);
    const merged: DraftData = { ...current, ...slices };
    const title = merged.customer.customer_name || merged.trip.destination || merged.trip.country || null;
    const { error } = await supabase
      .from("offer_drafts")
      .update({ data: merged as unknown as Record<string, unknown>, title, updated_at: new Date().toISOString() })
      .eq("id", draftId);
    if (error) return { ok: false, error: "err.updateFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function deleteDraft(draftId: string): Promise<SaveDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { error } = await supabase.from("offer_drafts").delete().eq("id", draftId);
    if (error) return { ok: false, error: "err.deleteFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- lookups for the stage forms ----------
export async function getGeneratorLookups(): Promise<GeneratorLookups> {
  const empty: GeneratorLookups = { countries: [], roomTypes: [], airports: [], carTypes: [] };
  try {
    const supabase = await db();
    const [countriesRes, citiesRes, hotelsRes, roomTypesRes, airportsRes, transfersRes, transportRes] = await Promise.all([
      supabase.from("countries").select("id, arabic_name, status").order("arabic_name"),
      supabase.from("cities").select("id, arabic_name, country_id").order("arabic_name"),
      supabase.from("hotels").select("id, arabic_name, stars, city_id"),
      supabase.from("room_types").select("id, arabic_name, hotel_id, default_board").order("arabic_name"),
      supabase.from("airports").select("id, arabic_name, code, iana_timezone, status").order("code"),
      supabase.from("transfers").select("car_type"),
      supabase.from("transportation_types").select("arabic_name, status").order("arabic_name"),
    ]);

    // a reference row is offered to the generator unless the admin disabled it
    const active = (status: string | null | undefined) => status !== "Disabled";
    const hotels = (hotelsRes.data ?? []) as { id: string; arabic_name: string; stars: number | null; city_id: string | null }[];
    const cities = (citiesRes.data ?? []) as { id: string; arabic_name: string; country_id: string | null }[];
    const countries = ((countriesRes.data ?? []) as { id: string; arabic_name: string; status: string | null }[]).filter((c) => active(c.status));

    const builtCountries = countries.map((country) => ({
      id: country.id,
      name: country.arabic_name,
      cities: cities
        .filter((c) => c.country_id === country.id)
        .map((c) => ({
          id: c.id,
          name: c.arabic_name,
          hotels: hotels
            .filter((h) => h.city_id === c.id)
            .map((h) => ({ id: h.id, name: h.arabic_name, stars: h.stars })),
        })),
    }));

    // transport options: the admin-managed transportation types + any ad-hoc
    // car types used on transfers (both feed the transport stage's datalist).
    const carTypes = [
      ...new Set([
        ...((transportRes.data ?? []) as { arabic_name: string; status: string | null }[])
          .filter((t) => active(t.status))
          .map((t) => t.arabic_name),
        ...((transfersRes.data ?? []) as { car_type: string | null }[]).map((r) => r.car_type),
      ].filter((v): v is string => Boolean(v && v.trim()))),
    ];

    return {
      countries: builtCountries,
      roomTypes: ((roomTypesRes.data ?? []) as { id: string; arabic_name: string; hotel_id: string | null; default_board: GeneratorLookups["roomTypes"][number]["default_board"] }[]).map(
        (r) => ({ id: r.id, name: r.arabic_name, hotel_id: r.hotel_id, default_board: r.default_board }),
      ),
      airports: ((airportsRes.data ?? []) as { id: string; arabic_name: string; code: string | null; iana_timezone: string | null; status: string | null }[])
        .filter((a) => active(a.status))
        .map((a) => ({ id: a.id, name: a.arabic_name, code: a.code, timezone: a.iana_timezone })),
      carTypes,
    };
  } catch {
    return empty;
  }
}

// ---------- reuse a previous program ----------
function daysFromDuration(duration: string | null): number | null {
  if (!duration) return null;
  const match = duration.match(/(\d+)\s*(?:أيام|يوم|days?)/i);
  return match ? Number(match[1]) : null;
}

/** Programs matching the draft's country + day count; exact traveler matches first. */
export async function findReusablePrograms(draftId: string): Promise<ReusableProgram[]> {
  try {
    const record = await getDraft(draftId);
    if (!record) return [];
    const { country, days, adults } = { country: record.data.trip.country, days: record.data.trip.days, adults: record.data.trip.adults };
    if (!country.trim() || days <= 0) return [];

    const supabase = await db();
    const { data: offers } = await supabase
      .from("offers")
      .select("id, serial, destination, duration, adults")
      .eq("destination", country)
      .order("created_at", { ascending: false })
      .limit(30);

    const rows = (offers ?? []) as { id: string; serial: string; destination: string | null; duration: string | null; adults: number }[];
    const withDays = rows
      .map((r) => ({ ...r, days: daysFromDuration(r.duration) }))
      .filter((r) => r.days === days);
    if (withDays.length === 0) return [];

    const { data: cityRows } = await supabase
      .from("offer_cities")
      .select("offer_id, city_name, sort")
      .in("offer_id", withDays.map((r) => r.id))
      .order("sort");
    const citiesByOffer = new Map<string, string[]>();
    for (const row of (cityRows ?? []) as { offer_id: string; city_name: string }[]) {
      const list = citiesByOffer.get(row.offer_id) ?? [];
      list.push(row.city_name);
      citiesByOffer.set(row.offer_id, list);
    }

    return withDays
      .map((r) => ({
        serial: r.serial,
        destination: r.destination,
        duration: r.duration,
        adults: r.adults,
        days: r.days,
        cities: citiesByOffer.get(r.id) ?? [],
        samePeople: r.adults === adults,
      }))
      .sort((a, b) => Number(b.samePeople) - Number(a.samePeople));
  } catch {
    return [];
  }
}

/** Copy a previous program's cities/hotels/services/terms into the draft. */
export async function copyProgramIntoDraft(draftId: string, serial: string): Promise<SaveDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const record = await getDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };

    const supabase = await db();
    const { data: offer } = await supabase.from("offers").select("id").eq("serial", serial).maybeSingle();
    if (!offer) return { ok: false, error: "err.loadFailed" };
    const offerId = (offer as { id: string }).id;

    const [citiesRes, servicesRes, termsRes] = await Promise.all([
      supabase.from("offer_cities").select("city_name, hotel_name, room_type, nights").eq("offer_id", offerId).order("sort"),
      supabase.from("offer_services").select("label, kind").eq("offer_id", offerId).order("sort"),
      supabase.from("offer_terms").select("text").eq("offer_id", offerId).order("sort"),
    ]);

    const cityRows = (citiesRes.data ?? []) as { city_name: string; hotel_name: string | null; room_type: string | null; nights: number | null }[];
    const serviceRows = (servicesRes.data ?? []) as { label: string; kind: string }[];
    const termRows = (termsRes.data ?? []) as { text: string }[];

    const cities = deriveCityDates(
      itineraryStartDate(record.data.trip, record.data.flights),
      cityRows.map((c) => ({ city_name: c.city_name, nights: c.nights ?? 1, check_in: null, check_out: null })),
    );
    const hotels = cityRows.map((c) => ({
      city_name: c.city_name,
      hotel_id: null,
      hotel_name: c.hotel_name ?? "",
      room_type_id: null,
      room_type_name: c.room_type ?? "",
      board_type: null,
      rooms_count: 1,
    }));

    return saveDraftStages(draftId, {
      cities,
      hotels,
      services: {
        includes: serviceRows.filter((s) => s.kind === "include").map((s) => s.label),
        excludes: serviceRows.filter((s) => s.kind === "exclude").map((s) => s.label),
        terms: termRows.map((t) => t.text),
      },
    });
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- produce the real offer ----------
export type ProduceResult = { ok: true; serial: string } | { ok: false; error: TranslationKey };

/** Validate → map the draft onto CreateOfferInput → create the real offer. */
export async function produceOfferFromDraft(draftId: string): Promise<ProduceResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const record = await getDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };
    const data = record.data;

    const validation = validateDraft(data);
    if (!validation.ok) return { ok: false, error: "pg.err.blockingLeft" };

    // PreBook re-validation: a supplier rate must still be valid at CONFIRM time.
    // Never freeze/publish a rate whose validity has lapsed since selection.
    const today = new Date().toISOString().slice(0, 10);
    if (data.hotels.some((h) => h.sourcing?.valid_until && h.sourcing.valid_until < today)) {
      return { ok: false, error: "pg.supplier.rateExpired" };
    }

    const cities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
    const hotelByCity = new Map(data.hotels.map((h) => [h.city_name, h]));
    const boardLabel: Record<string, string> = { RO: "غرفة فقط", BB: "شامل الإفطار", HB: "نصف إقامة", FB: "إقامة كاملة", AI: "شامل كليًا" };

    const hotels: OfferHotelInput[] = cities.flatMap((c) => {
      const h = hotelByCity.get(c.city_name);
      if (!h) return [];
      const s = h.sourcing;
      return [{
        hotel_id: h.hotel_id,
        hotel_name: h.hotel_name || null,
        room_type_id: h.room_type_id,
        rooms_count: h.rooms_count,
        board_type: h.board_type,
        check_in: c.check_in,
        check_out: c.check_out,
        nights: c.nights,
        // a supplier-priced line carries its net (buy) + sell in base currency;
        // manually-priced lines keep money only in the pricing items.
        buy_price: s ? s.net_base : null,
        buy_currency: s ? "SAR" : null,
        sell_price: s ? s.sell_base : null,
        sell_currency: s ? "SAR" : null,
        // supplier sourcing → frozen into the render snapshot (offer_renders)
        cancellation_policy: s?.cancellation_policy ?? null,
        excluded_surcharges: s?.excluded_surcharges ?? [],
        valid_until: s?.valid_until ?? null,
        supplier_id: s?.supplier_id ?? null,
        supplier_name: s?.supplier_name ?? null,
        rate_key: s?.rate_key ?? null,
        net_base: s?.net_base ?? null,
        net_source_currency: s?.net_source_currency ?? null,
        fx_rate: s?.fx_rate ?? null,
        fx_date: s?.fx_date ?? null,
        ref_sell_base: s?.ref_sell_base ?? null,
        markup_amount: s?.markup_amount ?? null,
        markup_pct: s?.markup_pct ?? null,
        image_url: s?.image_url ?? null,
        facilities: s?.facilities ?? [],
        content_star_rating: s?.star_rating ?? null,
        room_type_name: s?.room_name ?? h.room_type_name ?? null,
      }];
    });

    // Reconcile pricing items against the CURRENT hotels: drop stale hotel items
    // whose city/hotel no longer exists, so a removed hotel's (possibly below-floor)
    // price can never publish as a phantom line in the offer total.
    const validHotelDescs = new Set(
      cities.flatMap((c) => {
        const h = hotelByCity.get(c.city_name);
        return h ? [`${c.city_name} — ${h.hotel_name}`] : [];
      }),
    );
    const reconciledItems = data.pricing.items.filter(
      (it) => it.item_type !== "hotel" || validHotelDescs.has(it.description ?? ""),
    );

    const pricing_items: OfferPricingItemInput[] = reconciledItems.map((item) => ({
      item_type: item.item_type,
      description: item.description || null,
      quantity: item.quantity,
      buy_price: item.buy_price,
      buy_currency: item.buy_currency || null,
      sell_price: item.sell_price,
      sell_currency: item.sell_currency || null,
    }));

    const sellTotal =
      data.pricing.final_total ??
      (reconciledItems.length > 0
        ? Number(
            reconciledItems
              .reduce((sum, item) => sum + (item.sell_price ?? 0) * (item.quantity > 0 ? item.quantity : 1), 0)
              .toFixed(2),
          )
        : null);
    const buyTotal =
      reconciledItems.length > 0
        ? Number(
            reconciledItems
              .reduce((sum, item) => sum + (item.buy_price ?? 0) * (item.quantity > 0 ? item.quantity : 1), 0)
              .toFixed(2),
          )
        : null;

    const transportIncludes = data.transport.map((t) =>
      `التوصيلات: ${t.from_place} ← ${t.to_place}${t.car_type ? ` (${t.car_type})` : ""}`,
    );
    const visaIncludes = data.visas.map((v) => `تأشيرة ${v.country || v.visa_type} × ${v.count}`);

    const result = await createOffer({
      customer_id: null,
      employee_id: null,
      destination: data.trip.destination || data.trip.country,
      duration: `${data.trip.days} أيام / ${data.trip.nights} ليالي`,
      offer_date: data.trip.arrival_date,
      adults: data.trip.adults,
      children: data.trip.children,
      infants: data.trip.infants,
      total: sellTotal,
      buy_total: buyTotal,
      currency: data.pricing.display_currency,
      cities: cities.map((c) => {
        const h = hotelByCity.get(c.city_name);
        return {
          city_name: c.city_name,
          hotel_name: h?.hotel_name || null,
          room_type: h?.room_type_name || null,
          nights: c.nights,
          check_in: c.check_in,
          check_out: c.check_out,
          meals: h?.board_type ? (boardLabel[h.board_type] ?? null) : null,
        };
      }),
      flights: data.flights.map((f) => ({
        carrier: f.airline || null,
        from_airport: f.from_airport || null,
        to_airport: f.to_airport || null,
        flight_date: f.departure_at ? f.departure_at.slice(0, 10) : null,
        passengers: data.trip.adults + data.trip.children,
        baggage: f.baggage_allowance || null,
        airline: f.airline || null,
        flight_no: f.flight_no || null,
        departure_at: f.departure_at,
        arrival_at: f.arrival_at,
        cabin_class: f.cabin_class || null,
        baggage_allowance: f.baggage_allowance || null,
        leg_order: f.leg_order,
      })),
      services: [
        ...data.services.includes.map((label) => ({ label, kind: "include" as const })),
        ...transportIncludes.map((label) => ({ label, kind: "include" as const })),
        ...visaIncludes.map((label) => ({ label, kind: "include" as const })),
        ...data.services.excludes.map((label) => ({ label, kind: "exclude" as const })),
      ],
      terms: data.services.terms,
      hotels,
      pricing_items,
    });

    if (!result.ok) return { ok: false, error: result.error };
    await saveDraftStages(draftId, { produced_serial: result.serial });
    // Producing an offer IS sending it: publish v1 (freeze client snapshot +
    // status draft→sent) so the client link + PDF work immediately.
    await publishOffer(result.serial);
    return { ok: true, serial: result.serial };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
