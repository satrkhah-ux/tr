/**
 * Package-generator draft model — THE contract between the stage pages, the
 * generator shell, validation, the preview document and the drafts repo.
 *
 * A draft is one `offer_drafts` row whose `data` jsonb holds these slices.
 * Every stage edits ONLY its slice; the shell merges + auto-saves. Pure module:
 * no React, no Supabase — safe to import anywhere (client, server, tests).
 */

import type { BoardType, FlightLegOrder, PricingItemType } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";

// ---------- stage registry ----------
export const STAGE_KEYS = [
  "customer",
  "trip",
  "cities",
  "hotels",
  "flights",
  "transport",
  "services",
  "visas",
  "pricing",
  "preview",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export type StageMeta = {
  key: StageKey;
  labelKey: TranslationKey;
  /** stage requires the pricing.view permission. */
  gated?: boolean;
};

export const STAGES: StageMeta[] = [
  { key: "customer", labelKey: "pg.stage.customer" },
  { key: "trip", labelKey: "pg.stage.trip" },
  { key: "cities", labelKey: "pg.stage.cities" },
  { key: "hotels", labelKey: "pg.stage.hotels" },
  { key: "flights", labelKey: "pg.stage.flights" },
  { key: "transport", labelKey: "pg.stage.transport" },
  { key: "services", labelKey: "pg.stage.services" },
  { key: "visas", labelKey: "pg.stage.visas" },
  { key: "pricing", labelKey: "pg.stage.pricing", gated: true },
  { key: "preview", labelKey: "pg.stage.preview" },
];

export function stageHref(draftId: string, stage: StageKey): string {
  return `/package-generator/${draftId}/${stage}`;
}

// ---------- slices ----------
export type DraftCustomer = {
  customer_name: string;
  customer_phone: string;
  company: string;
};

export type DraftTrip = {
  country: string;
  /** client-facing destination text; defaults to the country name. */
  destination: string;
  arrival_date: string | null;
  departure_date: string | null;
  days: number;
  nights: number;
  adults: number;
  children: number;
  infants: number;
};

export type DraftCity = {
  city_name: string;
  nights: number;
  /** derived from trip.arrival_date + the nights chain (deriveCityDates). */
  check_in: string | null;
  check_out: string | null;
};

/**
 * The supplier rate a hotel line was priced from (set by "price from supplier").
 * Carries BOTH the internal cost basis and the client-safe cancellation/excluded
 * fields; the client redaction strips the internal ones structurally later.
 */
export type DraftHotelSourcing = {
  supplier_id: string;
  supplier_name: string;
  rate_key: string;
  net_base: number;
  net_source_currency: string;
  fx_rate: number;
  fx_date: string;
  ref_sell_base: number | null;
  sell_base: number;
  markup_amount: number;
  markup_pct: number | null;
  margin_pct: number | null;
  /** the min-margin the rule imposed — for re-validating the published sell. */
  min_margin_pct: number | null;
  cancellation_policy: string;
  excluded_surcharges: { name: string; amount: number; currency: string }[];
  valid_until: string | null;
  room_category: string;
  /** the rate's room name for display (supplier hotels have no internal room type). */
  room_name: string;
  refundable: boolean;
  /** true when the sell violated the supplier floor or the minimum margin. */
  blocked: boolean;
  // ----- cached static content (client-safe) -----
  image_url: string | null;
  facilities: string[];
  star_rating: number | null;
  /** the supplier's opaque hotel id (for the content cache). */
  supplier_hotel_id: string | null;
  /** when the LIVE rate was fetched (ISO) — drives the "updated X min ago" hint. */
  rate_fetched_at: string | null;
};

/** One hotel line per city (aligned by city_name). Prices live in the pricing stage. */
export type DraftHotel = {
  city_name: string;
  hotel_id: string | null;
  hotel_name: string;
  room_type_id: string | null;
  room_type_name: string;
  board_type: BoardType | null;
  rooms_count: number;
  /** present once priced from a supplier rate; undefined for manually-priced lines. */
  sourcing?: DraftHotelSourcing | null;
};

export type DraftFlight = {
  airline: string;
  flight_no: string;
  from_airport: string;
  to_airport: string;
  /** local wall clock at the ORIGIN airport ("YYYY-MM-DDTHH:mm"). */
  departure_at: string | null;
  /** local wall clock at the DESTINATION airport ("YYYY-MM-DDTHH:mm"). */
  arrival_at: string | null;
  /** origin IANA timezone (resolved from the picked airport); null until resolvable. */
  from_tz: string | null;
  /** destination IANA timezone (resolved from the picked airport); null until resolvable. */
  to_tz: string | null;
  /** true once the agent manually edited the departure DATE → stop auto-syncing it. */
  date_user_set: boolean;
  cabin_class: string;
  baggage_allowance: string;
  leg_order: FlightLegOrder;
};

export type DraftTransport = {
  from_place: string;
  to_place: string;
  car_type: string;
  date: string | null;
  note: string;
};

export type DraftServices = {
  includes: string[];
  excludes: string[];
  terms: string[];
};

export type DraftVisa = {
  country: string;
  visa_type: string;
  count: number;
  note: string;
};

export type DraftPricingItem = {
  item_type: PricingItemType;
  description: string;
  quantity: number;
  buy_price: number | null;
  buy_currency: string;
  sell_price: number | null;
  sell_currency: string;
};

export type DraftPricing = {
  items: DraftPricingItem[];
  display_currency: string;
  /** rounded client-facing total (sell); editable override. */
  final_total: number | null;
};

export type DraftData = {
  customer: DraftCustomer;
  trip: DraftTrip;
  cities: DraftCity[];
  hotels: DraftHotel[];
  flights: DraftFlight[];
  transport: DraftTransport[];
  services: DraftServices;
  visas: DraftVisa[];
  pricing: DraftPricing;
  /** set once the draft has been produced into a real offer. */
  produced_serial: string | null;
};

export function emptyDraftData(): DraftData {
  return {
    customer: { customer_name: "", customer_phone: "", company: "" },
    trip: {
      country: "",
      destination: "",
      arrival_date: null,
      departure_date: null,
      days: 0,
      nights: 0,
      adults: 2,
      children: 0,
      infants: 0,
    },
    cities: [],
    hotels: [],
    flights: [],
    transport: [],
    services: { includes: [], excludes: [], terms: [] },
    visas: [],
    pricing: { items: [], display_currency: "SAR", final_total: null },
    produced_serial: null,
  };
}

/** Backfill tz/user-set fields on flights persisted before prompt-5 (old drafts have none). */
function normalizeDraftFlight(raw: unknown): DraftFlight {
  const f = (raw && typeof raw === "object" ? raw : {}) as Partial<DraftFlight>;
  return {
    airline: typeof f.airline === "string" ? f.airline : "",
    flight_no: typeof f.flight_no === "string" ? f.flight_no : "",
    from_airport: typeof f.from_airport === "string" ? f.from_airport : "",
    to_airport: typeof f.to_airport === "string" ? f.to_airport : "",
    departure_at: typeof f.departure_at === "string" ? f.departure_at : null,
    arrival_at: typeof f.arrival_at === "string" ? f.arrival_at : null,
    from_tz: typeof f.from_tz === "string" ? f.from_tz : null,
    to_tz: typeof f.to_tz === "string" ? f.to_tz : null,
    date_user_set: f.date_user_set === true,
    cabin_class: typeof f.cabin_class === "string" ? f.cabin_class : "",
    baggage_allowance: typeof f.baggage_allowance === "string" ? f.baggage_allowance : "",
    leg_order: f.leg_order === "inbound" || f.leg_order === "internal" ? f.leg_order : "outbound",
  };
}

/** Merge unknown jsonb into a full DraftData (tolerates old/partial drafts). */
export function normalizeDraftData(raw: Record<string, unknown> | null | undefined): DraftData {
  const empty = emptyDraftData();
  if (!raw || typeof raw !== "object") return empty;
  const source = raw as Partial<DraftData>;
  return {
    customer: { ...empty.customer, ...(source.customer ?? {}) },
    trip: { ...empty.trip, ...(source.trip ?? {}) },
    cities: Array.isArray(source.cities) ? source.cities : [],
    hotels: Array.isArray(source.hotels) ? source.hotels : [],
    flights: Array.isArray(source.flights) ? source.flights.map(normalizeDraftFlight) : [],
    transport: Array.isArray(source.transport) ? source.transport : [],
    services: { ...empty.services, ...(source.services ?? {}) },
    visas: Array.isArray(source.visas) ? source.visas : [],
    pricing: { ...empty.pricing, ...(source.pricing ?? {}) },
    produced_serial: typeof source.produced_serial === "string" ? source.produced_serial : null,
  };
}

// ---------- pure helpers ----------
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Chain check-in/check-out through the cities from the trip arrival date:
 * city[0].check_in = arrival; each city checks out after its nights; the next
 * city checks in the same day. Returns a NEW array (input untouched).
 */
export function deriveCityDates(arrivalDate: string | null, cities: DraftCity[]): DraftCity[] {
  if (!arrivalDate) return cities.map((c) => ({ ...c, check_in: null, check_out: null }));
  let cursor = arrivalDate;
  return cities.map((c) => {
    const check_in = cursor;
    const check_out = addDays(cursor, Math.max(c.nights, 0));
    cursor = check_out;
    return { ...c, check_in, check_out };
  });
}

/** Sum of allocated city nights. */
export function totalCityNights(cities: DraftCity[]): number {
  return cities.reduce((sum, c) => sum + (Number.isFinite(c.nights) ? c.nights : 0), 0);
}

export const BOARD_TYPES: BoardType[] = ["RO", "BB", "HB", "FB", "AI"];

export const BOARD_LABEL_KEYS: Record<BoardType, TranslationKey> = {
  RO: "pg.board.RO",
  BB: "pg.board.BB",
  HB: "pg.board.HB",
  FB: "pg.board.FB",
  AI: "pg.board.AI",
};

export const CURRENCIES = ["SAR", "USD", "EUR", "TRY", "MYR", "THB", "IDR", "AED"] as const;

// ---------- lookups (loaded server-side, passed to stage pages) ----------
export type LookupHotel = { id: string; name: string; stars: number | null };
export type LookupCity = { id: string; name: string; hotels: LookupHotel[] };
export type LookupCountry = { id: string; name: string; cities: LookupCity[] };
export type LookupRoomType = { id: string; name: string; hotel_id: string | null; default_board: BoardType | null };
export type LookupAirport = { id: string; name: string; code: string | null; timezone: string | null };

export type GeneratorLookups = {
  countries: LookupCountry[];
  roomTypes: LookupRoomType[];
  airports: LookupAirport[];
  carTypes: string[];
};

// ---------- reusable programs ----------
export type ReusableProgram = {
  serial: string;
  destination: string | null;
  duration: string | null;
  adults: number;
  days: number | null;
  cities: string[];
  /** exact traveler-count match — ranked first. */
  samePeople: boolean;
};
