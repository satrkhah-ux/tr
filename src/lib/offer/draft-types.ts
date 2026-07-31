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
  "itinerary",
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
  { key: "itinerary", labelKey: "pg.stage.itinerary" },
  { key: "pricing", labelKey: "pg.stage.pricing", gated: true },
  { key: "preview", labelKey: "pg.stage.preview" },
];

export function stageHref(draftId: string, stage: StageKey): string {
  return `/package-generator/${draftId}/${stage}`;
}

/**
 * The stages an agent actually sees: permission-gated ones need pricing.view,
 * and a scope switch that is OFF removes its stage entirely.
 *
 * A stage the sale excludes is not merely disabled — it is gone from the rail,
 * because a visible-but-pointless step is the thing agents waste time on.
 */
export function visibleStagesFor(scope: DraftScope, canPricing: boolean): StageMeta[] {
  return STAGES.filter((s) => {
    if (s.gated && !canPricing) return false;
    const switchKey = SCOPE_KEYS.find((k) => SCOPE_STAGE[k] === s.key);
    return switchKey ? scope[switchKey] : true;
  });
}

// ---------- slices ----------
export type DraftCustomer = {
  customer_name: string;
  customer_phone: string;
  /** the company's NAME, kept alongside the id so legacy drafts still read. */
  company: string;
  /**
   * A registered partner company (booking_partners) this file is being built FOR.
   *
   * Set it and the sale is B2B: the document comes out under their name, logo and
   * colours, and the end client's details are none of our business — so the
   * customer-name and phone advisories fall silent (draft-validation.ts).
   */
  partner_company_id: string | null;
};

/**
 * Which partner company this draft is for.
 *
 * The id decides. But the company used to be a free-text field, so a draft in
 * flight may carry only a NAME — matching it means an agent who typed the company
 * yesterday gets the branded document today, without re-entering anything.
 */
export function matchPartner<T extends { id: string; name: string }>(
  customer: DraftCustomer,
  partners: T[],
): T | null {
  if (customer.partner_company_id) {
    return partners.find((p) => p.id === customer.partner_company_id) ?? null;
  }
  const typed = customer.company.trim().toLowerCase();
  if (!typed) return null;
  return partners.find((p) => p.name.trim().toLowerCase() === typed) ?? null;
}

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
  /**
   * Ages of the children/infants counted above. Kept the SAME LENGTH as the
   * count by resizeAges() — a child's age changes the hotel rate and some
   * airlines' fare, so an offer that says "2 children" without ages is a quote
   * the supplier can reprice later.
   */
  children_ages: number[];
  infant_ages: number[];
  /**
   * Room defaults for the whole trip, entered once with the customer and
   * inherited by every city's hotel line (still editable per city — an extra
   * room for a driver is booked in some cities and not others).
   */
  rooms: number;
  /**
   * A room-type NAME, not an id: room_types rows belong to a hotel, and at this
   * point no hotel is chosen. The agent means "a suite", and the hotel stage
   * resolves that to the picked hotel's own row when it has one.
   */
  default_room_type_name: string;
  default_board: BoardType | null;
};

/** Distinct room-type names across all hotels — what a trip-wide default offers. */
export function roomTypeNames(roomTypes: LookupRoomType[]): string[] {
  const seen = new Set<string>();
  for (const rt of roomTypes) {
    const name = rt.name.trim();
    if (name) seen.add(name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "ar"));
}

/**
 * Which service families this offer actually covers.
 *
 * Not every destination needs every service: a Gulf trip needs no visa, a client
 * may buy flights only, a self-drive package has no transfers. An unchecked
 * family hides its stage from the rail AND stops its validation from blocking —
 * otherwise the agent is nagged forever about a hotel that was never part of
 * the sale.
 */
export type DraftScope = {
  flights: boolean;
  hotels: boolean;
  visas: boolean;
  transport: boolean;
};

/** The stage each scope switch governs. Stages absent here are always shown. */
export const SCOPE_STAGE: Record<keyof DraftScope, StageKey> = {
  flights: "flights",
  hotels: "hotels",
  visas: "visas",
  transport: "transport",
};

export const SCOPE_KEYS = Object.keys(SCOPE_STAGE) as (keyof DraftScope)[];

/**
 * Grow/shrink an ages list to match a traveler count, preserving what was typed.
 * Pure — the same helper backs both the children and the infant lists.
 */
export function resizeAges(ages: number[], count: number, fallback = 0): number[] {
  const n = Math.max(Math.trunc(count) || 0, 0);
  const safe = Array.isArray(ages) ? ages : [];
  return Array.from({ length: n }, (_, i) => {
    const v = safe[i];
    return Number.isFinite(v) && v >= 0 ? Number(v) : fallback;
  });
}

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

/**
 * One booked room. A city often needs more than one and they are not alike — a
 * double for the family plus a single that is really the driver's, which is
 * booked but never labelled as such on the client document.
 */
export type DraftRoomSpec = {
  room_type_id: string | null;
  room_type_name: string;
  board_type: BoardType | null;
};

export function emptyRoomSpec(): DraftRoomSpec {
  return { room_type_id: null, room_type_name: "", board_type: null };
}

/** One hotel line per city (aligned by city_name). Prices live in the pricing stage. */
export type DraftHotel = {
  city_name: string;
  hotel_id: string | null;
  hotel_name: string;
  /**
   * The hotel's Latin name. Printed beside the Arabic one because a traveller
   * who cannot read Arabic still has to find the building, show the name to a
   * taxi driver, and match it against the booking.
   */
  hotel_name_en: string;
  /**
   * THE rooms. `rooms_count` and the room-type/board scalars below mirror
   * rooms.length and rooms[0] — keep them in step with withRooms(), never by
   * hand. The mirrors exist so the document, the DTO and the invariants that
   * predate multi-room lines keep working untouched.
   */
  rooms: DraftRoomSpec[];
  room_type_id: string | null;
  room_type_name: string;
  board_type: BoardType | null;
  rooms_count: number;
  /** manual sell price for the whole stay, when not priced from a supplier. */
  manual_price: number | null;
  manual_currency: string;
  /** present once priced from a supplier rate; undefined for manually-priced lines. */
  sourcing?: DraftHotelSourcing | null;
};

/**
 * The ONLY writer of the rooms array and its mirrors. Anything that changes the
 * rooms goes through here, so rooms_count and the room-1 scalars can never drift
 * from the array the UI is editing.
 */
export function withRooms(line: DraftHotel, rooms: DraftRoomSpec[]): DraftHotel {
  const safe = rooms.length > 0 ? rooms : [emptyRoomSpec()];
  const first = safe[0];
  return {
    ...line,
    rooms: safe,
    rooms_count: safe.length,
    room_type_id: first.room_type_id,
    room_type_name: first.room_type_name,
    board_type: first.board_type,
  };
}

/** Grow/shrink the rooms of a line, cloning the first room into any new slot. */
export function resizeRooms(line: DraftHotel, count: number): DraftHotel {
  const n = Math.max(Math.trunc(count) || 1, 1);
  const current = line.rooms.length > 0 ? line.rooms : [emptyRoomSpec()];
  const template = current[0];
  return withRooms(
    line,
    Array.from({ length: n }, (_, i) => current[i] ?? { ...template }),
  );
}

/** Backfill a hotel line saved before it carried rooms[] / the English name. */
export function normalizeDraftHotel(raw: unknown): DraftHotel {
  const h = (raw && typeof raw === "object" ? raw : {}) as Partial<DraftHotel>;
  const count = Math.max(Math.trunc(Number(h.rooms_count)) || 1, 1);
  const legacy: DraftRoomSpec = {
    room_type_id: typeof h.room_type_id === "string" ? h.room_type_id : null,
    room_type_name: typeof h.room_type_name === "string" ? h.room_type_name : "",
    board_type: (h.board_type ?? null) as BoardType | null,
  };
  // An old line described ONE room and a count; every room was that room.
  const rooms = Array.isArray(h.rooms) && h.rooms.length > 0 ? h.rooms : Array.from({ length: count }, () => ({ ...legacy }));
  const base: DraftHotel = {
    city_name: typeof h.city_name === "string" ? h.city_name : "",
    hotel_id: typeof h.hotel_id === "string" ? h.hotel_id : null,
    hotel_name: typeof h.hotel_name === "string" ? h.hotel_name : "",
    hotel_name_en: typeof h.hotel_name_en === "string" ? h.hotel_name_en : "",
    rooms,
    room_type_id: legacy.room_type_id,
    room_type_name: legacy.room_type_name,
    board_type: legacy.board_type,
    rooms_count: count,
    manual_price: typeof h.manual_price === "number" ? h.manual_price : null,
    manual_currency: typeof h.manual_currency === "string" && h.manual_currency ? h.manual_currency : "SAR",
    // deliberately NOT `sourcing: h.sourcing ?? null` — a seeded line must carry
    // no supplier key at all, and a null one still reads as "priced from a
    // supplier, expired" to anything checking for the property.
    ...(h.sourcing ? { sourcing: h.sourcing } : {}),
  };
  return withRooms(base, rooms);
}

export type DraftFlight = {
  airline: string;
  /**
   * IATA designator, e.g. "SV". Resolved from the flight number the agent types,
   * and the key the document draws the carrier's mark from.
   */
  airline_iata: string;
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
  /** free text kept for legacy drafts and anything the two fields below miss. */
  baggage_allowance: string;
  /**
   * Checked baggage, split because a traveller is told two different numbers and
   * an airline enforces both: "30 kg" says nothing about whether that is one
   * bag or two, and "2 bags" says nothing about the weight allowed in each.
   * A single free-text field made agents write one and drop the other.
   */
  baggage_kg: number | null;
  baggage_pieces: number | null;
  cabin_baggage_kg: number | null;
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

/**
 * A weather reading SNAPSHOTTED into the draft, not fetched at render time —
 * the published client document must print the same numbers forever, and a PDF
 * render must never depend on an external API being up.
 */
export type DayWeatherSnapshot = {
  temp_max: number | null;
  temp_min: number | null;
  rain_chance: number | null;
  /** WMO code; null for climate normals (an average has no single condition). */
  code: number | null;
  /** "forecast" = a real forecast for that date; "normals" = the climate average. */
  source: "forecast" | "normals";
  /** ISO timestamp — the document prints when the reading was taken. */
  fetched_at: string;
};

/** One day of the «البرنامج اليومي». Date + city are derived (see lib/offer/itinerary). */
export type DraftDay = {
  /** 1-based position in the program. */
  day_number: number;
  date: string | null;
  city_name: string;
  title: string;
  activities: string[];
  weather: DayWeatherSnapshot | null;
  /** true when the text came from the AI and no human has edited it since. */
  ai_generated: boolean;
};

export type DraftPricing = {
  items: DraftPricingItem[];
  display_currency: string;
  /** rounded client-facing total (sell); editable override. */
  final_total: number | null;
};

/**
 * Provenance when the draft was seeded from a ready-made company package
 * («العروض الجاهزة»). Drives the fixed-price notice and the season-window
 * warning; never reaches the client document — produceOfferFromDraft does not
 * map it into the offer.
 */
export type DraftSource = {
  ready_offer_id: string;
  code: string;
  tier: string;
  title: string;
  valid_from: string | null;
  valid_to: string | null;
};

export type DraftData = {
  customer: DraftCustomer;
  trip: DraftTrip;
  /** which service families this offer covers; drives stage visibility. */
  scope: DraftScope;
  cities: DraftCity[];
  hotels: DraftHotel[];
  flights: DraftFlight[];
  transport: DraftTransport[];
  services: DraftServices;
  visas: DraftVisa[];
  /** day-by-day program; derived from trip+cities, text authored or AI-drafted. */
  days: DraftDay[];
  pricing: DraftPricing;
  /** set once the draft has been produced into a real offer. */
  produced_serial: string | null;
  /** set when the draft was seeded from a ready-made package; null otherwise. */
  source: DraftSource | null;
};

export function emptyDraftData(): DraftData {
  return {
    customer: { customer_name: "", customer_phone: "", company: "", partner_company_id: null },
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
      children_ages: [],
      infant_ages: [],
      rooms: 1,
      default_room_type_name: "",
      default_board: null,
    },
    // Everything on by default: a new draft behaves exactly as it did before the
    // scope switches existed, and the agent opts OUT of what this sale excludes.
    scope: { flights: true, hotels: true, visas: true, transport: true },
    cities: [],
    hotels: [],
    flights: [],
    transport: [],
    services: { includes: [], excludes: [], terms: [] },
    visas: [],
    days: [],
    pricing: { items: [], display_currency: "SAR", final_total: null },
    produced_serial: null,
    source: null,
  };
}

/** Normalize a day list from an untrusted source (old jsonb, or a client action). */
export function normalizeDraftDays(raw: unknown): DraftDay[] {
  return Array.isArray(raw) ? raw.map(normalizeDraftDay) : [];
}

/** Backfill the day slice for drafts saved before the itinerary stage existed. */
function normalizeDraftDay(raw: unknown, index: number): DraftDay {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<DraftDay>;
  const w = d.weather && typeof d.weather === "object" ? (d.weather as Partial<DayWeatherSnapshot>) : null;
  return {
    day_number: Number.isFinite(d.day_number) ? Number(d.day_number) : index + 1,
    date: typeof d.date === "string" ? d.date : null,
    city_name: typeof d.city_name === "string" ? d.city_name : "",
    title: typeof d.title === "string" ? d.title : "",
    activities: Array.isArray(d.activities) ? d.activities.filter((a): a is string => typeof a === "string") : [],
    weather:
      w && (w.source === "forecast" || w.source === "normals")
        ? {
            temp_max: typeof w.temp_max === "number" ? w.temp_max : null,
            temp_min: typeof w.temp_min === "number" ? w.temp_min : null,
            rain_chance: typeof w.rain_chance === "number" ? w.rain_chance : null,
            code: typeof w.code === "number" ? w.code : null,
            source: w.source,
            fetched_at: typeof w.fetched_at === "string" ? w.fetched_at : "",
          }
        : null,
    ai_generated: d.ai_generated === true,
  };
}

/** Backfill tz/user-set fields on flights persisted before prompt-5 (old drafts have none). */
function normalizeDraftFlight(raw: unknown): DraftFlight {
  const f = (raw && typeof raw === "object" ? raw : {}) as Partial<DraftFlight>;
  return {
    airline: typeof f.airline === "string" ? f.airline : "",
    airline_iata: typeof f.airline_iata === "string" ? f.airline_iata.toUpperCase() : "",
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
    baggage_kg: typeof f.baggage_kg === "number" ? f.baggage_kg : null,
    baggage_pieces: typeof f.baggage_pieces === "number" ? f.baggage_pieces : null,
    cabin_baggage_kg: typeof f.cabin_baggage_kg === "number" ? f.cabin_baggage_kg : null,
    leg_order: f.leg_order === "inbound" || f.leg_order === "internal" ? f.leg_order : "outbound",
  };
}

/**
 * The one baggage line a document prints, built from whichever fields are set.
 *
 * Falls back to the legacy free text so a draft written before the split still
 * shows what the agent typed — silently dropping it would look like the airline
 * allows nothing.
 */
export function baggageLabel(f: Pick<DraftFlight, "baggage_kg" | "baggage_pieces" | "cabin_baggage_kg" | "baggage_allowance">): string {
  const parts: string[] = [];
  if (f.baggage_pieces && f.baggage_kg) parts.push(`${f.baggage_pieces} × ${f.baggage_kg} كجم`);
  else if (f.baggage_kg) parts.push(`${f.baggage_kg} كجم`);
  else if (f.baggage_pieces) parts.push(`${f.baggage_pieces} قطعة`);
  if (f.cabin_baggage_kg) parts.push(`يد ${f.cabin_baggage_kg} كجم`);
  if (parts.length > 0) return parts.join(" · ");
  return f.baggage_allowance.trim();
}

/** Merge unknown jsonb into a full DraftData (tolerates old/partial drafts). */
export function normalizeDraftData(raw: Record<string, unknown> | null | undefined): DraftData {
  const empty = emptyDraftData();
  if (!raw || typeof raw !== "object") return empty;
  const source = raw as Partial<DraftData>;
  const trip = { ...empty.trip, ...(source.trip ?? {}) };
  return {
    customer: { ...empty.customer, ...(source.customer ?? {}) },
    // ages are re-fitted to the counts: a draft saved before the ages existed has
    // none, and a hand-edited jsonb could disagree with the count.
    trip: {
      ...trip,
      children_ages: resizeAges(trip.children_ages, trip.children),
      infant_ages: resizeAges(trip.infant_ages, trip.infants),
      rooms: Math.max(Math.trunc(Number(trip.rooms)) || 1, 1),
    },
    scope: normalizeScope(source.scope),
    cities: Array.isArray(source.cities) ? source.cities : [],
    hotels: Array.isArray(source.hotels) ? source.hotels.map(normalizeDraftHotel) : [],
    flights: Array.isArray(source.flights) ? source.flights.map(normalizeDraftFlight) : [],
    transport: Array.isArray(source.transport) ? source.transport : [],
    services: { ...empty.services, ...(source.services ?? {}) },
    visas: Array.isArray(source.visas) ? source.visas : [],
    days: normalizeDraftDays(source.days),
    pricing: { ...empty.pricing, ...(source.pricing ?? {}) },
    produced_serial: typeof source.produced_serial === "string" ? source.produced_serial : null,
    source: normalizeDraftSource(source.source),
  };
}

/**
 * Old drafts have no scope key at all. Defaulting each switch to TRUE is the
 * only safe reading: a draft that already carries flights and hotels must not
 * have them silently dropped from the document by a field added afterwards.
 */
function normalizeScope(raw: unknown): DraftScope {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<DraftScope>;
  return {
    flights: s.flights !== false,
    hotels: s.hotels !== false,
    visas: s.visas !== false,
    transport: s.transport !== false,
  };
}

function normalizeDraftSource(raw: unknown): DraftSource | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<DraftSource>;
  if (typeof s.ready_offer_id !== "string" || !s.ready_offer_id) return null;
  return {
    ready_offer_id: s.ready_offer_id,
    code: typeof s.code === "string" ? s.code : "",
    tier: typeof s.tier === "string" ? s.tier : "",
    title: typeof s.title === "string" ? s.title : "",
    valid_from: typeof s.valid_from === "string" ? s.valid_from : null,
    valid_to: typeof s.valid_to === "string" ? s.valid_to : null,
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

/**
 * A day the agent deliberately left free, as opposed to one they have not
 * written yet. The two look identical in the data — the difference is the title
 * — so the check lives here rather than being re-derived in each screen.
 */
export const FREE_DAY_TITLE = "يوم حر";

export function isFreeDay(day: Pick<DraftDay, "title">): boolean {
  return day.title.trim() === FREE_DAY_TITLE;
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
export type LookupCountry = {
  id: string;
  name: string;
  /**
   * ISO-3166 alpha-2. Required by every real hotel supplier — they resolve a
   * city WITHIN a country, so a live search without this returns nothing and
   * looks like "the supplier has no hotels there".
   */
  iso2: string | null;
  cities: LookupCity[];
};
export type LookupRoomType = { id: string; name: string; hotel_id: string | null; default_board: BoardType | null };
export type LookupAirport = { id: string; name: string; code: string | null; timezone: string | null };

/**
 * One approved line from the `terms` table — the company's master lists behind
 * /offers/offer-includes, /offers/offer-not-includes and
 * /offers/terms-and-conditions. `checked` marks the ones a new offer starts with.
 */
export type TermLibraryItem = { text: string; checked: boolean };

export type TermLibrary = {
  includes: TermLibraryItem[];
  excludes: TermLibraryItem[];
  terms: TermLibraryItem[];
};

export const emptyTermLibrary = (): TermLibrary => ({ includes: [], excludes: [], terms: [] });

/** The `checked` lines only — what a brand-new draft is seeded with. */
export function defaultServicesFromLibrary(library: TermLibrary): DraftServices {
  const picked = (items: TermLibraryItem[]) => items.filter((i) => i.checked).map((i) => i.text);
  return {
    includes: picked(library.includes),
    excludes: picked(library.excludes),
    terms: picked(library.terms),
  };
}

/**
 * Match a country by name across the usual Arabic spelling variants.
 *
 * A draft's `trip.country` is free text — typed by an agent, copied from a past
 * offer, or seeded from the ready-offers sheet — while the countries table holds
 * one canonical spelling. «إندونيسيا» vs «اندونيسيا» is a real case in this
 * data, and an exact match silently shows an EMPTY city list, which reads as
 * "the system has no cities" rather than "the spelling differs".
 */
export function findLookupCountry(countries: LookupCountry[], name: string): LookupCountry | undefined {
  const fold = (v: string) =>
    v.replace(/[إأآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ـ\s]/g, "");
  const target = fold(name);
  if (!target) return undefined;
  return countries.find((c) => c.name === name) ?? countries.find((c) => fold(c.name) === target);
}

export type GeneratorLookups = {
  countries: LookupCountry[];
  roomTypes: LookupRoomType[];
  airports: LookupAirport[];
  carTypes: string[];
  /** the admin-managed includes / excludes / terms lists. */
  termLibrary: TermLibrary;
  /**
   * Partner companies that resell our files, for the customer stage's company
   * picker. Only name + colours: enough to choose and to preview the identity,
   * nothing the generator has any use for.
   */
  /** the carriers, for the flight stage's picker and the document's marks. */
  airlines: { iata: string; name: string; logo_url: string | null }[];
  partners: {
    id: string;
    name: string;
    name_latin: string | null;
    logo_url: string | null;
    brand_color: string;
    accent_color: string;
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    website: string | null;
    email: string | null;
  }[];
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
