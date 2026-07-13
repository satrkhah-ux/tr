"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import type { BoardType, PricingItemType, RenderVariant } from "@/lib/types";
import { computeOfferPricing, type PricingLineInput } from "@/lib/offer/pricing";
import {
  toClientOfferDTO,
  type ClientOfferDTO,
  type InternalOfferDTO,
  type InternalHotelLine,
  type InternalFlightLine,
  type ClimateLine,
} from "@/lib/offer/dto";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { getClimateNote } from "./climate-actions";
import { getRates } from "./rates-actions";
import { STAGE_KEYS } from "./pipeline";

/**
 * Offers span many related tables with dynamic inserts; Supabase's strict
 * per-table generics collapse those to `never`. We route offer writes/reads
 * through a loosely-typed client and re-assert explicit shapes on the way out
 * (see the ClientOffer / KanbanCard types) so the public API stays fully typed.
 */
async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

// ---------- inputs ----------
export type OfferCityInput = {
  city_name: string;
  hotel_name: string | null;
  room_type: string | null;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
  meals: string | null;
};

export type OfferFlightInput = {
  carrier: string | null;
  from_airport: string | null;
  to_airport: string | null;
  flight_date: string | null;
  passengers: number | null;
  baggage: string | null;
  // richer leg fields (migration 0008) — optional so older callers keep compiling
  airline?: string | null;
  flight_no?: string | null;
  departure_at?: string | null;
  arrival_at?: string | null;
  cabin_class?: string | null;
  baggage_allowance?: string | null;
  leg_order?: import("@/lib/types").FlightLegOrder | null;
};

export type OfferServiceInput = { label: string; kind: "include" | "exclude" };

/** A surcharge the guest pays at the hotel (client-safe). */
export type ExcludedSurchargeInput = { name: string; amount: number; currency: string };

/** A normalized hotel line with dual pricing (server-only; buy never leaves). */
export type OfferHotelInput = {
  offer_city_id?: string | null;
  hotel_id?: string | null;
  hotel_name: string | null;
  room_type_id: string | null;
  rooms_count: number;
  board_type: BoardType | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  // ----- supplier sourcing (optional; migration 0014) -----
  cancellation_policy?: string | null;
  excluded_surcharges?: ExcludedSurchargeInput[];
  valid_until?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  rate_key?: string | null;
  net_base?: number | null;
  net_source_currency?: string | null;
  fx_rate?: number | null;
  fx_date?: string | null;
  ref_sell_base?: number | null;
  markup_amount?: number | null;
  markup_pct?: number | null;
  // ----- client-safe cached content (migration 0016) -----
  image_url?: string | null;
  facilities?: string[];
  content_star_rating?: number | null;
  room_type_name?: string | null;
};

/** A per-item pricing line (buy/sell). Rolled into offer_pricing_items. */
export type OfferPricingItemInput = {
  item_type: PricingItemType;
  item_id?: string | null;
  description: string | null;
  quantity: number;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
};

export type CreateOfferInput = {
  customer_id: string | null;
  employee_id: string | null;
  destination: string;
  duration: string | null;
  offer_date: string | null;
  adults: number;
  children: number;
  infants: number;
  total: number | null;
  /** internal buy total — stored in pricings only, NEVER exposed to clients. */
  buy_total: number | null;
  currency: string;
  cities: OfferCityInput[];
  flights: OfferFlightInput[];
  services: OfferServiceInput[];
  terms: string[];
  /** optional richer hotel lines with dual pricing (migration 0008). */
  hotels?: OfferHotelInput[];
  /** optional per-item pricing rollup (migration 0008). */
  pricing_items?: OfferPricingItemInput[];
};

export type CreateOfferResult = { ok: true; serial: string; id: string } | { ok: false; error: TranslationKey };

// ---------- client-safe read shapes (NO buy price / profit ever) ----------
export type ClientOfferCity = {
  city_name: string;
  hotel_name: string | null;
  room_type: string | null;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
  meals: string | null;
};

export type ClientOffer = {
  serial: string;
  destination: string | null;
  duration: string | null;
  offer_date: string | null;
  adults: number;
  children: number;
  infants: number;
  total: number | null;
  currency: string | null;
  status: string;
  pdf_url: string | null;
  cities: ClientOfferCity[];
  flights: OfferFlightInput[];
  includes: string[];
  excludes: string[];
  terms: string[];
};

/** Add whole days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function generateSerial(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const employeeNo = Math.floor(Math.random() * 9) + 1;
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `AD-${employeeNo}-${seq}-${stamp}`;
}

/** Creates an offer + all children + pricing + first revision. Requires auth. */
export async function createOffer(input: CreateOfferInput): Promise<CreateOfferResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    if (!input.destination.trim()) return { ok: false, error: "err.destinationRequired" };

    const supabase = await db();
    const serial = generateSerial();

    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .insert({
        serial,
        customer_id: input.customer_id,
        employee_id: input.employee_id,
        destination: input.destination.trim(),
        duration: input.duration,
        offer_date: input.offer_date,
        adults: input.adults,
        children: input.children,
        infants: input.infants,
        total: input.total,
        currency: input.currency,
        status: "draft",
        pipeline_stage: "active_not_confirmed",
      })
      .select("id")
      .single();
    if (offerError || !offer) return { ok: false, error: "err.saveOfferFailed" };

    const offerId = offer.id;

    if (input.cities.length > 0) {
      await supabase.from("offer_cities").insert(
        input.cities.map((c, index) => ({
          offer_id: offerId,
          city_name: c.city_name,
          hotel_name: c.hotel_name,
          room_type: c.room_type,
          nights: c.nights,
          check_in: c.check_in,
          check_out: c.check_out,
          meals: c.meals,
          sort: index,
        })),
      );
    }
    if (input.flights.length > 0) {
      await supabase.from("offer_flights").insert(
        input.flights.map((f, index) => ({
          offer_id: offerId,
          carrier: f.carrier,
          from_airport: f.from_airport,
          to_airport: f.to_airport,
          flight_date: f.flight_date,
          passengers: f.passengers,
          baggage: f.baggage,
          airline: f.airline ?? null,
          flight_no: f.flight_no ?? null,
          departure_at: f.departure_at ?? null,
          arrival_at: f.arrival_at ?? null,
          cabin_class: f.cabin_class ?? null,
          baggage_allowance: f.baggage_allowance ?? null,
          leg_order: f.leg_order ?? null,
          sort: index,
        })),
      );
    }
    if (input.hotels && input.hotels.length > 0) {
      await supabase.from("offer_hotels").insert(
        input.hotels.map((h, index) => ({
          offer_id: offerId,
          offer_city_id: h.offer_city_id ?? null,
          hotel_id: h.hotel_id ?? null,
          hotel_name: h.hotel_name,
          room_type_id: h.room_type_id,
          rooms_count: h.rooms_count,
          board_type: h.board_type,
          check_in: h.check_in,
          check_out: h.check_out,
          nights: h.nights,
          buy_price: h.buy_price,
          buy_currency: h.buy_currency,
          sell_price: h.sell_price,
          sell_currency: h.sell_currency,
          // supplier sourcing (migration 0014); safe defaults when absent
          cancellation_policy: h.cancellation_policy ?? null,
          excluded_surcharges: h.excluded_surcharges ?? [],
          valid_until: h.valid_until ?? null,
          supplier_id: h.supplier_id ?? null,
          supplier_name: h.supplier_name ?? null,
          rate_key: h.rate_key ?? null,
          net_base: h.net_base ?? null,
          net_source_currency: h.net_source_currency ?? null,
          fx_rate: h.fx_rate ?? null,
          fx_date: h.fx_date ?? null,
          ref_sell_base: h.ref_sell_base ?? null,
          markup_amount: h.markup_amount ?? null,
          markup_pct: h.markup_pct ?? null,
          image_url: h.image_url ?? null,
          facilities: h.facilities ?? [],
          content_star_rating: h.content_star_rating ?? null,
          room_type_name: h.room_type_name ?? null,
          sort: index,
        })),
      );
    }
    if (input.pricing_items && input.pricing_items.length > 0) {
      await supabase.from("offer_pricing_items").insert(
        input.pricing_items.map((p, index) => {
          const qty = Number.isFinite(p.quantity) && p.quantity > 0 ? p.quantity : 1;
          const total_buy = p.buy_price == null ? null : Number((p.buy_price * qty).toFixed(2));
          const total_sell = p.sell_price == null ? null : Number((p.sell_price * qty).toFixed(2));
          return {
            offer_id: offerId,
            item_type: p.item_type,
            item_id: p.item_id ?? null,
            description: p.description,
            quantity: qty,
            buy_price: p.buy_price,
            buy_currency: p.buy_currency,
            sell_price: p.sell_price,
            sell_currency: p.sell_currency,
            total_buy,
            total_sell,
            sort: index,
          };
        }),
      );
    }
    if (input.services.length > 0) {
      await supabase.from("offer_services").insert(
        input.services.map((s, index) => ({ offer_id: offerId, label: s.label, kind: s.kind, sort: index })),
      );
    }
    if (input.terms.length > 0) {
      await supabase.from("offer_terms").insert(
        input.terms.map((text, index) => ({ offer_id: offerId, text, sort: index })),
      );
    }

    const profit =
      input.total != null && input.buy_total != null ? Number((input.total - input.buy_total).toFixed(2)) : null;
    await supabase.from("pricings").insert({
      offer_id: offerId,
      total: input.total,
      currency: input.currency,
      buy_total: input.buy_total,
      sell_total: input.total,
      profit,
    });
    await supabase.from("offer_revisions").insert({ offer_id: offerId, revision: 1, note: "created via builder" });

    return { ok: true, serial, id: offerId };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Public client view of an offer by serial — never reads pricings (buy/profit). */
export async function getOfferBySerial(serial: string): Promise<ClientOffer | null> {
  try {
    const supabase = await db();
    const { data: offer } = await supabase
      .from("offers")
      .select("id, serial, destination, duration, offer_date, adults, children, infants, total, currency, status, pdf_url")
      .eq("serial", serial)
      .maybeSingle();
    if (!offer) return null;

    const [cities, services, terms, flights] = await Promise.all([
      supabase.from("offer_cities").select("city_name, hotel_name, room_type, nights, check_in, check_out, meals").eq("offer_id", offer.id).order("sort"),
      supabase.from("offer_services").select("label, kind").eq("offer_id", offer.id).order("sort"),
      supabase.from("offer_terms").select("text").eq("offer_id", offer.id).order("sort"),
      supabase.from("offer_flights").select("carrier, from_airport, to_airport, flight_date, passengers, baggage").eq("offer_id", offer.id).order("sort"),
    ]);

    const serviceRows = (services.data ?? []) as { label: string; kind: string }[];
    return {
      serial: offer.serial,
      destination: offer.destination,
      duration: offer.duration,
      offer_date: offer.offer_date,
      adults: offer.adults,
      children: offer.children,
      infants: offer.infants,
      total: offer.total,
      currency: offer.currency,
      status: offer.status,
      pdf_url: offer.pdf_url,
      cities: (cities.data ?? []) as ClientOfferCity[],
      flights: (flights.data ?? []) as OfferFlightInput[],
      includes: serviceRows.filter((s) => s.kind === "include").map((s) => s.label),
      excludes: serviceRows.filter((s) => s.kind === "exclude").map((s) => s.label),
      terms: ((terms.data ?? []) as { text: string }[]).map((t) => t.text),
    };
  } catch {
    return null;
  }
}

// ---------- generator data ----------
export type GeneratorCity = { id: string; name: string; hotels: string[] };
export type GeneratorCountry = { id: string; name: string; cities: GeneratorCity[] };
export type GeneratorProgram = {
  serial: string;
  title: string;
  destination: string | null;
  duration: string | null;
  adults: number;
  cities: string[];
};
export type GeneratorData = { countries: GeneratorCountry[]; programs: GeneratorProgram[] };

export async function getGeneratorData(): Promise<GeneratorData> {
  try {
    const supabase = await db();
    const [countries, cities, hotels, offers] = await Promise.all([
      supabase.from("countries").select("id, arabic_name").order("arabic_name"),
      supabase.from("cities").select("id, arabic_name, country_id").order("arabic_name"),
      supabase.from("hotels").select("arabic_name, city_id"),
      supabase.from("offers").select("id, serial, destination, duration, adults").order("created_at", { ascending: false }).limit(8),
    ]);

    const hotelRows = (hotels.data ?? []) as { arabic_name: string; city_id: string | null }[];
    const cityRows = (cities.data ?? []) as { id: string; arabic_name: string; country_id: string | null }[];
    const countryRows = (countries.data ?? []) as { id: string; arabic_name: string }[];

    const builtCountries: GeneratorCountry[] = countryRows.map((country) => ({
      id: country.id,
      name: country.arabic_name,
      cities: cityRows
        .filter((c) => c.country_id === country.id)
        .map((c) => ({
          id: c.id,
          name: c.arabic_name,
          hotels: hotelRows.filter((h) => h.city_id === c.id).map((h) => h.arabic_name),
        })),
    }));

    const offerRows = (offers.data ?? []) as { id: string; serial: string; destination: string | null; duration: string | null; adults: number }[];
    let programCities: { offer_id: string; city_name: string }[] = [];
    if (offerRows.length > 0) {
      const { data } = await supabase.from("offer_cities").select("offer_id, city_name").in("offer_id", offerRows.map((o) => o.id));
      programCities = (data ?? []) as { offer_id: string; city_name: string }[];
    }

    const programs: GeneratorProgram[] = offerRows.map((offer) => ({
      serial: offer.serial,
      title: offer.destination ?? offer.serial,
      destination: offer.destination,
      duration: offer.duration,
      adults: offer.adults,
      cities: programCities.filter((c) => c.offer_id === offer.id).map((c) => c.city_name),
    }));

    return { countries: builtCountries, programs };
  } catch {
    return { countries: [], programs: [] };
  }
}

export type NamedOption = { id: string; name: string };
export type BuilderData = { countries: GeneratorCountry[]; customers: NamedOption[]; employees: NamedOption[] };

export async function getBuilderData(): Promise<BuilderData> {
  try {
    const gen = await getGeneratorData();
    const supabase = await db();
    const [customers, employees] = await Promise.all([
      supabase.from("customers").select("id, arabic_name").order("arabic_name").limit(200),
      supabase.from("employees").select("id, arabic_name").order("arabic_name"),
    ]);
    const toNamed = (rows: unknown): NamedOption[] =>
      ((rows ?? []) as { id: string; arabic_name: string }[]).map((r) => ({ id: r.id, name: r.arabic_name }));
    return { countries: gen.countries, customers: toNamed(customers.data), employees: toNamed(employees.data) };
  } catch {
    return { countries: [], customers: [], employees: [] };
  }
}

// ---------- intelligence hub ----------
export type HubData = {
  kpis: { readiness: number; confirmed: number; revenue: number; average: number; offersCount: number };
  offer: ClientOffer | null;
};

export async function getHubData(): Promise<HubData> {
  const empty: HubData = { kpis: { readiness: 0, confirmed: 0, revenue: 0, average: 0, offersCount: 0 }, offer: null };
  try {
    const supabase = await db();
    const [all, confirmed, latest] = await Promise.all([
      supabase.from("offers").select("total"),
      supabase.from("offers").select("total").eq("status", "confirmed"),
      supabase.from("offers").select("serial").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const allRows = (all.data ?? []) as { total: number | null }[];
    const confirmedRows = (confirmed.data ?? []) as { total: number | null }[];
    const offersCount = allRows.length;
    const confirmedCount = confirmedRows.length;
    const revenue = confirmedRows.reduce((sum, r) => sum + (r.total ?? 0), 0);
    const average = offersCount > 0 ? allRows.reduce((sum, r) => sum + (r.total ?? 0), 0) / offersCount : 0;
    const readiness = offersCount > 0 ? Math.round((confirmedCount / offersCount) * 100) : 0;

    const serial = latest.data?.serial;
    const offer = serial ? await getOfferBySerial(serial) : null;

    return { kpis: { readiness, confirmed: confirmedCount, revenue, average, offersCount }, offer };
  } catch {
    return empty;
  }
}

// ---------- kanban ----------
export type KanbanCard = {
  id: string;
  serial: string;
  destination: string | null;
  offer_date: string | null;
  status: string;
  total: number | null;
};
export type KanbanColumn = { key: string; cards: KanbanCard[] };

export async function listKanban(): Promise<KanbanColumn[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("offers")
      .select("id, serial, destination, offer_date, status, total, pipeline_stage")
      .order("created_at", { ascending: false });
    const rows = (data ?? []) as (KanbanCard & { pipeline_stage: string })[];
    return STAGE_KEYS.map((key) => ({
      key,
      cards: rows
        .filter((r) => r.pipeline_stage === key)
        .map((r) => ({ id: r.id, serial: r.serial, destination: r.destination, offer_date: r.offer_date, status: r.status, total: r.total })),
    }));
  } catch {
    return STAGE_KEYS.map((key) => ({ key, cards: [] }));
  }
}

export async function updateOfferStage(id: string, stage: string): Promise<{ ok: boolean; error?: TranslationKey }> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    if (!STAGE_KEYS.includes(stage)) return { ok: false, error: "err.invalidStage" };
    const supabase = await db();
    const { error } = await supabase.from("offers").update({ pipeline_stage: stage }).eq("id", id);
    if (error) return { ok: false, error: "err.stageUpdateFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- render snapshots ----------
export type SaveRenderResult = { ok: true; id: string; version: number } | { ok: false; error: TranslationKey };

/** Persist an immutable snapshot of exactly what was rendered/sent. Requires auth. */
export async function saveOfferRender(input: {
  offer_id: string;
  variant: RenderVariant;
  snapshot: Record<string, unknown>;
  file_path?: string | null;
}): Promise<SaveRenderResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    const supabase = await db();
    const { data: last } = await supabase
      .from("offer_renders")
      .select("version")
      .eq("offer_id", input.offer_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((last as { version: number } | null)?.version ?? 0) + 1;
    const { data, error } = await supabase
      .from("offer_renders")
      .insert({
        offer_id: input.offer_id,
        version,
        variant: input.variant,
        snapshot_json: input.snapshot,
        file_path: input.file_path ?? null,
        rendered_by: null,
        rendered_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };
    return { ok: true, id: data.id, version };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- internal offer DTO (permission-gated: has buy price + profit) ----------
type HotelRow = {
  hotel_id: string | null;
  hotel_name: string | null;
  room_type_id: string | null;
  board_type: BoardType | null;
  rooms_count: number;
  nights: number | null;
  check_in: string | null;
  check_out: string | null;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  // supplier sourcing (migration 0014)
  cancellation_policy: string | null;
  excluded_surcharges: unknown;
  valid_until: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  rate_key: string | null;
  net_base: number | null;
  net_source_currency: string | null;
  fx_rate: number | null;
  fx_date: string | null;
  ref_sell_base: number | null;
  markup_amount: number | null;
  markup_pct: number | null;
  image_url: string | null;
  facilities: unknown;
  content_star_rating: number | null;
  room_type_name: string | null;
};

/** Parse a jsonb string array (facilities) into a clean string[]. */
function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Parse the offer_hotels.excluded_surcharges jsonb into a client-safe list. */
function parseExcludedSurcharges(value: unknown): { name: string; amount: number; currency: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({
      name: typeof s.name === "string" ? s.name : "",
      amount: typeof s.amount === "number" ? s.amount : Number(s.amount) || 0,
      currency: typeof s.currency === "string" ? s.currency : "",
    }))
    .filter((s) => s.name !== "");
}
type FlightRow = {
  airline: string | null;
  carrier: string | null;
  flight_no: string | null;
  from_airport: string | null;
  to_airport: string | null;
  departure_at: string | null;
  arrival_at: string | null;
  cabin_class: string | null;
  cabin: string | null;
  baggage_allowance: string | null;
  baggage: string | null;
  leg_order: import("@/lib/types").FlightLegOrder | null;
};
type PricingItemRow = {
  item_type: PricingItemType;
  description: string | null;
  quantity: number;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
};

/**
 * Assemble the full INTERNAL offer view (buy price + profit + margin). Requires
 * auth — the buy/profit fields are permission-gated. For client output, pass the
 * result through `toClientOfferDTO()` (dto.ts), which structurally omits them.
 */
export async function getInternalOffer(serial: string): Promise<InternalOfferDTO | null> {
  const user = await getServerUser();
  if (!user) return null;
  try {
    const supabase = await db();
    const { data: offer } = await supabase
      .from("offers")
      .select("id, serial, destination, duration, offer_date, adults, children, infants, total, currency, customer_id, employee_id, created_at")
      .eq("serial", serial)
      .maybeSingle();
    if (!offer) return null;

    const [customerRes, employeeRes] = await Promise.all([
      offer.customer_id
        ? supabase.from("customers").select("arabic_name, mobile").eq("id", offer.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      offer.employee_id
        ? supabase.from("employees").select("arabic_name").eq("id", offer.employee_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const customer = customerRes.data as { arabic_name: string | null; mobile: string | null } | null;
    const employee = employeeRes.data as { arabic_name: string | null } | null;

    const [hotelsRes, flightsRes, servicesRes, termsRes, itemsRes] = await Promise.all([
      supabase.from("offer_hotels").select("hotel_id, hotel_name, room_type_id, board_type, rooms_count, nights, check_in, check_out, buy_price, buy_currency, sell_price, sell_currency, cancellation_policy, excluded_surcharges, valid_until, supplier_id, supplier_name, rate_key, net_base, net_source_currency, fx_rate, fx_date, ref_sell_base, markup_amount, markup_pct, image_url, facilities, content_star_rating, room_type_name").eq("offer_id", offer.id).order("sort"),
      supabase.from("offer_flights").select("airline, carrier, flight_no, from_airport, to_airport, departure_at, arrival_at, cabin_class, cabin, baggage_allowance, baggage, leg_order").eq("offer_id", offer.id).order("sort"),
      supabase.from("offer_services").select("label, kind").eq("offer_id", offer.id).order("sort"),
      supabase.from("offer_terms").select("text").eq("offer_id", offer.id).order("sort"),
      supabase.from("offer_pricing_items").select("item_type, description, quantity, buy_price, buy_currency, sell_price, sell_currency").eq("offer_id", offer.id).order("sort"),
    ]);

    const hotelRows = (hotelsRes.data ?? []) as HotelRow[];
    const flightRows = (flightsRes.data ?? []) as FlightRow[];
    const serviceRows = (servicesRes.data ?? []) as { label: string; kind: string }[];
    const termRows = (termsRes.data ?? []) as { text: string }[];
    const itemRows = (itemsRes.data ?? []) as PricingItemRow[];

    // resolve room-type display names
    const roomTypeIds = [...new Set(hotelRows.map((h) => h.room_type_id).filter((id): id is string => Boolean(id)))];
    const roomTypeNames = new Map<string, string>();
    if (roomTypeIds.length > 0) {
      const { data: rt } = await supabase.from("room_types").select("id, arabic_name").in("id", roomTypeIds);
      for (const row of (rt ?? []) as { id: string; arabic_name: string }[]) roomTypeNames.set(row.id, row.arabic_name);
    }

    // resolve each hotel's city + stars (for the per-city accommodation card + climate match)
    const hotelIds = [...new Set(hotelRows.map((h) => h.hotel_id).filter((id): id is string => Boolean(id)))];
    const hotelCity = new Map<string, string | null>(); // hotel_id -> city_id
    const hotelStars = new Map<string, number | null>(); // hotel_id -> stars
    const cityNames = new Map<string, string>(); // city_id -> arabic name
    if (hotelIds.length > 0) {
      const { data: hotelInfo } = await supabase.from("hotels").select("id, city_id, stars").in("id", hotelIds);
      for (const row of (hotelInfo ?? []) as { id: string; city_id: string | null; stars: number | null }[]) {
        hotelCity.set(row.id, row.city_id);
        hotelStars.set(row.id, row.stars);
      }
      const cityIds = [...new Set([...hotelCity.values()].filter((id): id is string => Boolean(id)))];
      if (cityIds.length > 0) {
        const { data: cityRows } = await supabase.from("cities").select("id, arabic_name").in("id", cityIds);
        for (const row of (cityRows ?? []) as { id: string; arabic_name: string }[]) cityNames.set(row.id, row.arabic_name);
      }
    }
    const hotelCityName = (hotelId: string | null): string | null => {
      const cityId = hotelId ? hotelCity.get(hotelId) : null;
      return cityId ? (cityNames.get(cityId) ?? null) : null;
    };

    const hotels: InternalHotelLine[] = hotelRows.map((h) => ({
      city_name: hotelCityName(h.hotel_id),
      hotel_name: h.hotel_name,
      // prefer the cached content star rating (supplier-sourced) over the internal hotel's
      stars: h.content_star_rating ?? (h.hotel_id ? (hotelStars.get(h.hotel_id) ?? null) : null),
      // internal room-type name when mapped; otherwise the supplier rate's room name
      room_type: (h.room_type_id ? roomTypeNames.get(h.room_type_id) : null) ?? h.room_type_name ?? null,
      board_type: h.board_type,
      rooms_count: h.rooms_count,
      nights: h.nights,
      check_in: h.check_in,
      check_out: h.check_out,
      sell_price: h.sell_price,
      sell_currency: h.sell_currency,
      buy_price: h.buy_price,
      buy_currency: h.buy_currency,
      // client-safe supplier-sourced fields (survive redaction)
      cancellation_policy: h.cancellation_policy,
      excluded_surcharges: parseExcludedSurcharges(h.excluded_surcharges),
      valid_until: h.valid_until,
      image_url: h.image_url,
      facilities: parseStringArray(h.facilities),
      // INTERNAL sourcing (stripped from the client DTO by dto.ts)
      supplier_id: h.supplier_id,
      supplier_name: h.supplier_name,
      rate_key: h.rate_key,
      net_base: h.net_base,
      net_source_currency: h.net_source_currency,
      fx_rate: h.fx_rate,
      fx_date: h.fx_date,
      ref_sell_base: h.ref_sell_base,
      markup_amount: h.markup_amount,
      markup_pct: h.markup_pct,
    }));

    const flights: InternalFlightLine[] = flightRows.map((f) => ({
      airline: f.airline ?? f.carrier,
      flight_no: f.flight_no,
      from_airport: f.from_airport,
      to_airport: f.to_airport,
      departure_at: f.departure_at,
      arrival_at: f.arrival_at,
      cabin_class: f.cabin_class ?? f.cabin,
      baggage_allowance: f.baggage_allowance ?? f.baggage,
      leg_order: f.leg_order,
      // per-flight sell/buy live in offer_pricing_items (item_type='flight'); left null on the leg
      sell_price: null,
      sell_currency: null,
      buy_price: null,
      buy_currency: null,
    }));

    // climate: one note per distinct hotel city, for the offer month (reuses the
    // hotel→city map resolved above). Ordered by first appearance in the itinerary.
    const climate: ClimateLine[] = [];
    const month = offer.offer_date ? Number(offer.offer_date.slice(5, 7)) : NaN;
    if (month >= 1 && month <= 12) {
      const seen = new Set<string>();
      const orderedCityIds: string[] = [];
      for (const h of hotelRows) {
        const cityId = h.hotel_id ? hotelCity.get(h.hotel_id) ?? null : null;
        if (cityId && !seen.has(cityId)) {
          seen.add(cityId);
          orderedCityIds.push(cityId);
        }
      }
      for (const cityId of orderedCityIds) {
        const note = await getClimateNote(cityId, month);
        if (note) {
          climate.push({
            city_name: cityNames.get(cityId) ?? "",
            month: note.month,
            avg_high_c: note.avg_high_c,
            avg_low_c: note.avg_low_c,
            rain_level: note.rain_level,
            humidity_level: note.humidity_level,
            advice_ar: note.advice_ar,
            advice_en: note.advice_en,
          });
        }
      }
    }

    const { sarPer } = await getRates();
    const lines: PricingLineInput[] = itemRows.map((p) => ({
      item_type: p.item_type,
      description: p.description,
      quantity: p.quantity,
      buy_price: p.buy_price,
      buy_currency: p.buy_currency,
      sell_price: p.sell_price,
      sell_currency: p.sell_currency,
    }));
    const pricing = computeOfferPricing(lines, sarPer, "SAR");

    // Transport + visas get dedicated document sections. They are stored either as
    // priced items (offer_pricing_items.item_type) or as prefixed include labels
    // (produced by the generator). Collect both and remove them from `includes`
    // so nothing double-renders.
    const rawIncludes = serviceRows.filter((s) => s.kind === "include").map((s) => s.label);
    const itemDesc = (type: PricingItemType) =>
      itemRows.filter((i) => i.item_type === type).map((i) => i.description).filter((d): d is string => Boolean(d && d.trim()));
    const transport = [...new Set([...itemDesc("transport"), ...rawIncludes.filter((l) => l.startsWith("التوصيلات"))])];
    const visas = [...new Set([...itemDesc("visa"), ...rawIncludes.filter((l) => l.startsWith("تأشيرة"))])];
    const includes = rawIncludes.filter((l) => !l.startsWith("التوصيلات") && !l.startsWith("تأشيرة"));

    // arrival = offer_date (falls back to earliest hotel check-in); departure =
    // latest hotel check-out. issue = created_at; validity = issue + 14 days.
    const checkIns = hotels.map((h) => h.check_in).filter((d): d is string => Boolean(d)).sort();
    const checkOuts = hotels.map((h) => h.check_out).filter((d): d is string => Boolean(d)).sort();
    const arrival_date = offer.offer_date ?? checkIns[0] ?? null;
    const departure_date = checkOuts.length > 0 ? checkOuts[checkOuts.length - 1] : null;
    const issue_date = offer.created_at ? offer.created_at.slice(0, 10) : null;
    const validity_date = issue_date ? addDaysIso(issue_date, 14) : null;

    return {
      serial: offer.serial,
      destination: offer.destination,
      customer_name: customer?.arabic_name ?? null,
      customer_phone: customer?.mobile ?? null,
      employee_name: employee?.arabic_name ?? null,
      arrival_date,
      departure_date,
      duration: offer.duration,
      offer_date: offer.offer_date,
      issue_date,
      validity_date,
      adults: offer.adults,
      children: offer.children,
      infants: offer.infants,
      total: offer.total,
      currency: offer.currency,
      hotels,
      flights,
      transport,
      visas,
      includes,
      excludes: serviceRows.filter((s) => s.kind === "exclude").map((s) => s.label),
      terms: termRows.map((t) => t.text),
      climate,
      pricing,
    };
  } catch {
    return null;
  }
}

// ---------- publishing (versioned client render + status transition) ----------
export type PublishResult = { ok: true; serial: string; version: number } | { ok: false; error: TranslationKey };

/** Transition an offer's status and record it in offer_status_history. */
async function setOfferStatus(
  supabase: SupabaseClient,
  offerId: string,
  toStatus: string,
  note: string | null,
): Promise<void> {
  const { data: current } = await supabase.from("offers").select("status").eq("id", offerId).maybeSingle();
  const fromStatus = (current as { status: string } | null)?.status ?? null;
  if (fromStatus === toStatus) return;
  await supabase.from("offers").update({ status: toStatus }).eq("id", offerId);
  await supabase.from("offer_status_history").insert({
    offer_id: offerId,
    from_status: fromStatus,
    to_status: toStatus,
    note,
  });
}

/**
 * Publish an offer: freeze an immutable CLIENT snapshot (+ an internal one for
 * the record), bump the version, point the offer's pdf_url at the client PDF,
 * and transition the status draft → sent (with history). The public client link
 * and the sent PDF both read this exact snapshot, so they never drift when the
 * underlying hotel/price data changes later. Requires auth.
 */
export async function publishOffer(serial: string): Promise<PublishResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };

    const internal = await getInternalOffer(serial);
    if (!internal) return { ok: false, error: "err.loadFailed" };
    const client = toClientOfferDTO(internal);

    const supabase = await db();
    const { data: offerRow } = await supabase.from("offers").select("id").eq("serial", serial).maybeSingle();
    if (!offerRow) return { ok: false, error: "err.loadFailed" };
    const offerId = (offerRow as { id: string }).id;

    // next shared version across both variants (published together)
    const { data: last } = await supabase
      .from("offer_renders")
      .select("version")
      .eq("offer_id", offerId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = ((last as { version: number } | null)?.version ?? 0) + 1;
    const filePath = `/client-offer/${serial}/pdf?v=${version}`;

    const { error: clientErr } = await supabase.from("offer_renders").insert({
      offer_id: offerId,
      version,
      variant: "client",
      snapshot_json: client as unknown as Record<string, unknown>,
      file_path: filePath,
      rendered_at: new Date().toISOString(),
    });
    if (clientErr) return { ok: false, error: "err.createFailed" };

    await supabase.from("offer_renders").insert({
      offer_id: offerId,
      version,
      variant: "internal",
      snapshot_json: internal as unknown as Record<string, unknown>,
      file_path: filePath,
      rendered_at: new Date().toISOString(),
    });

    await supabase.from("offers").update({ pdf_url: filePath }).eq("id", offerId);
    await setOfferStatus(supabase, offerId, "sent", `published v${version}`);

    return { ok: true, serial, version };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type PublishedRender = { version: number; offer: ClientOfferDTO; file_path: string | null };

/**
 * Latest PUBLISHED client snapshot for a serial — the frozen document the public
 * link and the sent PDF render. Anon-safe: offer_renders grants anon SELECT for
 * variant='client' (migration 0010), and the snapshot is already redacted.
 */
export async function getPublishedClientOffer(serial: string): Promise<PublishedRender | null> {
  try {
    const supabase = await db();
    const { data: offerRow } = await supabase.from("offers").select("id").eq("serial", serial).maybeSingle();
    if (!offerRow) return null;
    const { data: render } = await supabase
      .from("offer_renders")
      .select("version, snapshot_json, file_path")
      .eq("offer_id", (offerRow as { id: string }).id)
      .eq("variant", "client")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!render) return null;
    const row = render as { version: number; snapshot_json: Record<string, unknown>; file_path: string | null };
    return { version: row.version, offer: row.snapshot_json as unknown as ClientOfferDTO, file_path: row.file_path };
  } catch {
    return null;
  }
}
