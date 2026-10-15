"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { airlineLogoUrl, publicBrandLogoUrl } from "@/components/offer-doc/brand";
import { BOARD_AR } from "@/components/offer-doc/labels";
import { getPartnerSession, isStaffSession } from "@/lib/partners/session";
import { issuedPartnerSheet, keepOurStays, keepTheirPrices, partnerPrice, partnerStays, priceForViewer } from "@/lib/partners/pricing";
import { partnerCaller, viewerTerms } from "@/lib/partners/price-view";
import {
  baggageLabel,
  defaultServicesFromLibrary,
  deriveCityDates,
  deriveHotelStays,
  emptyDraftData,
  roomTypesText,
  emptyTermLibrary,
  findLookupCountry,
  libraryForCountry,
  mealPlanIncludeLine,
  MEAL_PLAN_AR,
  MEAL_PLAN_BOARD,
  pricingRefFor,
  matchPartner,
  normalizeDraftData,
  normalizeDraftHotel,
  type DraftData,
  type GeneratorLookups,
  type LookupHotel,
  type ReusableProgram,
  type TermLibrary,
  type TermLibraryItem,
  stayCancellation,
} from "@/lib/offer/draft-types";
import { getEnabledHotelSuppliers } from "@/lib/providers/hotel-registry";
import { draftSellTotal } from "@/lib/offer/preview-dto";
import { applyManualProfit, offerTotals, rebase, type PricingLineInput } from "@/lib/offer/pricing";
import { getProfitSettings } from "./app-settings";
import { packageProfitFor, withPackageProfit, withScopeLines } from "@/lib/offer/basic";
import { advancedDayNote, advancedLines } from "@/lib/offer/advanced";
import { getRates } from "./rates-actions";
import { suggestPricingFor } from "./pricing-suggest-core";
import { customerFor } from "./customer-row";
import { sendOfferToClient, type ClientSendResult } from "./client-whatsapp";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { byUsage } from "@/lib/offer/country-priority";
import { attachWeather, weatherMissing } from "@/lib/offer/weather-attach";
import { itineraryStartDate } from "@/lib/offer/schedule";
import { draftDaySkeleton, transportNoteForDay } from "@/lib/offer/itinerary";
import { validateDraft } from "@/lib/offer/draft-validation";
import { getPublishedClientOffer, publishOffer, type CreateOfferInput, type OfferHotelInput, type OfferPricingItemInput } from "./offers";
import { insertOffer, replaceOffer } from "./offer-insert";
import { reissueLocked } from "./issued-draft";
import { logAudit } from "./audit";
import { offerChanges, type OfferChange } from "@/lib/offer/version-diff";
import { typedAsCost, keepDraftCost, redactDraftCost } from "@/lib/offer/draft-cost";
import {
  deleteDraftRow,
  insertDraft,
  listDraftRows,
  loadDraft,
  writeDraftStages,
  type DraftRecord,
  type InsertDraftResult,
  type SaveDraftResult,
} from "./draft-store";
import { checkHotelIssueGuard } from "./quality-actions";

/**
 * Package-generator drafts. One row per draft; each stage page auto-saves its
 * slice through saveDraftStages (shallow top-level merge → concurrent stages
 * never clobber each other). Drafts carry buy pricing, so the rows themselves
 * are reached only through draft-store.ts (offers.write, or a partner's own
 * company), and the cost leaves here only for pricing.internal.
 */

/** The user client — reference lookups and offers only, never `offer_drafts`. */
async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

// ---------- CRUD ----------
export type DraftSummary = {
  id: string;
  title: string | null;
  destination: string | null;
  customer_name: string | null;
  /** the partner company this draft is being built for, if any. */
  company: string | null;
  adults: number;
  children: number;
  infants: number;
  /** every traveller on the file — the column «المسافرون». */
  travelers: number;
  days: number;
  nights: number;
  /** the trip's own start date, not the row's timestamp. */
  travel_date: string | null;
  total: number | null;
  currency: string;
  /** the issued programme's number, e.g. AD-6-3427-20260729. */
  produced_serial: string | null;
  updated_at: string;
  created_at: string;
  /** the employee who started the file, and their name (null: unknown or a partner's). */
  created_by: string | null;
  created_by_name: string | null;
  country: string | null;
  /** what the file covers — the scope switches that are on */
  services: ("hotels" | "flights_intl" | "flights_domestic" | "transport" | "visas")[];
};

export async function listDrafts(): Promise<DraftSummary[]> {
  const { sarPer } = await getRates();
  try {
    return (await listDraftRows()).map(
      (row) => {
        const draft = normalizeDraftData(row.data);
        return {
          id: row.id,
          title: row.title,
          destination: draft.trip.destination || draft.trip.country || null,
          customer_name: draft.customer.customer_name || null,
          company: draft.customer.company || null,
          adults: draft.trip.adults,
          children: draft.trip.children,
          infants: draft.trip.infants,
          travelers: draft.trip.adults + draft.trip.children + draft.trip.infants,
          days: draft.trip.days,
          nights: draft.trip.nights,
          travel_date: draft.trip.arrival_date || null,
          total: draftSellTotal(draft, sarPer),
          currency: draft.pricing.display_currency,
          produced_serial: draft.produced_serial,
          updated_at: row.updated_at,
          created_at: row.created_at,
          created_by: row.created_by,
          created_by_name: row.maker?.arabic_name ?? null,
          country: draft.trip.country || null,
          services: (["hotels", "flights_intl", "flights_domestic", "transport", "visas"] as const).filter((k) => draft.scope[k]),
        };
      },
    );
  } catch {
    return [];
  }
}

export type CreateDraftResult = InsertDraftResult;

/**
 * `seed` pre-fills slices of the new draft — used by «العروض الجاهزة» to pour a
 * company package in. It is merged through normalizeDraftData, so a partial or
 * stale seed can never produce a malformed draft.
 */
export async function createDraft(seed?: Partial<DraftData>): Promise<CreateDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    // A new draft opens with the company's approved default wording (the rows
    // ticked in /offers/offer-includes, /offers/offer-not-includes and
    // /offers/terms-and-conditions). A seed that brings its own services — a
    // ready-made package — wins, since those were written for that package.
    // Global lines only: a new draft has no country yet, and choosing one in
    // TripStage adds that country's lines (reseedForCountry).
    const base = emptyDraftData();
    // a NEW file starts «مع الإفطار» (the owner, 2026-10-15) — here, not in emptyDraftData,
    // whose defaults also fill old drafts and would turn a «غرفة فقط» file into breakfast
    base.trip = { ...base.trip, meal_plan: "breakfast", default_board: "BB" };
    if (!seed?.services) {
      // Only the terms are needed here. Calling getGeneratorLookups() for them
      // fetched every hotel, room type, airport and the FX feed — ~4 s on the
      // «إصدار بكج جديد» button — and the stage page loads all of that again.
      const supabase = await db();
      const { data: terms } = await supabase
        .from("terms")
        .select("kind, arabic_text, checked, sort, country_id")
        .order("sort", { ascending: true });
      base.services = defaultServicesFromLibrary(libraryForCountry(buildTermLibrary(terms), null));
    }
    // A partner's seed is held to the rules of their save: no buy, no margin of
    // their choosing (a stated 0% would quote them our cost), no supplier rate.
    // …and so is anyone's without the cost view: a seed is a save, and the cost
    // fields are pricing.internal's to write (0047)
    const partner = await getPartnerSession();
    const internal = await currentCan("pricing.internal");
    const own = seed && !internal ? keepDraftCost(seed, base) : seed;
    if (own?.hotels && !internal) own.hotels = keepOurStays(own.hotels, []);
    // the serial an issue wrote is the server's — never a seed's
    if (own) delete own.produced_serial;
    const initial = own
      ? normalizeDraftData({ ...base, ...own } as unknown as Record<string, unknown>)
      : base;

    // A partner's file names their company HERE, at the one place every draft is
    // born — the generator's new-file button, a ready offer, the portal. The row
    // itself is stamped by insertDraft, which is what makes it theirs.
    if (partner) {
      initial.customer = { ...initial.customer, company: partner.partner_name };
    }

    // A ready offer's own title wins — it names the package, which is more use
    // than repeating the company on every row of their list.
    return await insertDraft(initial, seed?.source?.title || partner?.partner_name || undefined);
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * Copy a draft into a NEW one.
 *
 * This is what «إعادة الإصدار» does for a draft that already produced an offer:
 * re-running the producer would mint a second offer against the same draft and
 * overwrite the serial it remembers, so the same programme for the next client
 * starts as its own draft instead — the issued offer stays exactly as it was sent.
 */
export async function duplicateDraft(draftId: string, options: { freshClient?: boolean } = {}): Promise<CreateDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const record = await loadDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };

    const copy: DraftData = {
      ...record.data,
      produced_serial: null,
      // «نسخ» in Basic: the same programme for the next client — whose name and phone are still to be asked
      ...(options.freshClient ? { customer: { ...record.data.customer, customer_name: "", customer_phone: "" } } : {}),
    };
    const result = await insertDraft(
      copy,
      copy.customer.customer_name || copy.trip.destination || copy.trip.country || null,
    );
    return result.ok ? result : { ok: false, error: "err.copyFailed" };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * The draft for the generator's screens — without the cost unless the viewer
 * holds pricing.internal, and to a partner with a supplier stay's sell at their
 * terms (the sheet's lines are already theirs: see partnerSheet).
 */
export async function getDraft(draftId: string): Promise<DraftRecord | null> {
  const record = await loadDraft(draftId);
  if (!record || (await currentCan("pricing.internal"))) return record;
  const redacted = redactDraftCost(record.data);
  const partner = await partnerCaller();
  if (partner) return { ...record, data: { ...redacted, hotels: partnerStays(redacted.hotels, partner.terms) } };
  // the package margin is the agent's to set when the administration says so
  if ((await getProfitSettings()).by === "staff" && (await currentCan("pricing.view")) && record.data.pricing.profit) {
    redacted.pricing = { ...redacted.pricing, profit: record.data.pricing.profit };
  }
  return { ...record, data: redacted };
}

/**
 * Merge one or more stage slices into the draft (shallow, top-level keys). A
 * browser without pricing.internal never had the cost, so it is put back from
 * the stored draft rather than taken from what was sent.
 */
export async function saveDraftStages(draftId: string, slices: Partial<DraftData>): Promise<SaveDraftResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  const internal = await currentCan("pricing.internal");
  // without the internal view the cost comes back from what is stored; the
  // package margin is taken from this agent only when the administration lets agents set it
  const agentsSetProfit = !internal && (await getProfitSettings()).by === "staff" && (await currentCan("pricing.view"));
  // a partner was shown a supplier stay at their terms: our sell comes back from storage
  const partner = await partnerCaller();
  // …and once issued, their file is what operations books from: a change after
  // issue goes through a copy (duplicateDraft), never into the issued draft
  if (partner && (await loadDraft(draftId))?.data.produced_serial) return { ok: false, error: "pg.err.issuedLocked" };
  // produceOfferFromDraft writes the issued serial itself; a browser naming one
  // could tie its draft to an offer it never issued (operations seeds from it)
  if ("produced_serial" in slices) {
    slices = { ...slices };
    delete slices.produced_serial;
  }
  return writeDraftStages(draftId, slices, restoreSlices);
  function restoreSlices(sent: Partial<DraftData>, stored: DraftData, owner: string | null): Partial<DraftData> {
    // staff on a partner's file: the prices it shows the partner stay theirs
    const own = owner && !partner ? keepTheirPrices(sent, stored) : sent;
    if (internal) return own;
    const kept = keepDraftCost(own, stored);
    if (partner && kept.hotels) kept.hotels = keepOurStays(kept.hotels, stored.hotels);
    // a partner's file stays under their company, whatever the customer stage sends
    if (partner && kept.customer) {
      kept.customer = { ...kept.customer, company: partner.partner_name, partner_company_id: owner ?? partner.partner_id };
    }
    if (agentsSetProfit && sent.pricing && kept.pricing && "profit" in sent.pricing) {
      kept.pricing = { ...kept.pricing, profit: sent.pricing.profit };
    }
    return kept;
  }
}

export async function deleteDraft(draftId: string): Promise<SaveDraftResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    return await deleteDraftRow(draftId);
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- lookups for the stage forms ----------

/**
 * Every row, not the first 1,000.
 *
 * PostgREST caps an unranged select at 1,000 rows and says nothing. Measured
 * 2026-10-11: hotels came back 0-999 of 2,406 and room types 1,000 of 1,411,
 * so the generator silently offered 42% of the hotels and no room type past
 * the first thousand. The query must be ordered on something unique, or pages
 * can overlap and skip rows.
 */
/** Every room type, in the order the pickers list them. */
function roomTypeRows(supabase: Awaited<ReturnType<typeof db>>) {
  return allRows((from, to) =>
    supabase.from("room_types").select("id, arabic_name, hotel_id, default_board").order("arabic_name").order("id").range(from, to),
  );
}

/**
 * One country's hotels, by city id — what /basic asks for once a country is
 * chosen, instead of loading every hotel of every country before the page opens.
 * Null when the session is gone or the read failed (the caller asks again later).
 */
export async function getCountryHotels(countryName: string): Promise<Record<string, LookupHotel[]> | null> {
  try {
    const user = await getServerUser();
    if (!user) return null;
    const supabase = await db();
    const { data: countryRows } = await supabase.from("countries").select("id, arabic_name");
    const country = findLookupCountry(
      ((countryRows ?? []) as { id: string; arabic_name: string }[]).map((c) => ({ id: c.id, name: c.arabic_name })),
      countryName,
    );
    if (!country) return {};
    const { data: cityRows } = await supabase.from("cities").select("id").eq("country_id", country.id);
    const ids = ((cityRows ?? []) as { id: string }[]).map((c) => c.id);
    if (ids.length === 0) return {};
    const { data } = await allRows((from, to) =>
      supabase.from("hotels").select("id, arabic_name, stars, city_id").in("city_id", ids).order("id").range(from, to),
    );
    const byCity: Record<string, LookupHotel[]> = {};
    for (const h of data as { id: string; arabic_name: string; stars: number | null; city_id: string }[]) {
      (byCity[h.city_id] ??= []).push({ id: h.id, name: h.arabic_name, stars: h.stars });
    }
    return byCity;
  } catch {
    return null;
  }
}

/** The room types, for a screen that opened without them. Empty when the session is gone. */
export async function getRoomTypeLookups(): Promise<GeneratorLookups["roomTypes"]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const { data } = await roomTypeRows(await db());
    return (data as { id: string; arabic_name: string; hotel_id: string | null; default_board: GeneratorLookups["roomTypes"][number]["default_board"] }[]).map(
      (r) => ({ id: r.id, name: r.arabic_name, hotel_id: r.hotel_id, default_board: r.default_board }),
    );
  } catch {
    return [];
  }
}

async function allRows(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<{ data: unknown[] }> {
  const size = 1000;
  // Each page is a full round trip (~1 s from the server for 1,000 hotels), and
  // asked one after another they were most of the wait to open a file — so a
  // few are asked at once. The ones past the end come back empty.
  const batch = 3;
  const out: unknown[] = [];
  for (let from = 0; ; from += size * batch) {
    const results = await Promise.all(
      Array.from({ length: batch }, (_, i) => page(from + i * size, from + (i + 1) * size - 1)),
    );
    for (const { data, error } of results) {
      if (error) return { data: out };
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < size) return { data: out };
    }
  }
}

/**
 * `catalog: false` leaves out the two big lists — every hotel (2,300+, three
 * pages) and every room type — for a screen that fetches them itself when it
 * needs them (/basic: getCountryHotels, getRoomTypeLookups). The city lists
 * still come, so the pickers work at once.
 */
export async function getGeneratorLookups(options: { catalog?: boolean } = {}): Promise<GeneratorLookups> {
  const withCatalog = options.catalog ?? true;
  const empty: GeneratorLookups = {
    countries: [], roomTypes: [], airports: [], carTypes: [], termLibrary: emptyTermLibrary(), partners: [], airlines: [],
    hotelSources: [], countryServices: [],
  };
  try {
    // the service read below must not answer a caller with no session at all
    if (!(await getServerUser())) return empty;
    const supabase = await db();
    // names only, from two tables 0055 closed to partners (their rows carry our prices)
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const ratesPromise = getRates();
    const [countriesRes, citiesRes, hotelsRes, roomTypesRes, airportsRes, transportRes, termsRes, airlinesRes, partnersRes, servicesRes, suppliersRes] = await Promise.all([
      // iso2 is not decoration: a real hotel supplier looks a city up WITHIN a
      // country, so a live search without it returns nothing at all.
      supabase.from("countries").select("id, arabic_name, iso2, timezone, default_currency, status").order("arabic_name"),
      // the agency's own order first (sort_order — Malaysia opens on its four main
      // cities), then alphabetical; the client-side filter by country keeps it
      supabase
        .from("cities")
        .select("id, arabic_name, country_id, lat, lng")
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("arabic_name"),
      withCatalog
        ? allRows((from, to) => supabase.from("hotels").select("id, arabic_name, stars, city_id").order("verified", { ascending: false }).order("id").range(from, to))
        : Promise.resolve({ data: [] }),
      withCatalog ? roomTypeRows(supabase) : Promise.resolve({ data: [] }),
      // the city an airport serves turns «landed at LGK» into «the next city is لنكاوي»
      supabase.from("airports").select("id, arabic_name, code, iana_timezone, status, cities(arabic_name), countries(arabic_name)").order("code"),
      service
        .from("transportation_types")
        .select("arabic_name, english_name, category, vehicle_class, pax_capacity, luggage_capacity, status")
        .order("pax_capacity", { ascending: true, nullsFirst: false }),
      supabase.from("terms").select("kind, arabic_text, checked, sort, country_id").order("sort", { ascending: true }),
      // resellers only: a hotel supplier we assign bookings to has no business in
      // the picker that decides whose name is printed on the cover.
      supabase
        .from("airlines")
        .select("iata, arabic_name, logo_path")
        .neq("status", "Disabled")
        .order("arabic_name"),
      supabase
        .from("booking_partners")
        .select("id, name, name_latin, logo_path, brand_color, accent_color, address, phone, whatsapp, website, email")
        .eq("resells", true)
        .eq("active", true)
        .order("name"),
      // names only — partners use the generator, and a service's buy/sell price
      // is for «اقتراح التسعير» on the server, never the browser
      service.from("services").select("country_id, arabic_name").not("country_id", "is", null).order("arabic_name"),
      // who a flight or hotel price was booked through — names and what they sell, no contacts
      supabase.from("company_suppliers").select("id, arabic_name, categories, status").order("arabic_name"),
    ]);

    // a reference row is offered to the generator unless the admin disabled it
    const active = (status: string | null | undefined) => status !== "Disabled";
    const hotels = (hotelsRes.data ?? []) as { id: string; arabic_name: string; stars: number | null; city_id: string | null }[];
    const cities = (citiesRes.data ?? []) as { id: string; arabic_name: string; country_id: string | null; lat: number | string | null; lng: number | string | null }[];
    const countries = ((countriesRes.data ?? []) as { id: string; arabic_name: string; iso2: string | null; timezone: string | null; default_currency: string | null; status: string | null }[]).filter((c) => active(c.status));

    const builtCountries = countries.map((country) => ({
      id: country.id,
      name: country.arabic_name,
      iso2: country.iso2 ?? null,
      timezone: country.timezone ?? null,
      default_currency: country.default_currency ?? null,
      cities: cities
        .filter((c) => c.country_id === country.id)
        .map((c) => ({
          id: c.id,
          name: c.arabic_name,
          // the overland-hop warning's distance (offer/overland.ts)
          lat: c.lat == null ? null : Number(c.lat),
          lng: c.lng == null ? null : Number(c.lng),
          hotels: hotels
            .filter((h) => h.city_id === c.id)
            .map((h) => ({ id: h.id, name: h.arabic_name, stars: h.stars })),
        })),
    }));

    /**
     * The agency's own vehicles, smallest first.
     *
     * `transportation_types` is two things in one table: a product catalogue
     * for pricing (an airport pickup, four hours of disposal, a metro pass)
     * and the vehicles a group is actually put into. Only the second answers
     * «نوع السيارة», and the difference is STATED — `category = 'fleet'` —
     * because inferring it from the vehicle class offered a motorbike to a
     * family of nine and listed the same car twice, once as a service.
     *
     * Sorted by capacity rather than by name because that is what the choice
     * turns on: nine travellers need the first row that seats nine, and an
     * alphabetical list makes the agent read all of them to find it.
     */
    const carTypes: GeneratorLookups["carTypes"] = ((transportRes.data ?? []) as {
      arabic_name: string;
      english_name: string | null;
      category: string | null;
      vehicle_class: string | null;
      pax_capacity: number | null;
      luggage_capacity: number | null;
      status: string | null;
    }[])
      .filter((t) => active(t.status) && t.category === "fleet" && t.arabic_name?.trim())
      .map((t) => ({
        name: t.arabic_name.trim(),
        name_en: t.english_name?.trim() || null,
        pax: t.pax_capacity ?? null,
        luggage: t.luggage_capacity ?? null,
      }));

    const rates = await ratesPromise;
    return {
      // the most-sold countries first, then alphabetical (country-priority.ts)
      countries: byUsage(builtCountries),
      roomTypes: ((roomTypesRes.data ?? []) as { id: string; arabic_name: string; hotel_id: string | null; default_board: GeneratorLookups["roomTypes"][number]["default_board"] }[]).map(
        (r) => ({ id: r.id, name: r.arabic_name, hotel_id: r.hotel_id, default_board: r.default_board }),
      ),
      airports: ((airportsRes.data ?? []) as unknown as {
        id: string;
        arabic_name: string;
        code: string | null;
        iana_timezone: string | null;
        status: string | null;
        cities: { arabic_name: string } | null;
        countries: { arabic_name: string } | null;
      }[])
        .filter((a) => active(a.status))
        .map((a) => ({
          id: a.id,
          name: a.arabic_name,
          code: a.code,
          timezone: a.iana_timezone,
          city: a.cities?.arabic_name ?? null,
          country: a.countries?.arabic_name ?? null,
        })),
      companySuppliers: ((suppliersRes.data ?? []) as { id: string; arabic_name: string; categories: string | null; status: string | null }[])
        .filter((s) => active(s.status))
        .map((s) => ({ id: s.id, name: s.arabic_name, categories: s.categories ?? "" })),
      carTypes,
      termLibrary: buildTermLibrary(termsRes.data),
      countryServices: buildCountryServices(servicesRes.data),
      airlines: ((airlinesRes.data ?? []) as { iata: string; arabic_name: string; logo_path: string | null }[]).map((a) => ({
        iata: a.iata,
        name: a.arabic_name,
        logo_url: airlineLogoUrl(a.logo_path),
      })),
      // logo_path → public URL here, so the in-generator preview draws the real
      // logo the PDF will carry rather than a placeholder.
      partners: ((partnersRes.data ?? []) as (Omit<GeneratorLookups["partners"][number], "logo_url"> & { logo_path: string | null })[]).map(
        ({ logo_path, ...p }) => ({ ...p, logo_url: publicBrandLogoUrl(process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "", logo_path) }),
      ),
      // The picker's tabs come from what is actually connected. `mock` is a
      // deterministic fixture engine, so it is marked and the screen says so —
      // invented hotels at invented prices are one careless quote away from a
      // real customer.
      sarPer: rates.sarPer,
      ratesSource: rates.source,
      ratesDate: rates.updatedAt,
      hotelSources: (await getEnabledHotelSuppliers()).map((s) => ({
        code: s.code,
        name: s.code === "mock" ? "تجريبي (بيانات وهمية)" : s.name,
        demo: s.code === "mock" || s.code === "almosafer",
      })),
    };
  } catch {
    return empty;
  }
}

/**
 * The company's approved wording, straight from the `terms` table that
 * /offers/offer-includes, /offers/offer-not-includes and
 * /offers/terms-and-conditions administer. Agents pick from these lists instead
 * of retyping, so what the document prints is what the company approved.
 */
function buildTermLibrary(rows: unknown): TermLibrary {
  const list = (rows ?? []) as { kind: string; arabic_text: string | null; checked: boolean | null; country_id: string | null }[];
  const of = (kind: string): TermLibraryItem[] =>
    list
      .filter((r) => r.kind === kind && r.arabic_text && r.arabic_text.trim())
      .map((r) => ({ text: (r.arabic_text as string).trim(), checked: r.checked !== false, country_id: r.country_id ?? null }));
  return { includes: of("include"), excludes: of("exclude"), terms: of("term") };
}

/**
 * One line per service name per country. The list files the same service more
 * than once (Thailand has «استقبال بالورد» three times), and the agent is
 * choosing a NAME — the price is found later, on the server, by that name.
 */
function buildCountryServices(rows: unknown): GeneratorLookups["countryServices"] {
  const seen = new Set<string>();
  return ((rows ?? []) as { country_id: string; arabic_name: string | null }[]).flatMap((row) => {
    const name = row.arabic_name?.trim();
    const key = `${row.country_id}|${normalizeName(name)}`;
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [{ country_id: row.country_id, name }];
  });
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
    const record = await loadDraft(draftId);
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
    const record = await loadDraft(draftId);
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
    // The trip's own defaults come along: built without them every copied
    // line failed `statedBoard` and blocked, so copying a programme produced
    // a draft that was red before the agent had touched anything.
    const hotels = cityRows.map((c) =>
      normalizeDraftHotel({
        city_name: c.city_name,
        hotel_name: c.hotel_name ?? "",
        room_type_name: c.room_type ?? "",
        board_type: record.data.trip.default_board,
        rooms_count: record.data.trip.rooms,
      }),
    );

    return writeDraftStages(draftId, {
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
export type ProduceResult =
  | {
      ok: true;
      serial: string;
      /** what happened on the client's WhatsApp (client-whatsapp.ts) */
      whatsapp: ClientSendResult;
      /** a re-issue only: the version it published and «ما تغيّر» against the one before. */
      version?: number;
      changes?: OfferChange[];
    }
  | { ok: false; error: TranslationKey };

/**
 * Validate → map the draft onto CreateOfferInput → create the real offer.
 *
 * On a draft that was already issued this is «إصدار نسخة محدّثة»: the SAME
 * offer (serial) re-filled from the corrected draft (replaceOffer) and published
 * as its next version, which freezes this draft for operations' seeds.
 */
export async function produceOfferFromDraft(draftId: string): Promise<ProduceResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    // The full draft: the offer is issued with its buy prices whoever presses the button.
    const record = await loadDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };
    const data = record.data;
    // A partner's own file keeps its own rules (validateDraft's partnerFile).
    const issuer = await partnerCaller();
    // The re-issue's gates: a partner's file is locked once issued
    // (saveDraftStages), staff need offers.write, and a confirmed / invoiced
    // partner file stays as it was sent.
    const reissue = data.produced_serial;
    if (
      reissue &&
      (issuer || !(await currentCan("offers.write")) || (await reissueLocked(createSupabaseServiceClient() as unknown as SupabaseClient, reissue)))
    ) {
      return { ok: false, error: "pg.err.issuedLocked" };
    }

    // Weather, attached here rather than left to a button.
    //
    // The document prints «بيانات الطقس غير مرفقة في هذا العرض» when no day
    // carries a reading, and that sentence was going out on finished offers for
    // one reason only: nobody had pressed refresh on the itinerary stage. To a
    // client it reads as something we forgot. The reading costs nothing (the
    // provider is keyless) and the document already labels a forecast against a
    // climate average, so there is no reason to make a human remember it.
    //
    // Best-effort on purpose: a provider that is down must never stop an offer
    // from being issued. The old note is still there for that case.
    if (weatherMissing(data.days)) {
      try {
        const { days, attached } = await attachWeather(
          data.days,
          data.trip.destination || data.trip.country,
        );
        if (attached > 0) {
          data.days = days;
          await writeDraftStages(draftId, { days });
        }
      } catch {
        /* issue the offer anyway — the document says the data is not attached */
      }
    }

    // A partner cannot read our supplier list, so it is not asked to name one.
    const validation = validateDraft(data, { partnerFile: issuer !== null });
    if (!validation.ok) return { ok: false, error: "pg.err.blockingLeft" };
    // a hotel printed with a Latin «Arabic» name or no city is not issued (data order 11.1; a partner is only warned)
    if ((await checkHotelIssueGuard(data.hotels)).issues.some((i) => i.blocking)) return { ok: false, error: "data.quality.guard.blocked" };

    // PreBook re-validation: a supplier rate must still be valid at CONFIRM time.
    // Never freeze/publish a rate whose validity has lapsed since selection.
    const today = new Date().toISOString().slice(0, 10);
    if (data.hotels.some((h) => h.sourcing?.valid_until && h.sourcing.valid_until < today)) {
      return { ok: false, error: "pg.supplier.rateExpired" };
    }

    const cities = deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities);
    // One row per STAY, not per city. The old Map keyed by city_name silently
    // kept only the last hotel when a city held two — the offer would print one
    // hotel and operations would book one, for a trip that needed both.
    const stays = deriveHotelStays(cities, data.hotels);
    // A partner's file is issued at their terms: the stay's sell is a column
    // their token reads (offer_hotels_partner_read), and the sheet already is.
    const terms = await viewerTerms(record.partner_company_id);
    const boardLabel: Record<string, string> = { RO: "غرفة فقط", BB: "شامل الإفطار", HB: "نصف إقامة", FB: "إقامة كاملة", AI: "شامل كليًا" };

    const hotels: OfferHotelInput[] = stays.map((stay) => {
      const h = stay.line;
      const c = { check_in: stay.check_in, check_out: stay.check_out, nights: stay.nights };
      const s = h.sourcing;
      return {
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
        sell_price: s ? priceForViewer(s.sell_base, terms) : null,
        sell_currency: s ? "SAR" : null,
        // supplier sourcing → frozen into the render snapshot (offer_renders)
        cancellation_policy: stayCancellation(h),
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
        room_type_name: s?.room_name ?? (roomTypesText(h.rooms, (b) => BOARD_AR[b]) || h.room_type_name) ?? null,
      };
    });

    // Reconcile pricing items against the CURRENT stays: drop stale hotel items
    // whose stay no longer exists, so a removed hotel's (possibly below-floor)
    // price can never publish as a phantom line in the offer total.
    //
    // Matched by stay id where there is one, and by the old
    // «المدينة — الفندق» description otherwise — an item written before cities
    // could hold two hotels must not be reconciled away as a phantom.
    const validHotelRefs = new Set(stays.flatMap((s) => [pricingRefFor(s), `${s.city_name} — ${s.line.hotel_name}`]));
    const rates = await getRates();
    // The package's profit (stated on the file, or the administration's default
    // margin for a file that states none) laid onto the lines here, from the
    // saved cost — an agent without the internal view sets it without seeing it.
    const quote = data.pricing.display_currency || "SAR";
    // A partner's own file goes out on the sheet as the SERVER prices it — our
    // lines at their terms, their own figures as they typed them — never on the
    // sheet their browser saved, which can lower, drop or re-currency any line.
    // Its total is what they owe us (partner_cost, below).
    // our own file: a figure an agent typed is our cost, so the margin goes on it (typedAsCost);
    // a partner's sheet is re-priced below and carries no cost by design
    let sheet = record.partner_company_id ? data.pricing.items : typedAsCost(data.pricing.items);
    // A file started from one of our ready packages owes at least that package
    // at their terms. Its price is read here by id — never the final_total their
    // browser can edit — and only ever raises what the sheet says, so pointing
    // `source` at a cheaper package buys nothing.
    let packageLine: PricingLineInput | null = null;
    if (record.partner_company_id) {
      // what they owe is rounded to 2 decimals per line in the quote currency:
      // a quote in BTC or gold (the feed has both) would round it to nothing
      const perQuote = rates.sarPer[quote] ?? 0;
      if (!(perQuote > 0 && perQuote <= 100)) return { ok: false, error: "pg.err.missingRates" };
      const fresh = await suggestPricingFor(record, { hotel: "الفندق", airline: "شركة الطيران" });
      if (!fresh.ok) throw new Error(fresh.error);
      // one of OUR lines with no price (no margin to lay on) is never theirs to skip
      if (fresh.items.some((s) => s.source !== "typed" && s.source !== "none" && s.sell_price == null)) {
        return { ok: false, error: "pg.err.priceMissing" };
      }
      sheet = issuedPartnerSheet(sheet, fresh.items);
      const readyId = data.source?.ready_offer_id;
      if (readyId) {
        const { data: ro } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
          .from("ready_offers")
          .select("price, currency")
          .eq("id", readyId)
          .maybeSingle();
        const row = ro as { price: number | string | null; currency: string | null } | null;
        // the package lost its price since (back to «قريباً»): nothing the partner can type fixes that
        if (!row || row.price == null) return { ok: false, error: "ro.err.notFound" };
        if (!terms) return { ok: false, error: "pg.err.priceMissing" };
        packageLine = {
          quantity: 1,
          buy_price: null,
          buy_currency: null,
          sell_price: partnerPrice(Number(row.price), terms),
          sell_currency: row.currency || "SAR",
        };
      } else if (sheet.some((i) => i.sell_price == null)) {
        return { ok: false, error: "pg.err.priceMissing" };
      }
    }
    const reconciledItems = withPackageProfit(
      sheet.filter((it) => it.item_type !== "hotel" || validHotelRefs.has(it.ref ?? it.description ?? "")),
      packageProfitFor(data.pricing, (await getProfitSettings()).default_pct),
      rebase(rates.sarPer, quote) ?? {},
      quote,
    );

    // The sell the agent is actually looking at. A line priced with a manual
    // profit («٪» or a flat amount) stores the ORIGINAL sell, so publishing
    // `item.sell_price` directly would send the offer out at the price before
    // the markup — the one number nobody would notice was wrong until the
    // month's margin came in short.
    const effectiveSell = (item: (typeof reconciledItems)[number]) =>
      applyManualProfit(item.buy_price, item.sell_price, item.profit_pct, item.profit_amount);

    const pricing_items: OfferPricingItemInput[] = reconciledItems.map((item) => ({
      item_type: item.item_type,
      description: item.description || null,
      quantity: item.quantity,
      buy_price: item.buy_price,
      buy_currency: item.buy_currency || null,
      sell_price: effectiveSell(item),
      sell_currency: item.sell_currency || null,
    }));

    // Into the quote currency line by line — never a raw sum of mixed
    // currencies (see offerTotals). A currency with no rate blocks issuing:
    // a total that silently skipped a line is worse than no total.
    const lines = reconciledItems.map((item) => ({
      quantity: item.quantity,
      buy_price: item.buy_price,
      buy_currency: item.buy_currency,
      sell_price: effectiveSell(item),
      sell_currency: item.sell_currency,
    }));
    const totals = offerTotals(lines, rates.sarPer, data.pricing.display_currency, data.pricing.final_total);
    if (totals.missing_rates.length > 0) return { ok: false, error: "pg.err.missingRates" };
    const sellTotal = totals.total;
    const buyTotal = totals.buy_total;

    // The meal plan, in the three vocabularies that need it: the exact Arabic
    // word for the «يشمل» line and the internal column, and the board it was
    // booked as, so a city whose stay deviates is not described by it.
    const mealsText = data.trip.meal_plan ? MEAL_PLAN_AR[data.trip.meal_plan] : null;
    const mealsBoard = data.trip.meal_plan ? MEAL_PLAN_BOARD[data.trip.meal_plan] : null;
    const mealsLine = mealPlanIncludeLine(data.trip);

    const transportIncludes = data.transport.map((t) =>
      `التوصيلات: ${t.from_place} ← ${t.to_place}${t.car_type ? ` (${t.car_type})` : ""}`,
    );
    const visaIncludes = data.visas.map((v) => `تأشيرة ${v.country || v.visa_type} × ${v.count}`);
    // «يشمل / لا يشمل» as the file is — what the scope switched off is not
    // promised. /basic did this on its services step; the full generator (and
    // so every partner) did not, and printed reception, tours and a domestic
    // flight that had been switched off. Here, once, for both.
    const scoped = withScopeLines(data);
    // «بكج متقدم»: where our service starts and ends, and what the client arranges
    const route = advancedLines(data.advanced);

    // Chosen in the customer stage. A draft that predates the picker carries only
    // the typed company NAME, so resolve that too rather than losing the branding.
    // A partner's own file is theirs whatever its customer stage says: they can
    // write that field, and it would file the offer under another company.
    let partnerCompanyId = record.partner_company_id ?? data.customer.partner_company_id;
    if (!partnerCompanyId && data.customer.company.trim()) {
      const supabase = await db();
      const { data: rows } = await supabase.from("booking_partners").select("id, name").eq("resells", true);
      partnerCompanyId = matchPartner(data.customer, (rows ?? []) as { id: string; name: string }[])?.id ?? null;
    }

    // A partner issues their own file only (loadDraft hands them nothing else).
    if (issuer && record.partner_company_id !== issuer.partner_id) return { ok: false, error: "err.forbidden" };

    // What the partner owes us for this file (0058), in its quote currency, fixed
    // now — confirming it raises that invoice (ledger-server.ts). Their own file:
    // its sheet as issued, never the final_total they quote their client. A file
    // we issue FOR them: our sell total at their terms (throws if unreadable).
    const pkg = packageLine ? offerTotals([packageLine], rates.sarPer, data.pricing.display_currency, null) : null;
    if (pkg && pkg.missing_rates.length > 0) return { ok: false, error: "pg.err.missingRates" };
    const sheetOwed = offerTotals(lines, rates.sarPer, data.pricing.display_currency, null).total;
    const partnerCost = record.partner_company_id
      ? pkg
        ? Math.max(sheetOwed ?? 0, pkg.total ?? 0)
        : sheetOwed
      : partnerCompanyId && sellTotal != null
        ? partnerPrice(sellTotal, await viewerTerms(partnerCompanyId))
        : null;

    const input: CreateOfferInput = {
      customer_id: await customerFor(data.customer, await isStaffSession()),
      employee_id: null,
      // From here the preview, the PDF and the client link all resolve their
      // branding from this one column.
      partner_company_id: partnerCompanyId,
      partner_cost: partnerCost,
      // A reseller's file starts WITHOUT our price on it — they set their own.
      // Not a company setting: an initial value, flipped per file from the
      // export screen.
      // A partner's OWN file prints its price — the one they typed for their
      // client, else their cost (the owner: «يجب ان يظهر بسعر»).
      show_prices: record.partner_company_id ? true : !partnerCompanyId,
      destination: data.trip.destination || data.trip.country,
      duration: `${data.trip.days} أيام / ${data.trip.nights} ليالي`,
      offer_date: data.trip.arrival_date,
      adults: data.trip.adults,
      children: data.trip.children,
      infants: data.trip.infants,
      total: sellTotal,
      buy_total: buyTotal,
      currency: data.pricing.display_currency,
      total_sar: totals.total_sar,
      // the rates this total was computed at, frozen with the offer
      fx: rates,
      // The snapshot's city summary. With two hotels in a city it names the
      // first and says how many follow, rather than picking one arbitrarily and
      // printing it as though it were the whole stay.
      // per VISIT, not per name: a city the trip returns to lists only that visit's hotels
      cities: cities.map((c, i) => {
        const mine = stays.filter((s) => s.city_index === i);
        const h = mine[0]?.line;
        const extra = mine.length > 1 ? ` + ${mine.length - 1}` : "";
        return {
          city_name: c.city_name,
          hotel_name: h?.hotel_name ? `${h.hotel_name}${extra}` : null,
          room_type: (h && roomTypesText(h.rooms, (b) => BOARD_AR[b])) || h?.room_type_name || null,
          nights: c.nights,
          check_in: c.check_in,
          check_out: c.check_out,
          // The precise wording only when this city's stay actually bought
          // the board the trip asked for — an offer must never promise meals
          // we did not buy. (Internal readers only: the client document
          // prints the board code, so the exact word travels as an «يشمل»
          // line instead.)
          meals: h?.board_type
            ? mealsText && h.board_type === mealsBoard
              ? mealsText
              : (boardLabel[h.board_type] ?? null)
            : null,
        };
      }),
      flights: data.flights.map((f) => ({
        carrier: f.airline || null,
        from_airport: f.from_airport || null,
        to_airport: f.to_airport || null,
        flight_date: f.departure_at ? f.departure_at.slice(0, 10) : null,
        passengers: data.trip.adults + data.trip.children,
        baggage: baggageLabel(f) || null,
        airline: f.airline || null,
        flight_no: f.flight_no || null,
        airline_iata: f.airline_iata || null,
        departure_at: f.departure_at,
        arrival_at: f.arrival_at,
        cabin_class: f.cabin_class || null,
        baggage_allowance: baggageLabel(f) || null,
        leg_order: f.leg_order,
      })),
      services: [
        ...route.includes.map((label) => ({ label, kind: "include" as const })),
        ...scoped.includes.map((label) => ({ label, kind: "include" as const })),
        ...(mealsLine ? [{ label: mealsLine, kind: "include" as const }] : []),
        ...(data.scope.transport ? transportIncludes : []).map((label) => ({ label, kind: "include" as const })),
        ...(data.scope.visas ? visaIncludes : []).map((label) => ({ label, kind: "include" as const })),
        ...route.excludes.map((label) => ({ label, kind: "exclude" as const })),
        ...scoped.excludes.map((label) => ({ label, kind: "exclude" as const })),
      ],
      terms: data.services.terms,
      hotels,
      pricing_items,
      // Only days with something to say are printed — an untouched skeleton
      // must not publish a page of empty day cards. A day whose only content
      // is how the group moves still prints: that IS its programme.
      days: draftDaySkeleton(data)
        .map((d, index, all) => ({
          d,
          move: data.scope.transport ? advancedDayNote(transportNoteForDay(data.transport_plan, all, index, data.flights), data.advanced) : null,
        }))
        .filter(({ d, move }) => d.title.trim() || d.activities.some((a) => a.trim()) || move)
        .map(({ d, move }) => ({
          transport_note: move,
          day_number: d.day_number,
          day_date: d.date,
          city_name: d.city_name,
          title: d.title.trim(),
          activities: d.activities.map((a) => a.trim()).filter(Boolean),
          temp_max: d.weather?.temp_max ?? null,
          temp_min: d.weather?.temp_min ?? null,
          rain_chance: d.weather?.rain_chance ?? null,
          weather_code: d.weather?.code ?? null,
          weather_source: d.weather?.source ?? null,
          weather_fetched_at: d.weather?.fetched_at || null,
        })),
    };
    // the version the client has now, for «ما تغيّر» after the re-issue
    const before = reissue ? await getPublishedClientOffer(reissue) : null;
    const result = reissue ? await replaceOffer(reissue, input) : await insertOffer(input, issuer?.partner_id);

    if (!result.ok) return { ok: false, error: result.error };
    await writeDraftStages(draftId, { produced_serial: result.serial });
    // Producing an offer IS sending it: publish v1 (freeze client snapshot +
    // status draft→sent) so the client link + PDF work immediately. A re-issue
    // publishes version N+1 and freezes this draft beside it.
    const published = await publishOffer(result.serial, Boolean(reissue));
    let versionChanges: { version: number; changes: OfferChange[] } | null = null;
    if (reissue) {
      if (!published.ok) return { ok: false, error: published.error };
      const after = await getPublishedClientOffer(result.serial);
      const changes = before && after ? offerChanges(before.offer, after.offer) : [];
      versionChanges = { version: published.version, changes };
      await logAudit({
        action: "offer.reissued",
        entity: "offers",
        entity_id: result.id,
        meta: { serial: result.serial, version: published.version, draft_id: draftId, changes },
      });
    }
    // the client hears it on WhatsApp — gated (client-whatsapp.ts), never in the way of the issue
    const whatsapp = await sendOfferToClient(result.serial, Boolean(record.data.produced_serial));
    return { ok: true, serial: result.serial, whatsapp, ...versionChanges };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
