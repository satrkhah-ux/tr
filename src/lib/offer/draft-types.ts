/**
 * Package-generator draft model — THE contract between the stage pages, the
 * generator shell, validation, the preview document and the drafts repo.
 *
 * A draft is one `offer_drafts` row whose `data` jsonb holds these slices.
 * Every stage edits ONLY its slice; the shell merges + auto-saves. Pure module:
 * no React, no Supabase — safe to import anywhere (client, server, tests).
 */

import type { FinanceTerm } from "./finance-terms";
import type { BoardType, FlightLegOrder, PricingItemType } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { normalizeAdvanced, withAdvancedTransport, type DraftAdvanced } from "./advanced";
import { withFlightTotals } from "./flight-fare";
import { classifyRoomName, roomName, ROOM_CATEGORIES, ROOM_TYPES, SUITE_SUBTYPES } from "@/lib/catalog/room-catalog";

// ---------- stage registry ----------
export const STAGE_KEYS = [
  // FIRST, and deliberately: these switches decide which of the stages below
  // exist at all, so choosing them last meant filling in a wizard whose shape
  // was still undecided.
  "scope",
  "customer",
  "trip",
  "cities",
  // «الفنادق» no longer has a card of its own — the stays are edited inside
  // their city. The KEY stays: issues are still attributed to it, invariants
  // still name it, and /hotels deep links still have to land somewhere.
  "hotels",
  "flights",
  "transport",
  "services",
  "terms",
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
  // No `scope` entry: «البرنامج يشمل» is answered on the trip card, with the
  // country and the dates it belongs beside. The KEY stays — stage statuses are
  // typed by it and /scope still has to land somewhere.
  { key: "customer", labelKey: "pg.stage.customer" },
  { key: "trip", labelKey: "pg.stage.trip" },
  // The flights come BEFORE the cities: where the group lands and when is what
  // the cities and their nights are measured from.
  { key: "flights", labelKey: "pg.stage.flights" },
  // No `hotels` entry on purpose: the stays live inside the city card, so a
  // separate chip would point at a screen the agent has already filled in.
  { key: "cities", labelKey: "pg.stage.cities" },
  // How the group moves — after the cities, because the vehicles follow from
  // where they stay and how many times they change city.
  { key: "transport", labelKey: "pg.stage.transport" },
  { key: "services", labelKey: "pg.stage.services" },
  { key: "terms", labelKey: "pg.stage.terms" },
  { key: "visas", labelKey: "pg.stage.visas" },
  { key: "itinerary", labelKey: "pg.stage.itinerary" },
  { key: "pricing", labelKey: "pg.stage.pricing", gated: true },
  { key: "preview", labelKey: "pg.stage.preview" },
];

export function stageHref(draftId: string, stage: StageKey): string {
  return `/package-generator/${draftId}/${stage}`;
}

/**
 * Where "open this draft" goes — the card flow.
 *
 * Every caller used to pick its own entry stage, and they disagreed: creating
 * landed on «الخدمات», duplicating and continuing on «العميل». One address.
 */
export function draftHref(draftId: string): string {
  // the owner (2026-10-17): «العمل بالكامل على النظام البيسك» — every «open this file» lands in Basic
  return `/basic/${draftId}`;
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
    const keys = STAGE_SCOPE[s.key];
    // A stage lives while ANY of its switches is on — «الطيران» is governed by
    // two of them now, and a file with the international leg off and a
    // domestic hop on must keep the stage that holds that hop.
    return keys ? keys.some((k) => scope[k]) : true;
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
   * A room-type NAME: a catalogue type's Arabic label («جناح»), which every
   * city's room inherits with its codes (roomFromName). An older draft may hold
   * a free-text name; it is kept as typed.
   */
  default_room_type_name: string;
  /**
   * The same answer as `meal_plan`, in the suppliers' and the database's
   * vocabulary. DERIVED from it on write, never typed — the hotel rows need a
   * real BoardType for validation and for the per-stay line on the document.
   */
  default_board: BoardType | null;
  /**
   * What the client is fed, as the client is asked it: «غداء» and «عشاء» are
   * different answers, and BoardType cannot tell them apart. Null on a draft
   * saved before the question existed.
   */
  meal_plan: MealPlan | null;
  /**
   * Trip-wide flight baggage, typed once and copied into every NEW leg.
   *
   * International and domestic are separate because they genuinely differ: a
   * 30 kg international ticket routinely allows 20 on the domestic hop, and one
   * pair of numbers meant correcting every internal row by hand.
   */
  baggage_intl_pieces: number | null;
  baggage_intl_kg: number | null;
  baggage_intl_cabin_kg: number | null;
  baggage_dom_pieces: number | null;
  baggage_dom_kg: number | null;
  baggage_dom_cabin_kg: number | null;
};

/** «الوجبات» — the five answers an agent is actually given on the phone. */
export type MealPlan = "none" | "breakfast" | "lunch" | "dinner" | "all";

export const MEAL_PLANS: MealPlan[] = ["none", "breakfast", "lunch", "dinner", "all"];

/**
 * The board a meal plan BOOKS as.
 *
 * Lunch and dinner both book HB: the CHECK on offer_hotels.board_type admits
 * five codes and not one of them can say WHICH meal. So the exact word travels
 * in the free-text meals column and in the «يشمل» line instead of in the enum.
 */
export const MEAL_PLAN_BOARD: Record<MealPlan, BoardType> = {
  none: "RO",
  breakfast: "BB",
  lunch: "HB",
  dinner: "HB",
  all: "FB",
};

/** Document wording — Arabic in the module, like TRANSPORT_MODE_AR. */
export const MEAL_PLAN_AR: Record<MealPlan, string> = {
  none: "بدون وجبات",
  breakfast: "إفطار فقط",
  lunch: "غداء",
  dinner: "عشاء",
  all: "كل الوجبات",
};

export const MEAL_PLAN_LABEL_KEYS: Record<MealPlan, TranslationKey> = {
  none: "pg.meals.none",
  breakfast: "pg.meals.breakfast",
  lunch: "pg.meals.lunch",
  dinner: "pg.meals.dinner",
  all: "pg.meals.all",
};

/**
 * An old draft answered this question as a BOARD. Read back only what is
 * unambiguous — «HB» stays unanswered, because it is either meal and guessing
 * one would promise the client a lunch nobody bought.
 */
const BOARD_MEAL_PLAN: Partial<Record<BoardType, MealPlan>> = {
  RO: "none",
  BB: "breakfast",
  FB: "all",
  AI: "all",
};

/**
 * The «يشمل» line that states the meals — the ONLY way the exact word reaches
 * the client, because the document prints board codes and never reads
 * offer_cities.meals.
 */
export function mealPlanIncludeLine(trip: Pick<DraftTrip, "meal_plan">): string | null {
  if (!trip.meal_plan || trip.meal_plan === "none") return null;
  return `الوجبات: ${MEAL_PLAN_AR[trip.meal_plan]}`;
}

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
  hotels: boolean;
  /** «الطيران الدولي» — the outbound and inbound legs. */
  flights_intl: boolean;
  /** «الطيران الداخلي» — the `internal` legs, a hop inside the destination. */
  flights_domestic: boolean;
  transport: boolean;
  /** «الخدمات» — whether this sale includes ground services at all. */
  services: boolean;
  visas: boolean;
};

/**
 * The switches that keep a stage in the rail — a stage lives while ANY of them
 * is on.
 *
 * «المواصلات» and «الخدمات» map to NOTHING on purpose. Transport has no stage:
 * how a group moves is three answers about vehicles, not a table of journeys,
 * so it lives on the trip card and appears as a note on the day it happens.
 * And the services stage holds the «يشمل / لا يشمل» lists every document
 * prints — hiding it would publish an offer that promises nothing.
 */
export const STAGE_SCOPE: Partial<Record<StageKey, (keyof DraftScope)[]>> = {
  hotels: ["hotels"],
  transport: ["transport"],
  flights: ["flights_intl", "flights_domestic"],
  visas: ["visas"],
};

export const SCOPE_KEYS: (keyof DraftScope)[] = [
  "hotels",
  "flights_intl",
  "flights_domestic",
  "transport",
  "services",
  "visas",
];

export const SCOPE_LABEL_KEYS: Record<keyof DraftScope, TranslationKey> = {
  hotels: "pg.stage.hotels",
  flights_intl: "pg.scope.flightsIntl",
  flights_domestic: "pg.scope.flightsDomestic",
  transport: "pg.stage.transport",
  services: "pg.stage.services",
  visas: "pg.stage.visas",
};

/**
 * Grow/shrink an ages list to match a traveler count, preserving what was typed.
 * Pure — the same helper backs both the children and the infant lists.
 */
/**
 * What an airline and a hotel mean by these words, and therefore what the
 * boxes may contain.
 *
 * The form used to accept any non-negative number: a «طفل» of 31 and a «رضيع»
 * of 74 both saved happily, and both reach the supplier as a real passenger
 * age — where the booking is refused, or priced as an adult, long after the
 * client was quoted.
 *
 * 2–11 is the near-universal child band; an infant is under 2 and travels on
 * the lap. A 12-year-old is an adult to every supplier we deal with, which is
 * why the ceiling is 11 and not 17.
 */
export const AGE_BANDS = {
  children: { min: 2, max: 11, fallback: 6 },
  infants: { min: 0, max: 1, fallback: 1 },
} as const;

/** Force a typed age into its band. The form clamps; this is the guarantee. */
export function clampAge(kind: keyof typeof AGE_BANDS, raw: number): number {
  const band = AGE_BANDS[kind];
  const n = Math.trunc(raw);
  if (!Number.isFinite(n)) return band.fallback;
  return Math.min(Math.max(n, band.min), band.max);
}

export function resizeAges(ages: number[], count: number, fallback = 0): number[] {
  const n = Math.max(Math.trunc(count) || 0, 0);
  const safe = Array.isArray(ages) ? ages : [];
  return Array.from({ length: n }, (_, i) => {
    const v = safe[i];
    return Number.isFinite(v) && v >= 0 ? Number(v) : fallback;
  });
}

export type DraftCity = {
  /**
   * This stop's own identity — a city visited twice (كوالالمبور first and last)
   * is two stops with two sets of hotels. Filled by normalizeDraftData (see
   * cityKeys); a hotel line points at it through `city_key`.
   */
  key?: string;
  city_name: string;
  nights: number;
  /** true when the flights put this city here (and decide its nights). */
  from_flight?: boolean;
  /**
   * Set only when the city lies outside `trip.country` — a neighbour the group
   * crosses into. Hotel search, supplier rates and markup rules read it through
   * `cityCountry`; everything else keys on the city's name.
   */
  country?: string;
  /** How many of the city's days are tour days (the basic screen asks it per city). */
  tours?: number;
  /** The tours chosen for those days, in order — a ready programme or a typed title, each with its price. */
  tour_picks?: TourPick[];
  /**
   * The group gets here the day AFTER it leaves the city before — an evening
   * domestic flight that lands past midnight. That night is spent travelling, in
   * no hotel: it is one of the trip's nights but no city's (travelNights).
   * Never on the first city.
   */
  arrives_next_day?: boolean;
  /**
   * The trip's edges (the owner, 2026-10-18, «بكج متقدم»), read on the FIRST
   * city only: «prev_night» books the night before the arrival (a 03:00 landing
   * walks straight in), «early_checkin» asks for it, «no_hotel» spends the
   * arrival night elsewhere — the hotel starts the next day.
   */
  edge_in?: ArrivalEdge;
  /**
   * Read on the LAST city only: «no_hotel_day» checks out at noon the day before
   * a small-hours flight and keeps the car (and a tour) until the airport — no
   * hotel that last night; «late_checkout» asks for it.
   */
  edge_out?: DepartureEdge;
  /**
   * The visit's services other than its tours — what the agent changed on the
   * reception / farewell / transfer the trip writes, and the rows they added
   * (CityService). Absent on every file from before: the trip's rows as they were.
   */
  services?: CityService[];
  /**
   * «فندق العميل (محجوز من خارجنا)» — the hotel the client booked himself (the
   * owner, 2026-10-25). In a sale without hotels it is where each city sleeps;
   * in a sale with them, its presence marks the city as the client's own: no
   * hotel line of ours there (soldHotels). Absent on every file from before.
   */
  client_hotel?: ClientHotel;
  /** derived from trip.arrival_date + the nights chain (deriveCityDates). */
  check_in: string | null;
  check_out: string | null;
};

/** «الحجز من» — where the client booked his own hotel. */
export type ClientHotelSource = "app" | "company" | "client";
export const CLIENT_HOTEL_SOURCES: ClientHotelSource[] = ["app", "company", "client"];
export const CLIENT_HOTEL_SOURCE_AR: Record<ClientHotelSource, string> = { app: "تطبيق", company: "شركة أخرى", client: "العميل نفسه" };

/**
 * A hotel the client booked outside us. Never priced, never a booking or a
 * voucher, never a hotel line — only the place the cars pick the group up from
 * and drop it at, and the programme's «الإقامة: … — حجز العميل».
 */
export type ClientHotel = {
  name: string;
  /** the catalogue's hotel when picked from it (its address and phone came with it). */
  hotel_id?: string | null;
  /** its own nights inside the city's; absent (or outside them) — the city's (clientHotelDates). */
  check_in?: string | null;
  check_out?: string | null;
  /** an address or a map link. */
  address?: string;
  phone?: string;
  source?: ClientHotelSource;
};

/** «فندق X (حجز العميل)» — a stop's own hotel of the client's as a car's pickup or drop point; null without one. */
export function clientHotelPlace(city: Pick<DraftCity, "client_hotel"> | undefined): string | null {
  const name = city?.client_hotel?.name.trim();
  return name ? `فندق ${name.replace(/^فندق\s+/, "")} (حجز العميل)` : null;
}

/** The client hotel's nights: each of its own days while it sits inside the city's, else the city's. */
export function clientHotelDates(city: Pick<DraftCity, "client_hotel" | "check_in" | "check_out">): { check_in: string | null; check_out: string | null } {
  const inCity = (d: string | null | undefined): d is string => Boolean(d && city.check_in && city.check_out && d >= city.check_in && d <= city.check_out);
  const own = city.client_hotel;
  const check_in = inCity(own?.check_in) ? own.check_in : city.check_in;
  const check_out = inCity(own?.check_out) ? own.check_out : city.check_out;
  return check_in && check_out && check_in < check_out ? { check_in, check_out } : { check_in: city.check_in, check_out: city.check_out };
}

/**
 * The hotel lines this file SELLS — priced, issued, pulled into operations: none
 * when the sale has no hotels (a line Basic made for a city before the switch
 * went off is not a hotel the client buys), and never one of a stop whose hotel
 * the client booked himself. A file with hotels and no such stop: its lines as
 * they are, the same array.
 */
export function soldHotels(data: Pick<DraftData, "scope" | "cities" | "hotels">): DraftHotel[] {
  if (!data.scope.hotels) return [];
  if (!data.cities.some((c) => c.client_hotel)) return data.hotels;
  const theirs = new Set(data.cities.flatMap((c, i) => (c.client_hotel ? cityHotelLines(data.cities, data.hotels, i) : [])));
  return data.hotels.filter((h) => !theirs.has(h));
}

/** What a row of a city visit's services table is. A tour is its TourPick; the others are transport rows. */
export type ServiceKind = "reception" | "farewell" | "transfer" | "tour";
export const SERVICE_KINDS: ServiceKind[] = ["reception", "farewell", "transfer", "tour"];

/**
 * One service of a city visit other than a tour. `id` "in" is the visit's way
 * in (met at the airport, or driven from the city before) and "out" its way out
 * to the airport — rows the trip writes itself (deriveTransportRows), so the
 * entry holds only what the agent changed on them. Any other id is a row the
 * agent added («+ إضافة خدمة»).
 */
export type CityService = {
  id: string;
  /** absent on "in" / "out": what the trip makes it. */
  kind?: Exclude<ServiceKind, "tour">;
  /** an added row's day — one of the visit's; "in" / "out" are dated by the trip. */
  date?: string | null;
  /** the row's own words; absent — what the trip says. */
  text?: string;
  /** its own car and how many; absent — the plan's leg. */
  car_type?: string;
  cars?: number;
  /** one car's price, in riyals like a tour's; absent — the price list's. */
  price?: number | null;
  /** an "in" / "out" row the agent took away. */
  removed?: boolean;
};

/** The ids of the rows the trip writes for a visit — its way in and out, and each move to another hotel (hotelMoves). */
export const isTripService = (id: string) => id === "in" || id === "out" || id.startsWith(HOTEL_MOVE);
const HOTEL_MOVE = "hotel:";

/** An added row's words until the agent types their own. */
export const inCityTransferText = (city: string) => `التوصيل داخل ${city.trim()}`;

/** An added row's day: its own while the visit still has it, else the visit's first. */
export function serviceDate(city: Pick<DraftCity, "check_in" | "check_out">, s: Pick<CityService, "date">): string | null {
  const inside = s.date && city.check_in && s.date >= city.check_in && s.date <= (city.check_out ?? s.date);
  return inside ? s.date! : city.check_in;
}

/** One tour day of a city: what it is (a tour_programs row, or typed) and what it costs the group. */
export type TourPick = {
  program_id: string | null;
  title: string;
  /** the programme's description — the day's activity on the document. */
  text: string;
  price: number | null;
  /** the day it is on (one of the city's dates); absent — the next free day takes it. */
  date?: string | null;
  /** the car it goes in, when it is not the trip's tour car. */
  car_type?: string;
  /**
   * How many of that car. A tour is priced per car (ق3), so this is the line's
   * quantity. A pick is born with the trip's tour cars; one written before the
   * count priced the group once, and still counts as one (tourCars).
   */
  cars?: number;
  /** «يوم حر» — a day the agent keeps open on purpose; never priced, never counted as a tour. */
  free?: boolean;
  /**
   * «جولة قبل المغادرة» — put by the agent on the day the group flies home (the
   * last city only): its day is always that day. Without the mark a date on the
   * departure day is a stale one and the tour takes a night of the city.
   */
  departure?: boolean;
  /**
   * Put there by the screen from the city's programmes (autoTourPicks), not
   * chosen by the agent: it goes first when the count comes down, and the
   * agent's first edit of the row makes it theirs.
   */
  auto?: boolean;
};

/** How many cars a tour goes in — at least one, whatever the jsonb holds. */
export function tourCars(pick: Pick<TourPick, "cars">): number {
  return Math.max(Math.trunc(Number(pick.cars)) || 1, 1);
}

/** The car a tour goes in — its own, else the trip's tours car — and how many: «فان × 2». */
export function tourVehicle(pick: Pick<TourPick, "car_type" | "cars">, tripCar: string): string {
  return vehicleText({ car_type: pick.car_type?.trim() || tripCar, cars: tourCars(pick) });
}

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
  /** the stay this rate was quoted for (server-written, see sourcingFits). */
  quoted_for?: SourcingQuote | null;
};

/** A supplier quote is for ONE stay: these dates, this many rooms and guests, this hotel. */
export type SourcingQuote = {
  check_in: string;
  check_out: string;
  rooms: number;
  adults: number;
  children: number;
  hotel_name: string;
  /** the one room product the rate is for — a BB rate does not price an AI stay */
  board_type: BoardType | null;
  room_name: string;
};

/**
 * One booked room. A city often needs more than one and they are not alike — a
 * double for the family plus a single that is really the driver's, which is
 * booked but never labelled as such on the client document.
 */
export type DraftRoomSpec = {
  /** LEGACY: a row of the old per-hotel room_types table. New picks leave it null; normalize drops it. */
  room_type_id: string | null;
  /**
   * The room's printed name, in Arabic: roomPickName(codes) for a room picked
   * from the catalogue, or the text an older file was saved with. Pricing lines,
   * the per-night rate memory, partner sheets and offer_hotels key on it.
   */
  room_type_name: string;
  /** The owner's catalogue (src/lib/catalog/hotel-room-catalog.json): type, category, suite type ids. */
  room_type_code?: string | null;
  room_category_code?: string | null;
  suite_subtype_code?: string | null;
  /**
   * «اسم الغرفة عند الفندق» — the hotel's own name for the room (hotels name
   * theirs differently), optional free text. Printed beside the catalogue's
   * name, never a pricing key: prices and the rate memory stay on room_type_name.
   */
  hotel_room_name?: string;
  /**
   * «الإطلالة» (the owner, 2026-10-29): the catalogue's view in Arabic, or one
   * the employee added (catalog-additions.ts). Printed with the room's name,
   * never a pricing key.
   */
  room_view?: string;
  board_type: BoardType | null;
  /**
   * What THIS room costs for the whole stay.
   *
   * Per room, because a file routinely books two different ones — a double for
   * the parents and a triple for the children — and one price for the line
   * either overcharged for the smaller or undercharged for the larger. Null
   * means «not priced yet», which is not the same as free.
   */
  price: number | null;
};

export function emptyRoomSpec(): DraftRoomSpec {
  return { room_type_id: null, room_type_name: "", board_type: null, price: null };
}

/** The longest hotel's room name kept — a name, not a note. */
export const HOTEL_ROOM_NAME_MAX = 60;

/** The hotel's own name for a room, trimmed and capped; "" when there is none (every older file). */
export const hotelRoomName = (room: { hotel_room_name?: unknown }): string =>
  typeof room.hotel_room_name === "string" ? room.hotel_room_name.trim().slice(0, HOTEL_ROOM_NAME_MAX).trim() : "";

/** The room as the client reads it — «غرفة مزدوجة — Deluxe Sea View»; the catalogue's name alone when the hotel's is not given. */
export const roomLabel = (room: Pick<DraftRoomSpec, "room_type_name" | "hotel_room_name" | "room_view">): string =>
  [room.room_type_name.trim(), hotelRoomName(room), roomView(room)].filter(Boolean).join(" — ");

/** The room's view, trimmed and capped; "" when none was given (every older file). */
export const roomView = (room: { room_view?: unknown }): string =>
  typeof room.room_view === "string" ? room.room_view.trim().slice(0, HOTEL_ROOM_NAME_MAX).trim() : "";

export type RoomCodes = Required<Pick<DraftRoomSpec, "room_type_code" | "room_category_code" | "suite_subtype_code">>;

/** The catalogue room in Arabic — «غرفة مزدوجة | الفئة: ديلوكس»; "" with no type. */
export function roomPickName(codes: Partial<RoomCodes>): string {
  const spec = { room_type_id: codes.room_type_code ?? null, room_category_id: codes.room_category_code, suite_subtype_id: codes.suite_subtype_code };
  return roomName(spec, "ar").name ?? "";
}

/** A room picked from the catalogue: its codes and the Arabic name they make. A category needs a type; a suite type, a suite. */
export function pickRoom(codes: Partial<RoomCodes>): Pick<DraftRoomSpec, "room_type_id" | "room_type_name"> & RoomCodes {
  const type = codes.room_type_code || null;
  const picked: RoomCodes = {
    room_type_code: type,
    room_category_code: (type && codes.room_category_code) || null,
    suite_subtype_code: (type === "suite" && codes.suite_subtype_code) || null,
  };
  return { room_type_id: null, room_type_name: roomPickName(picked), ...picked };
}

// every name a pick can make (~200), so a picked name reads back exactly — suite types included
const PICKED_NAMES = new Map<string, RoomCodes>();
for (const type of ROOM_TYPES) {
  for (const category of [null, ...ROOM_CATEGORIES]) {
    for (const suite of type.id === "suite" ? [null, ...SUITE_SUBTYPES] : [null]) {
      const codes = { room_type_code: type.id, room_category_code: category?.id ?? null, suite_subtype_code: suite?.id ?? null };
      PICKED_NAMES.set(roomPickName(codes), codes);
    }
  }
}

/** The codes a name stands for: a catalogue name exactly, else what an older free-text name reads as. */
export function codesFromName(name: string): RoomCodes {
  const text = name.trim();
  const exact = PICKED_NAMES.get(text);
  if (exact) return exact;
  const read = text ? classifyRoomName(text) : { room_type_id: null, room_category_id: null };
  return { room_type_code: read.room_type_id, room_category_code: read.room_category_id, suite_subtype_code: null };
}

/** A room named by text (the trip default, the add bar): that name kept, its codes beside it. */
export function roomFromName(name: string): Pick<DraftRoomSpec, "room_type_id" | "room_type_name"> & RoomCodes {
  return { room_type_id: null, room_type_name: name, ...codesFromName(name) };
}

/** What a picker shows for a room: its own codes, else what its saved name reads as. */
export function roomCodes(room: Pick<DraftRoomSpec, "room_type_name" | "room_type_code" | "room_category_code" | "suite_subtype_code">): RoomCodes {
  if (!room.room_type_code) return codesFromName(room.room_type_name);
  return { room_type_code: room.room_type_code, room_category_code: room.room_category_code ?? null, suite_subtype_code: room.suite_subtype_code ?? null };
}

/**
 * A room as saved, made current: a room from before the catalogue gets the
 * codes its name reads as (only when it reads something), and its NAME stays
 * as it was — an old file prints and prices exactly as before. The old table's
 * id is dropped: those rows are being deleted, and an offer_hotels insert
 * naming a deleted row fails its foreign key.
 */
function cataloguedRoom(room: DraftRoomSpec): DraftRoomSpec {
  const next = { ...room, room_type_id: null, room_type_name: typeof room.room_type_name === "string" ? room.room_type_name : "" };
  if (room.room_type_code) return next;
  const codes = codesFromName(next.room_type_name);
  return codes.room_type_code || codes.room_category_code ? { ...next, ...codes } : next;
}

/**
 * The rooms' types as one line — «ديلوكس × 2 + جناح». A stay booking two
 * different rooms printed only the first one's type.
 */
export function roomTypesText(
  rooms: Pick<DraftRoomSpec, "room_type_name" | "hotel_room_name" | "room_view" | "board_type">[],
  /** the board's printed name — given, so rooms on different boards say which is which. */
  boardLabel?: (board: BoardType) => string,
): string {
  const boards = new Set(rooms.map((r) => r.board_type ?? ""));
  const counts = new Map<string, number>();
  for (const r of rooms) {
    const name = roomLabel(r);
    if (!name) continue;
    const board = boards.size > 1 && r.board_type && boardLabel ? ` (${boardLabel(r.board_type)})` : "";
    const key = `${name}${board}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} × ${n}` : name)).join(" + ");
}

/**
 * What the whole stay costs — every room added up.
 *
 * Null when no room carries a price at all, so «unpriced» stays
 * distinguishable from «free»; a half-priced stay returns what it knows,
 * because a partial total the agent can see beats a blank they cannot.
 */
export function stayTotal(line: Pick<DraftHotel, "rooms" | "manual_price">): number | null {
  const priced = line.rooms.filter((r) => r.price != null);
  if (priced.length > 0) return priced.reduce((sum, r) => sum + (r.price ?? 0), 0);
  // A line written before rooms carried their own price keeps answering with
  // the single figure it was given, multiplied by the rooms it covers.
  if (line.manual_price != null) return line.manual_price * Math.max(line.rooms.length, 1);
  return null;
}

/**
 * What a stay's price is typed as: the NIGHT's rate, of one room while its
 * rooms cost the same — one night of them all when they do not (Order 5,
 * 2026-10-24: the sheet said «× 1» and 320 for two nights). The figure stored
 * stays the whole stay's, so keepNightlyRates, the sheet's totals and every
 * document read what they always read; only the fields divide and multiply.
 */
export function stayUnits(line: Pick<DraftHotel, "rooms">, nights: number): { rooms: number; nights: number } {
  const first = line.rooms[0]?.price ?? null;
  return { rooms: line.rooms.every((r) => r.price === first) ? Math.max(line.rooms.length, 1) : 1, nights: Math.max(nights, 1) };
}

/** A stored total as the rate typed (to the cent) — and back. */
export const perUnit = (total: number | null, units: number) => (total == null ? null : Math.round((total / Math.max(units, 1)) * 100) / 100);
export const fromUnit = (rate: number | null, units: number) => (rate == null ? null : Math.round(rate * Math.max(units, 1) * 100) / 100);

/** A stay's line on the pricing sheet, as typed (stayUnits); null for any other line, or one already × a count. */
export function sheetStayUnits(
  data: Pick<DraftData, "cities" | "hotels">,
  item: Pick<DraftPricingItem, "item_type" | "ref" | "quantity">,
): { rooms: number; nights: number } | null {
  if (item.item_type !== "hotel" || item.quantity !== 1) return null;
  const stay = deriveHotelStays(data.cities, data.hotels).find((s) => pricingRefFor(s) === item.ref);
  return stay ? stayUnits(stay.line, stay.nights) : null;
}

/** One hotel line per city (aligned by city_name). Prices live in the pricing stage. */
export type DraftHotel = {
  /**
   * The second half of a room change (basic.ts changeRoom): the same hotel, another room. Told apart
   * from a second hotel stay by this mark when neither has a hotel yet — two empty rows are two stays.
   */
  room_change?: boolean;
  /**
   * Stable identity for THIS stay.
   *
   * Two hotels in one city stopped being distinguishable by name the moment a
   * city could hold more than one, and the pricing item that follows a stay has
   * to point at something that survives a rename. Legacy lines have no id and
   * are matched by description instead — see `pricingRefFor`.
   */
  id: string;
  city_name: string;
  /**
   * The stop this line belongs to (DraftCity.key). Absent on lines written
   * before a city could repeat — those still match their city by name.
   */
  city_key?: string;
  /**
   * When this stay is, inside its city (absent = "after"):
   *   "after"  — starts where the previous stay of the city ended;
   *   "same"   — the previous stay's dates, its rooms split over two hotels;
   *   "custom" — from `check_in` for `nights`, typed by the agent.
   */
  dates?: StayDates;
  /** the first night of a "custom" stay. */
  check_in?: string | null;
  /**
   * Nights THIS line covers, inside its city.
   *
   * The unit of the whole stage: a city's nights are covered by one or more
   * stays in sequence, and «مكتمل» now means covered, not "a row exists".
   */
  nights: number;
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
  /**
   * The nights this stay's prices were set for (keepNightlyRates). The prices
   * are whole-stay totals; when the stay's nights become anything else they are
   * rescaled to the same rate a night and this follows. Absent on older lines.
   */
  priced_nights?: number;
  /**
   * «مسترد / غير مسترد» — for a stay we price ourselves (a supplier rate carries
   * its own cancellation policy). Undefined/null = not said; nothing prints.
   */
  refundable?: boolean | null;
  /** refundable until this date (YYYY-MM-DD); only with refundable === true. */
  refundable_until?: string | null;
  /**
   * Who the stay was booked through (company_suppliers) when the agent typed
   * the price. Internal: never on the client document.
   */
  supplier?: string;
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

/**
 * Re-apply a changed trip default to the rooms that still carry the old one.
 *
 * The rule, stated once: a room still holding the inherited value follows the
 * default; a room the agent typed over keeps its own. There is no dirty flag —
 * value equality IS the flag.
 *
 * Per ROOM, not per line: a city where the agent deliberately booked a second,
 * different room (the driver's, which is never labelled as such) keeps it,
 * while its first room still follows the trip.
 */
export function inheritRoomType(line: DraftHotel, from: string, to: string): DraftHotel {
  return withRooms(
    line,
    line.rooms.map((r) =>
      r.room_type_name === from ? { ...r, ...roomFromName(to) } : r,
    ),
  );
}

/** Same, for the board — which now follows the trip's meal plan. */
export function inheritBoard(line: DraftHotel, from: BoardType | null, to: BoardType | null): DraftHotel {
  return withRooms(
    line,
    line.rooms.map((r) => (r.board_type === from ? { ...r, board_type: to } : r)),
  );
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
    price: null,
  };
  // An old line described ONE room and a count; every room was that room.
  const rawRooms =
    Array.isArray(h.rooms) && h.rooms.length > 0 ? h.rooms : Array.from({ length: count }, () => ({ ...legacy }));
  // Rooms saved before they carried a price get the field, empty. The line's
  // own `manual_price` is NOT copied onto each of them: it was one figure for
  // one room, and writing it into three would treble the stay on sight.
  const rooms = rawRooms.map((r) =>
    cataloguedRoom({
      ...emptyRoomSpec(),
      ...(r && typeof r === "object" ? (r as Partial<DraftRoomSpec>) : {}),
      price: typeof (r as Partial<DraftRoomSpec>)?.price === "number" ? (r as DraftRoomSpec).price : null,
    }),
  );
  const base: DraftHotel = {
    // A missing id means a draft written before a city could hold two hotels.
    // It gets one now; the pricing item that references it by description keeps
    // matching, because `pricingRefFor` falls back to the description.
    id: typeof h.id === "string" && h.id ? h.id : newStayId(),
    city_name: typeof h.city_name === "string" ? h.city_name : "",
    // 0 is meaningful ("not split yet") and distinct from a real 1-night stay:
    // deriveHotelStays reads 0 as "take whatever the city has left".
    nights: Number.isFinite(Number(h.nights)) ? Math.max(0, Math.trunc(Number(h.nights))) : 0,
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
    // absent on every older line: "after" by name — exactly what it always meant
    ...(typeof h.city_key === "string" && h.city_key ? { city_key: h.city_key } : {}),
    ...(h.dates === "same" || h.dates === "custom" ? { dates: h.dates } : {}),
    ...(h.dates === "custom" && typeof h.check_in === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.check_in) ? { check_in: h.check_in } : {}),
    ...(typeof h.refundable === "boolean" ? { refundable: h.refundable } : {}),
    ...(h.refundable === true && typeof h.refundable_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.refundable_until)
      ? { refundable_until: h.refundable_until }
      : {}),
    ...(typeof h.supplier === "string" && h.supplier ? { supplier: h.supplier } : {}),
    ...(typeof h.priced_nights === "number" && h.priced_nights > 0 ? { priced_nights: h.priced_nights } : {}),
    ...(h.room_change === true ? { room_change: true } : {}),
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
  /**
   * The catalogue cities the two airports belong to (airports.city_id), or ""
   * when the airport is not linked. The cities card is built from these: the
   * outbound flight's landing city is the first city, each domestic flight's
   * landing city the next one.
   */
  from_city?: string;
  to_city?: string;
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
  /** a domestic leg the cities wrote (a hop made by air) — rewritten or dropped with them. */
  auto?: boolean;
  /**
   * The leg's own identity — what an edit finds it by, so changing its airports
   * never makes it a new leg (or a second one). Filled by normalizeDraftData for
   * a leg saved before it existed.
   */
  id?: string;
  /**
   * A domestic leg's ticket, «للفرد» (the evaluator, 2026-10-24: 300 + 300 for two adults is 1,200, not 600):
   * the legs add up to the domestic booking's per-person fare, which the travellers multiply (withLegFares).
   */
  price?: number | null;
};

/** Ids only have to be unique inside one draft. */
export const newLegId = () => `leg-${Math.random().toString(36).slice(2, 10)}`;

/**
 * What most of our tickets allow, written into every new leg so the agent only
 * touches the one flight that differs: international 1 × 25 kg + 7 kg in the
 * cabin, domestic 1 × 15 kg + 7 kg.
 */
export const FLIGHT_BAGGAGE = {
  intl: { pieces: 1, kg: 25, cabin_kg: 7 },
  domestic: { pieces: 1, kg: 15, cabin_kg: 7 },
} as const;

/**
 * A new leg. Baggage starts from FLIGHT_BAGGAGE (or from the trip's own numbers
 * on an older draft that set them).
 *
 * A COPY, not a live link: the agent then corrects one leg without the trip
 * card rewriting the others behind their back.
 */
export function emptyFlight(legOrder: FlightLegOrder, trip?: DraftTrip): DraftFlight {
  const dom = legOrder === "internal";
  return {
    id: newLegId(),
    airline: "",
    airline_iata: "",
    flight_no: "",
    from_airport: "",
    to_airport: "",
    departure_at: null,
    arrival_at: null,
    from_tz: null,
    to_tz: null,
    date_user_set: false,
    cabin_class: "",
    baggage_allowance: "",
    baggage_kg: (dom ? trip?.baggage_dom_kg : trip?.baggage_intl_kg) ?? (dom ? FLIGHT_BAGGAGE.domestic : FLIGHT_BAGGAGE.intl).kg,
    baggage_pieces:
      (dom ? trip?.baggage_dom_pieces : trip?.baggage_intl_pieces) ?? (dom ? FLIGHT_BAGGAGE.domestic : FLIGHT_BAGGAGE.intl).pieces,
    cabin_baggage_kg:
      (dom ? trip?.baggage_dom_cabin_kg : trip?.baggage_intl_cabin_kg) ?? (dom ? FLIGHT_BAGGAGE.domestic : FLIGHT_BAGGAGE.intl).cabin_kg,
    leg_order: legOrder,
    from_city: "",
    to_city: "",
  };
}

/**
 * How the flights were booked — one price for the whole booking, the way the
 * agency buys it: the international tickets for every traveller as one figure,
 * the domestic hop as another. The supplier is who it was booked through.
 */
export type FlightBookingMode = "round" | "oneway" | "multi";

/**
 * How a booking's price was typed: «إجمالي» (one figure, the default and every
 * older file) or «للفرد» — a ticket per adult, per child (the adult's when
 * empty) and per infant (none when empty). Either way `intl_price`/`dom_price`
 * holds the booking total; «للفرد» recomputes it (flight-fare.ts).
 */
export type FlightFare = {
  price_mode: "total" | "per_person";
  adult_price: number | null;
  child_price: number | null;
  infant_price: number | null;
};

export type FlightBooking = {
  mode: FlightBookingMode;
  cabin: string;
  intl_price: number | null;
  intl_currency: string;
  intl_supplier: string;
  intl_fare: FlightFare;
  dom_price: number | null;
  dom_currency: string;
  dom_supplier: string;
  dom_fare: FlightFare;
  /**
   * The international route is only planned yet — the cities, the dates and an
   * approximate price. A leg without a flight number then needs only its two
   * airports and its date; the tickets («الرحلة النهائية») come later.
   */
  estimate?: boolean;
  /**
   * «أضف لاحقاً» (the owner, 2026-10-22): this part of the flights is not in
   * the file yet — not asked to go on, not priced, and the offer says
   * FLIGHTS_LATER_LINE where its flights would be. Operations still needs its
   * tickets before «جاهز للسفر» (seed-plan).
   */
  later_intl?: boolean;
  later_dom?: boolean;
};

/** What the offer says, where its flights would be, while a part of them is «أضف لاحقاً». */
export const FLIGHTS_LATER_LINE = "سيتم تأكيد الطيران لاحقاً";

/** True while a part of the flights the sale includes is left for later. */
export const flightsLater = (d: Pick<DraftData, "scope" | "flight_booking">) =>
  Boolean((d.scope.flights_intl && d.flight_booking.later_intl) || (d.scope.flights_domestic && d.flight_booking.later_dom));

export function emptyFlightBooking(): FlightBooking {
  return {
    mode: "round",
    cabin: "اقتصادية",
    intl_price: null,
    intl_currency: "SAR",
    intl_supplier: "",
    intl_fare: totalFare(),
    dom_price: null,
    dom_currency: "SAR",
    dom_supplier: "",
    dom_fare: totalFare(),
  };
}

function totalFare(): FlightFare {
  return { price_mode: "total", adult_price: null, child_price: null, infant_price: null };
}

function normalizeFlightBooking(raw: unknown): FlightBooking {
  const b = (raw && typeof raw === "object" ? raw : {}) as Partial<FlightBooking>;
  const empty = emptyFlightBooking();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  // a file from before «للفرد» is a total, with the number it had
  const fare = (value: unknown): FlightFare => {
    const f = (value && typeof value === "object" ? value : {}) as Partial<FlightFare>;
    return {
      price_mode: f.price_mode === "per_person" ? "per_person" : "total",
      adult_price: num(f.adult_price),
      child_price: num(f.child_price),
      infant_price: num(f.infant_price),
    };
  };
  return {
    mode: b.mode === "oneway" || b.mode === "multi" ? b.mode : "round",
    cabin: str(b.cabin, empty.cabin),
    intl_price: num(b.intl_price),
    intl_currency: str(b.intl_currency, "SAR") || "SAR",
    intl_supplier: str(b.intl_supplier, ""),
    intl_fare: fare(b.intl_fare),
    dom_price: num(b.dom_price),
    dom_currency: str(b.dom_currency, "SAR") || "SAR",
    dom_supplier: str(b.dom_supplier, ""),
    dom_fare: fare(b.dom_fare),
    ...(b.estimate === true ? { estimate: true } : {}),
    ...(b.later_intl === true ? { later_intl: true } : {}),
    ...(b.later_dom === true ? { later_dom: true } : {}),
  };
}

/**
 * A transport ROW as the document prints it. Derived now, not typed.
 * See TransportPlan — an agent answers three questions and these come out.
 */
export type DraftTransport = {
  from_place: string;
  to_place: string;
  car_type: string;
  date: string | null;
  note: string;
  /** the agent's words for it, from the city card's services table. */
  text?: string;
  /** one car's price typed on the city card (riyals) — the sheet takes it before the list. */
  price?: number | null;
  /** an added row's pricing ref; the trip's rows are keyed by road and car (transportRef). */
  ref?: string;
};

/** A transport row as the issued offer's «يشمل» says it: its own words, else its road — and its car. */
export const transportIncludeLine = (t: Pick<DraftTransport, "from_place" | "to_place" | "car_type" | "text">) =>
  `التوصيلات: ${t.text || `${t.from_place} ← ${t.to_place}`}${t.car_type ? ` (${t.car_type})` : ""}`;

/** The pricing line a transport row is: its road and its car, or an added row's own ref. */
export const transportRef = (tr: Pick<DraftTransport, "from_place" | "to_place" | "car_type" | "ref">) =>
  tr.ref ?? `transport:${tr.from_place}>${tr.to_place}>${tr.car_type ?? ""}`;

export type TransportMode = "car" | "flight" | "train" | "ship";

/**
 * How this group actually moves — the three questions an agent is really asked,
 * instead of a table of from/to rows they had to compose by hand.
 *
 * They are separate because the answers genuinely differ, and that difference
 * costs money: two travellers with six suitcases need a van from the airport
 * and a sedan for the day tours. One «نوع السيارة» for the whole file forced
 * the agent to price the bigger car all week, or the smaller one at arrival and
 * explain the luggage at the kerb.
 *
 * Intercity carries a MODE as well, because between cities the vehicle may not
 * be a vehicle — a domestic flight or a train is the normal answer in Turkey,
 * Japan, or Europe, and writing "سيارة" there was simply wrong.
 */
export type TransportLeg = {
  enabled: boolean;
  car_type: string;
  /**
   * How many of that vehicle. Nine travellers are two vans, and «فان» on its
   * own both priced and promised one.
   */
  cars: number;
  note: string;
};

export type TransportPlan = {
  /** airport → hotel on arrival, and hotel → airport on departure. */
  airport: TransportLeg;
  /** the day tours. */
  tours: TransportLeg;
  /**
   * moving from one city to the next. `modes` is every way the group moves
   * between cities on this trip — one country can use car, domestic flight and
   * train in the same programme — and `hop_modes` says which one each hop takes
   * (keyed by hopKey). `mode` mirrors the first of `modes` for older readers.
   */
  intercity: TransportLeg & { mode: TransportMode; modes?: TransportMode[]; hop_modes?: Record<string, TransportMode> };
  /**
   * hotel → airport on the last day, when it is not the arrival's car — the
   * group leaves with more luggage, or fewer people. Absent: `airport` does both.
   */
  farewell?: TransportLeg;
};

export const TRANSPORT_MODE_AR: Record<TransportMode, string> = {
  car: "سيارة",
  flight: "طيران داخلي",
  train: "قطار",
  ship: "سفينة",
};

/** The country a city is in: its own when the group crossed a border, else the trip's. */
export function cityCountry(data: Pick<DraftData, "trip" | "cities">, cityName: string): string {
  return data.cities.find((c) => c.city_name === cityName)?.country?.trim() || data.trip.country;
}

/** The ways the group moves between cities — the agent's choice, or the single legacy `mode`. */
export function intercityModes(plan: Pick<TransportPlan, "intercity">): TransportMode[] {
  const chosen = (plan.intercity.modes ?? []).filter((m) => m in TRANSPORT_MODE_AR);
  return chosen.length > 0 ? chosen : [plan.intercity.mode];
}

export const hopKey = (from: string, to: string) => `${from.trim()}>${to.trim()}`;

/** How ONE hop is made: the agent's pick for it while that mode is still chosen, else the first mode. */
export function hopMode(plan: Pick<TransportPlan, "intercity">, from: string, to: string): TransportMode {
  const modes = intercityModes(plan);
  const picked = plan.intercity.hop_modes?.[hopKey(from, to)];
  return picked && modes.includes(picked) ? picked : modes[0];
}

/** What a hop prints as: the vehicle for a road hop, the mode itself for a flight or a train. */
export function hopVehicle(plan: Pick<TransportPlan, "intercity">, mode: TransportMode): string {
  return mode === "car" ? vehicleText(plan.intercity, TRANSPORT_MODE_AR.car) : TRANSPORT_MODE_AR[mode];
}

/**
 * The vehicle as every reader prints it.
 *
 * The count rides INSIDE the car_type text on purpose: DraftTransport, the
 * client DTO, the document's transport table, the produce-time «التوصيلات»
 * line and the per-day note all already carry a car_type, and not one of them
 * has to learn a new field.
 */
export function vehicleText(leg: Pick<TransportLeg, "car_type" | "cars">, fallback = ""): string {
  const base = leg.car_type.trim() || fallback;
  if (!base) return "";
  return leg.cars > 1 ? `${base} × ${leg.cars}` : base;
}

/** vehicleText read back: «فان × 2» → فان and 2; a text without «× n» is one car. */
export function splitVehicle(text: string): { car_type: string; cars: number } {
  const m = text.match(/^(.*?)\s*×\s*(\d+)\s*$/);
  return m ? { car_type: m[1].trim(), cars: Math.max(Number(m[2]), 1) } : { car_type: text.trim(), cars: 1 };
}

/**
 * The place labels `deriveTransportRows` writes. Exported because they are
 * also KEYS: the pricing matcher reads «المطار» and «فندق X» back to find the
 * airport and the city — a label that drifted here would silently unprice
 * every transfer.
 */
export const TRANSPORT_AIRPORT = "المطار";
export const TRANSPORT_TOURS = "الجولات السياحية";
export const TRANSPORT_HOTEL_PREFIX = "فندق ";

/**
 * The plan, turned into the rows the document already knows how to print.
 *
 * Derived rather than authored, deliberately: the offer document, the pricing
 * suggestions and the produce-time «يشمل» lines all read `transport[]`, and
 * none of them had to change. The agent edits meaning; the paper keeps its
 * shape.
 *
 * Intercity produces one row per HOP, not one row for the trip — «إسطنبول →
 * طرابزون» is a thing that happens on a date and gets priced; "moving between
 * cities" is not.
 */
export function deriveTransportRows(plan: TransportPlan, cities: TransportCity[], stays: HotelStay[] = []): DraftTransport[] {
  return transportEntries(plan, cities, stays).map((e) => e.row);
}

type TransportCity = Pick<DraftCity, "city_name" | "check_in"> & Partial<Pick<DraftCity, "check_out" | "services" | "edge_out" | "client_hotel">>;

/**
 * A transport row as a city visit's service: the stop it belongs to, its id
 * ("in", "out" or an added row's), what it is, the plan's leg it rides in
 * unless it has its own car, and what the agent changed on it.
 */
export type TransportService = {
  row: DraftTransport;
  city: number;
  id: string;
  kind: Exclude<ServiceKind, "tour">;
  leg: Pick<TransportLeg, "car_type" | "cars">;
  own?: CityService;
  /** the trip's own words for a row that has them (a move to another hotel) — the agent's, when typed, are the row's `text`. */
  words?: string;
};

/** The rows that are a visit's services — every row but the trip's tours line. */
export function transportServices(plan: TransportPlan, cities: TransportCity[], stays: HotelStay[] = []): TransportService[] {
  return transportEntries(plan, cities, stays).flatMap((e) => (e.svc ? [{ row: e.row, ...e.svc }] : []));
}

/**
 * The days a group changes hotel inside one city (the evaluator, 2026-10-24: Phuket's seven nights over three
 * hotels had only the reception and the last day's farewell): a stay that starts after the city's first night,
 * where the one before it ends, in another hotel. A room change in the same hotel, a stay on the same dates
 * (rooms split over two hotels) or a hotel not chosen yet moves nobody.
 */
export function hotelMoves(stays: HotelStay[]): { city: number; id: string; date: string | null; text: string }[] {
  const name = (s: HotelStay) => s.line.hotel_name.trim();
  const bare = (n: string) => n.replace(/^فندق\s+/, "");
  return stays.flatMap((b) => {
    if (b.dates === "same" || !b.from) return [];
    const a = stays.find((s) => s !== b && s.city_index === b.city_index && s.dates !== "same" && s.nights > 0 && s.from != null && s.from + s.nights === b.from);
    if (!a || !name(a) || !name(b) || name(a) === name(b)) return [];
    return [{ city: b.city_index, id: `${HOTEL_MOVE}${b.line.id}`, date: b.check_in, text: `الانتقال من فندق ${bare(name(a))} إلى فندق ${bare(name(b))}` }];
  });
}

function transportEntries(plan: TransportPlan, cities: TransportCity[], stays: HotelStay[] = []): { row: DraftTransport; svc?: Omit<TransportService, "row"> }[] {
  const out: { row: DraftTransport; svc?: Omit<TransportService, "row"> }[] = [];
  const first = cities[0]?.city_name?.trim();
  const lastAt = cities.length - 1;
  const last = cities[lastAt]?.city_name?.trim();
  // a visit's row as the agent left it: taken away, or in its own car, with its own words and price
  const put = (c: number, id: string, kind: TransportService["kind"], leg: TransportService["leg"], row: DraftTransport) => {
    const own = cities[c]?.services?.find((s) => s.id === id);
    if (own?.removed) return;
    const text = own?.text?.trim();
    out.push({
      row: {
        ...row,
        car_type: vehicleText({ car_type: own?.car_type?.trim() || leg.car_type, cars: own?.cars ?? leg.cars }),
        ...(text ? { text } : {}),
        ...(own?.price != null ? { price: own.price } : {}),
      },
      svc: { city: c, id, kind: own?.kind ?? kind, leg, ...(own ? { own } : {}), ...(row.text ? { words: row.text } : {}) },
    });
  };
  // the hotel the client booked himself: the car meets the group there and drops it there, and says so —
  // the row's words only, its places stay the keys the price lists read
  const theirs = (i: number) => clientHotelPlace(cities[i]);
  const metAt = (i: number) => (theirs(i) ? { text: `الاستقبال من المطار إلى ${theirs(i)}` } : {});
  const seenOff = (i: number) => (theirs(i) ? { text: `التوصيل من ${theirs(i)} إلى المطار` } : {});

  if (plan.airport.enabled) {
    put(0, "in", "reception", plan.airport, {
      from_place: TRANSPORT_AIRPORT,
      to_place: first ? `${TRANSPORT_HOTEL_PREFIX}${first}` : "الفندق",
      car_type: "",
      date: cities[0]?.check_in ?? null,
      note: plan.airport.note,
      ...metAt(0),
    });
    // a last day without a hotel: one car from check-out at noon, with the luggage, until the airport
    const dayCar = cities[lastAt]?.edge_out === "no_hotel_day";
    put(lastAt, "out", "farewell", plan.farewell ?? plan.airport, {
      from_place: last ? `${TRANSPORT_HOTEL_PREFIX}${last}` : "الفندق",
      to_place: TRANSPORT_AIRPORT,
      car_type: "",
      date: dayCar ? (cities[lastAt]?.check_out ?? null) : null,
      note: dayCar ? ["سيارة يوم المغادرة: من الفندق الساعة 12:00 حتى المطار — الأمتعة في السيارة", plan.airport.note].filter(Boolean).join(" · ") : plan.airport.note,
      ...seenOff(lastAt),
    });
  }

  if (plan.tours.enabled) {
    out.push({
      row: {
        from_place: TRANSPORT_TOURS,
        to_place: first ?? "",
        car_type: vehicleText(plan.tours),
        date: null,
        note: plan.tours.note,
      },
    });
  }

  if (plan.intercity.enabled) {
    for (let i = 1; i < cities.length; i++) {
      const from = cities[i - 1]?.city_name?.trim();
      const to = cities[i]?.city_name?.trim();
      if (!from || !to) continue;
      const mode = hopMode(plan, from, to);
      // By air, the road is the transfers either side of the flight: the hotel
      // to its airport, the next airport to the next hotel — in the transfer
      // car. The flight itself is priced by the domestic booking.
      if (mode === "flight") {
        if (!plan.airport.enabled) continue;
        const date = cities[i]?.check_in ?? null;
        // to the airport the day the flight leaves — the evening before, when it lands after midnight
        const leaves = cities[i - 1]?.check_out ?? date;
        put(i - 1, "out", "farewell", plan.airport, { from_place: `${TRANSPORT_HOTEL_PREFIX}${from}`, to_place: TRANSPORT_AIRPORT, car_type: "", date: leaves, note: plan.airport.note, ...seenOff(i - 1) });
        put(i, "in", "reception", plan.airport, { from_place: TRANSPORT_AIRPORT, to_place: `${TRANSPORT_HOTEL_PREFIX}${to}`, car_type: "", date, note: plan.airport.note, ...metAt(i) });
        continue;
      }
      // what hopVehicle prints: the car for a road hop, the mode itself for a train or a ship
      const leg = mode === "car" ? { car_type: plan.intercity.car_type.trim() || TRANSPORT_MODE_AR.car, cars: plan.intercity.cars } : { car_type: TRANSPORT_MODE_AR[mode], cars: 1 };
      const road = theirs(i - 1) || theirs(i) ? { text: `الانتقال من ${theirs(i - 1) ?? from} إلى ${theirs(i) ?? to}` } : {};
      put(i, "in", "transfer", leg, { from_place: from, to_place: to, car_type: "", date: cities[i]?.check_in ?? null, note: plan.intercity.note, ...road });
    }
  }

  // to the next hotel of the same city, in the transfer car — priced as a ride inside the city, on its own line
  for (const m of hotelMoves(stays)) {
    const name = cities[m.city]?.city_name?.trim() ?? "";
    put(m.city, m.id, "transfer", plan.airport, { from_place: name, to_place: name, car_type: "", date: m.date, note: "", ref: `transport:${m.id}`, text: m.text });
  }

  // the rows the agent added, after the trip's: met at the airport, seen off to it, or driven inside the city
  cities.forEach((c, k) => {
    const name = c.city_name.trim();
    for (const s of c.services ?? []) {
      if (isTripService(s.id)) continue;
      const kind = s.kind ?? "transfer";
      const [from_place, to_place] =
        kind === "reception" ? [TRANSPORT_AIRPORT, `${TRANSPORT_HOTEL_PREFIX}${name}`] : kind === "farewell" ? [`${TRANSPORT_HOTEL_PREFIX}${name}`, TRANSPORT_AIRPORT] : [name, name];
      const leg = kind === "farewell" ? (plan.farewell ?? plan.airport) : plan.airport;
      put(k, s.id, kind, leg, {
        from_place,
        to_place,
        car_type: "",
        date: serviceDate({ check_in: c.check_in, check_out: c.check_out ?? null }, s),
        note: "",
        ref: `transport:svc:${s.id}`,
        ...(kind === "transfer" ? { text: inCityTransferText(name) } : kind === "reception" ? metAt(k) : seenOff(k)),
      });
    }
  });

  return out;
}

export function emptyTransportPlan(): TransportPlan {
  return {
    airport: { enabled: true, car_type: "", cars: 1, note: "" },
    tours: { enabled: true, car_type: "", cars: 1, note: "" },
    intercity: { enabled: false, mode: "car", car_type: "", cars: 1, note: "" },
  };
}

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
  /**
   * The stay (or other draft row) this item prices — see `pricingRefFor`.
   * Absent on items written before cities could hold two hotels, which is why
   * reconciliation still accepts a description match.
   */
  ref?: string | null;
  /**
   * Manual profit ON TOP of the buy price, when the agent overrides the markup
   * rules. Percentage wins if both are set. Null on both = keep `sell_price`
   * exactly as the rules (or the agent) left it.
   */
  profit_pct?: number | null;
  profit_amount?: number | null;
  /**
   * The agent changed this line by hand on the pricing page: the lists and the
   * cards no longer rewrite it. `list_sell` keeps what the list says, so
   * «استعادة سعر القائمة» can put it back.
   */
  overridden?: boolean;
  list_sell?: number | null;
  /** a line the agent added by hand — nothing in the draft produces it, so a sync never drops it. */
  manual?: boolean;
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
  /**
   * "travel" for the day the group flies out and is not yet there — the
   * programme starts when the plane leaves, the hotels when it lands.
   */
  kind?: "travel";
  /**
   * The title the basic screen last wrote on this day. While the title still
   * equals it, the day is the screen's to rewrite; once a person changes it,
   * the day is theirs.
   */
  auto_title?: string;
};

export type DraftPricing = {
  items: DraftPricingItem[];
  display_currency: string;
  /** rounded client-facing total (sell); editable override. */
  final_total: number | null;
  /**
   * The package's profit, as the agent states it once: a margin on every line,
   * or a whole amount in the quote currency shared over the lines. Laid onto the
   * lines' own profit fields (withPackageProfit), so the issued offer, the
   * reports and the client total all read it the way they already read a profit.
   */
  profit?: PackageProfit;
  /**
   * «اعتمد هذه» (the owner, 2026-10-29): an older version taken back at ITS total. `base` is what
   * this file itself priced at when adopted; while it still does, issuing keeps `total`
   * (issue-pricing.ts adoptedPin), and any priced change lets the file price on its own again.
   */
  adopted?: { version: number; total: number; base: number | null };
};

export type PackageProfit = { mode: "pct" | "amount"; value: number | null };

/** A stored «اعتمد هذه» pin kept only when every figure is a number — anything else prices on its own. */
function withAdopted(pricing: DraftPricing): DraftPricing {
  const a = pricing.adopted as { version?: unknown; total?: unknown; base?: unknown } | undefined;
  if (a === undefined) return pricing;
  const ok = !!a && Number.isInteger(a.version) && (a.version as number) > 0 && typeof a.total === "number" && Number.isFinite(a.total) && a.total >= 0
    && (a.base === null || (typeof a.base === "number" && Number.isFinite(a.base)));
  if (ok) return pricing;
  const { adopted: _drop, ...rest } = pricing;
  void _drop;
  return rest;
}

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
  /** the booking the flights belong to: mode, cabin, one price per booking. */
  flight_booking: FlightBooking;
  /** what the agent answers — see TransportPlan. */
  transport_plan: TransportPlan;
  /** DERIVED from transport_plan on every normalize; the document reads this. */
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
  /**
   * «بكج متقدم» (lib/offer/advanced): four answers that reword the transfers and
   * the «يشمل / لا يشمل» lines for composite trips. Absent on every other file.
   */
  advanced?: DraftAdvanced;
  /**
   * This file's own words for the arrival day / the day home, line by line —
   * the welcome and the farewell as management wants them said for this client.
   * Absent: the company's default (itinerary.arrivalLines / departureLines).
   */
  arrival_lines?: string[];
  departure_lines?: string[];
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
      meal_plan: null,
      baggage_intl_pieces: null,
      baggage_intl_kg: null,
      baggage_intl_cabin_kg: null,
      baggage_dom_pieces: null,
      baggage_dom_kg: null,
      baggage_dom_cabin_kg: null,
    },
    // Everything on by default: a new draft behaves exactly as it did before the
    // scope switches existed, and the agent opts OUT of what this sale excludes.
    scope: {
      hotels: true,
      flights_intl: true,
      flights_domestic: true,
      transport: true,
      services: true,
      visas: true,
    },
    cities: [],
    hotels: [],
    flights: [],
    flight_booking: emptyFlightBooking(),
    transport_plan: emptyTransportPlan(),
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
    ...(d.kind === "travel" ? { kind: "travel" as const } : {}),
    ...(typeof d.auto_title === "string" ? { auto_title: d.auto_title } : {}),
  };
}

/**
 * Two legs never share an id: an edit finds its leg by id, so a shared one would put a number typed (or looked
 * up) on one leg onto the other too. An older id-less leg takes its place's id (`leg-1`) — a leg already saved
 * under that id keeps it, the newcomer gets the next free one. Stable: a draft read twice ids the same.
 */
function withUniqueLegIds(flights: DraftFlight[]): DraftFlight[] {
  const seen = new Set<string>();
  return flights.map((f) => {
    let id = f.id ?? "";
    for (let n = 1; !id || seen.has(id); n++) id = `${f.id || "leg"}-${n}`;
    seen.add(id);
    return id === f.id ? f : { ...f, id };
  });
}

/** Backfill tz/user-set fields on flights persisted before prompt-5 (old drafts have none). */
function normalizeDraftFlight(raw: unknown, index: number): DraftFlight {
  const f = (raw && typeof raw === "object" ? raw : {}) as Partial<DraftFlight>;
  return {
    // made from its place, not random, so a draft read twice before it is saved ids the same
    id: typeof f.id === "string" && f.id ? f.id : `leg-${index}`,
    airline: typeof f.airline === "string" ? f.airline : "",
    airline_iata: typeof f.airline_iata === "string" ? f.airline_iata.toUpperCase() : "",
    flight_no: typeof f.flight_no === "string" ? f.flight_no : "",
    from_airport: typeof f.from_airport === "string" ? f.from_airport : "",
    to_airport: typeof f.to_airport === "string" ? f.to_airport : "",
    departure_at: typeof f.departure_at === "string" ? f.departure_at : null,
    arrival_at: typeof f.arrival_at === "string" ? f.arrival_at : null,
    from_tz: typeof f.from_tz === "string" ? f.from_tz : null,
    to_tz: typeof f.to_tz === "string" ? f.to_tz : null,
    from_city: typeof f.from_city === "string" ? f.from_city : "",
    to_city: typeof f.to_city === "string" ? f.to_city : "",
    date_user_set: f.date_user_set === true,
    cabin_class: typeof f.cabin_class === "string" ? f.cabin_class : "",
    baggage_allowance: typeof f.baggage_allowance === "string" ? f.baggage_allowance : "",
    baggage_kg: typeof f.baggage_kg === "number" ? f.baggage_kg : null,
    baggage_pieces: typeof f.baggage_pieces === "number" ? f.baggage_pieces : null,
    cabin_baggage_kg: typeof f.cabin_baggage_kg === "number" ? f.cabin_baggage_kg : null,
    leg_order: f.leg_order === "inbound" || f.leg_order === "internal" ? f.leg_order : "outbound",
    ...(f.auto === true ? { auto: true } : {}),
    ...(typeof f.price === "number" && Number.isFinite(f.price) ? { price: f.price } : {}),
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
  // every stop gets its key here, once — derived, so an unsaved draft read twice keys the same
  const cities = withCityKeys(Array.isArray(source.cities) ? source.cities.map(withCleanServices) : []);

  // A draft written before the plan existed has authored rows and no plan. Its
  // switches default to ON so the derived rows keep saying roughly what the old
  // ones did, rather than the file silently losing its transfers.
  const plan = (source.transport_plan ?? {}) as Partial<TransportPlan>;
  // A leg saved before the count existed, or hand-edited to 0 or "2", still has
  // to come back as at least one real vehicle.
  const mergeLeg = <T extends TransportLeg>(base: T, incoming: Partial<T> | undefined): T => {
    const merged = { ...base, ...(incoming ?? {}) };
    return { ...merged, cars: Math.max(Math.trunc(Number(merged.cars)) || 1, 1) };
  };
  const transportPlan: TransportPlan = {
    airport: mergeLeg(empty.transport_plan.airport, plan.airport),
    tours: mergeLeg(empty.transport_plan.tours, plan.tours),
    intercity: normalizeIntercity(mergeLeg(empty.transport_plan.intercity, plan.intercity)),
    ...(plan.farewell ? { farewell: mergeLeg(empty.transport_plan.airport, plan.farewell) } : {}),
  };
  const scope = normalizeScope(source.scope);
  const advanced = normalizeAdvanced(source.advanced);
  const hotels = Array.isArray(source.hotels) ? source.hotels.map(normalizeDraftHotel) : [];

  return {
    customer: { ...empty.customer, ...(source.customer ?? {}) },
    // ages are re-fitted to the counts: a draft saved before the ages existed has
    // none, and a hand-edited jsonb could disagree with the count.
    trip: {
      ...trip,
      // Clamped on the way IN, not just on the way out of the form: drafts
      // written before the bands existed carry ages like 31 for a child and 74
      // for an infant, and those would otherwise sit there until a supplier
      // rejected the booking. Opening the file now repairs it.
      children_ages: resizeAges(trip.children_ages, trip.children, AGE_BANDS.children.fallback).map((a) =>
        clampAge("children", a),
      ),
      infant_ages: resizeAges(trip.infant_ages, trip.infants, AGE_BANDS.infants.fallback).map((a) =>
        clampAge("infants", a),
      ),
      rooms: Math.max(Math.trunc(Number(trip.rooms)) || 1, 1),
      // A draft saved before the question existed answered it as a BOARD. Read
      // back only what is unambiguous — HB is either meal, so it stays
      // unanswered rather than promising a lunch nobody bought.
      meal_plan: MEAL_PLANS.includes(trip.meal_plan as MealPlan)
        ? (trip.meal_plan as MealPlan)
        : trip.default_board
          ? BOARD_MEAL_PLAN[trip.default_board] ?? null
          : null,
    },
    scope,
    cities,
    hotels,
    flights: Array.isArray(source.flights) ? withUniqueLegIds(source.flights.map(normalizeDraftFlight)) : [],
    // «للفرد»: the total follows the travellers, whoever changed them last
    flight_booking: withFlightTotals(normalizeFlightBooking(source.flight_booking), trip),
    transport_plan: transportPlan,
    // DERIVED, always. Rows are no longer authored, so a stale array from an
    // older draft is simply replaced by what the plan says today.
    // A sale that excludes transport prints no transfers. The PLAN is kept —
    // flip the switch back and the rows return — but leaving the rows derived
    // meant the document still promised an airport pickup on a file whose
    // transport switch was off.
    transport: scope.transport ? withAdvancedTransport(deriveTransportRows(transportPlan, cities, deriveHotelStays(cities, hotels)), advanced, TRANSPORT_AIRPORT) : [],
    services: { ...empty.services, ...(source.services ?? {}) },
    visas: Array.isArray(source.visas) ? source.visas : [],
    days: normalizeDraftDays(source.days),
    pricing: withAdopted({ ...empty.pricing, ...(source.pricing ?? {}) }),
    produced_serial: typeof source.produced_serial === "string" ? source.produced_serial : null,
    source: normalizeDraftSource(source.source),
    ...(advanced ? { advanced } : {}),
    ...dayLines("arrival_lines", source.arrival_lines),
    ...dayLines("departure_lines", source.departure_lines),
  };
}

/**
 * A stop's services as the screen may read them: rows with an id, a known kind
 * and at least one car. A stop without any — every older file — is left as it was.
 */
function withCleanServices(raw: DraftCity): DraftCity {
  // `from_flight` is a mark, true or absent: «تحديث من الرحلات» rewrites only the stops carrying it
  const { from_flight, ...rest } = raw ?? ({} as DraftCity);
  let city = !raw ? raw : from_flight === true ? raw : (rest as DraftCity);
  // a client hotel is an object with a name, whatever the jsonb holds
  if (city && city.client_hotel !== undefined) {
    const h = city.client_hotel as unknown;
    city = h && typeof h === "object" ? { ...city, client_hotel: { ...(h as ClientHotel), name: String((h as ClientHotel).name ?? "") } } : { ...city, client_hotel: undefined };
  }
  if (!city || !Array.isArray(city.services)) return city;
  const services = city.services.flatMap((s): CityService[] => {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !s.id) return [];
    const kind = s.kind && (s.kind as ServiceKind) !== "tour" && SERVICE_KINDS.includes(s.kind) ? s.kind : undefined;
    const cars = s.cars === undefined ? undefined : Math.max(Math.trunc(Number(s.cars)) || 1, 1);
    const price = typeof s.price === "number" && Number.isFinite(s.price) ? s.price : undefined;
    return [{ ...s, kind, cars, price }];
  });
  return { ...city, services };
}

/** Typed day lines, blanks dropped; none left reads as «the default» (the key is absent). */
function dayLines<K extends "arrival_lines" | "departure_lines">(key: K, raw: unknown): Partial<Record<K, string[]>> {
  const lines = Array.isArray(raw) ? raw.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
  return lines.length > 0 ? ({ [key]: lines } as Partial<Record<K, string[]>>) : {};
}

/** A hand-edited or older intercity leg comes back with only real modes in it. */
function normalizeIntercity(leg: TransportPlan["intercity"]): TransportPlan["intercity"] {
  const modes = intercityModes({ intercity: leg });
  const raw = leg.hop_modes && typeof leg.hop_modes === "object" ? leg.hop_modes : {};
  const hop_modes = Object.fromEntries(Object.entries(raw).filter(([, m]) => typeof m === "string" && m in TRANSPORT_MODE_AR));
  return { ...leg, mode: modes[0], modes, hop_modes };
}

/**
 * Old drafts have no scope key at all. Defaulting each switch to TRUE is the
 * only safe reading: a draft that already carries flights and hotels must not
 * have them silently dropped from the document by a field added afterwards.
 */
function normalizeScope(raw: unknown): DraftScope {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<DraftScope> & { flights?: boolean };
  // An old draft answered ONE question about flights. Both halves inherit that
  // answer: the file may already carry an `internal` leg, and defaulting that
  // half to false would hide a row the document still prints.
  const legacyFlights = s.flights !== false;
  return {
    hotels: s.hotels !== false,
    // `??`, not `!== false`: an ABSENT key inherits the old switch, while an
    // explicit false is the agent's own answer and wins.
    flights_intl: s.flights_intl ?? legacyFlights,
    flights_domestic: s.flights_domestic ?? legacyFlights,
    transport: s.transport !== false,
    services: s.services !== false,
    visas: s.visas !== false,
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
 * city checks in the same day — or the day after, across a night spent
 * travelling (`arrives_next_day`). Returns a NEW array (input untouched).
 */
export function deriveCityDates(arrivalDate: string | null, cities: DraftCity[]): DraftCity[] {
  if (!arrivalDate) return cities.map((c) => ({ ...c, check_in: null, check_out: null }));
  let cursor = arrivalDate;
  return cities.map((c, i) => {
    // the first hotel starts the day after an arrival night spent elsewhere, or the night before a small-hours landing
    const check_in =
      i > 0 && c.arrives_next_day ? addDays(cursor, 1) : i === 0 && c.edge_in === "no_hotel" ? addDays(cursor, 1) : i === 0 && c.edge_in === "prev_night" ? addDays(cursor, -1) : cursor;
    const check_out = addDays(check_in, Math.max(c.nights, 0));
    cursor = check_out;
    return { ...c, check_in, check_out };
  });
}

/** When a stay is inside its city — see DraftHotel.dates. */
export type StayDates = "after" | "same" | "custom";

/** A stay: one hotel line, with the dates its position in the city gives it. */
export type HotelStay = {
  line: DraftHotel;
  city_name: string;
  /** which stop of the trip (index into the cities, and its key) — a city may repeat. */
  city_index: number;
  city_key: string;
  /** how its dates were decided — "same" with nothing before it, or "custom" without a date, is "after". */
  dates: StayDates;
  /** "same": the stay whose dates it shares. */
  same_as: DraftHotel | null;
  /** its first night, counted from the city's first (0); null when it cannot be placed. */
  from: number | null;
  nights: number;
  check_in: string | null;
  check_out: string | null;
};

/** Nights allocated vs nights owed, per city. */
export type CityCoverage = {
  city_name: string;
  city_key: string;
  needed: number;
  /** DIFFERENT nights with a bed — two hotels on the same 4 nights cover 4, not 8. */
  covered: number;
  /** of those, the nights outside the city's own — «زائد». */
  extra: number;
  stays: HotelStay[];
};

/**
 * Every stop's key: its own, or one made from its name and how many stops of
 * that name came before it («كوالالمبور#2»). Made, not random, so a draft read
 * twice before it is saved keys the same both times.
 */
export function cityKeys(cities: Pick<DraftCity, "key" | "city_name">[]): string[] {
  const own = cities.map((c, i) => (c.key && cities.findIndex((x) => x.key === c.key) === i ? c.key : null));
  const taken = new Set(own.filter(Boolean));
  return cities.map((c, i) => {
    if (own[i]) return own[i]!;
    let n = 1;
    while (taken.has(`${c.city_name.trim()}#${n}`)) n++;
    const key = `${c.city_name.trim()}#${n}`;
    taken.add(key);
    return key;
  });
}

/** The cities with their keys written in — normalize does this, and so does anything that reorders them. */
export function withCityKeys<T extends Pick<DraftCity, "key" | "city_name">>(cities: T[]): T[] {
  const keys = cityKeys(cities);
  return cities.map((c, i) => (c.key === keys[i] ? c : { ...c, key: keys[i] }));
}

/** A key for a stop about to be added. */
export function newCityKey(cities: Pick<DraftCity, "key" | "city_name">[], name: string): string {
  return cityKeys([...cities, { city_name: name }]).at(-1)!;
}

/**
 * The hotel lines of ONE stop, in order. A line names its stop by key; a line
 * written before stops had keys (or whose stop is gone) still goes by the
 * city's name, as it always did.
 */
export function cityHotelLines(cities: Pick<DraftCity, "key" | "city_name">[], hotels: DraftHotel[], index: number): DraftHotel[] {
  const keys = cityKeys(cities);
  const known = new Set(keys);
  const city = cities[index];
  if (!city) return [];
  return hotels.filter((h) => (h.city_key && known.has(h.city_key) ? h.city_key === keys[index] : h.city_name === city.city_name));
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Ids only have to be unique inside one draft, and readable in a log. */
export function newStayId(): string {
  return `stay-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Hotel lines → stays with real dates.
 *
 * The rule that makes multi-hotel cities work: within a city, stays run in
 * array order and each starts where the previous one ended. A line with
 * `nights: 0` takes whatever the city has left — which is what a freshly added
 * line means, and what every pre-existing single-hotel line means too, so old
 * drafts derive exactly as they always did.
 *
 * Pure and total: cities without dates yield stays without dates rather than
 * being dropped, because the hotels stage must still show them.
 *
 * A "same" stay takes the previous stay's dates and moves nothing; a "custom"
 * one sits on its own date. Only the "after" lines share out the city's nights,
 * and the one after any stay starts where the latest one so far ends.
 */
export function deriveHotelStays(cities: DraftCity[], hotels: DraftHotel[]): HotelStay[] {
  const out: HotelStay[] = [];
  const keys = cityKeys(cities);
  cities.forEach((city, ci) => {
    const lines = cityHotelLines(cities, hotels, ci);
    const mode = lines.map((l, i): StayDates =>
      (l.dates === "same" && i > 0) || (l.dates === "custom" && l.check_in) ? l.dates : "after",
    );
    const seq = lines.filter((_, i) => mode[i] === "after");
    // What the explicit numbers do not claim is left for the lines that ask for
    // "the rest" — split evenly, remainder to the first, so 3 nights over 2
    // blank lines is 2+1 rather than 1.5 each.
    const explicit = seq.reduce((sum, l) => sum + Math.max(0, l.nights), 0);
    const blanks = seq.filter((l) => l.nights <= 0).length;
    let remaining = Math.max(0, city.nights - explicit);
    let cursor = 0;
    let s = -1;
    const mine: HotelStay[] = [];

    lines.forEach((line, i) => {
      const base = { line, city_name: city.city_name, city_index: ci, city_key: keys[ci], dates: mode[i], same_as: null };
      if (mode[i] === "same") {
        const prev = mine[i - 1];
        mine.push({ ...base, same_as: prev.line, from: prev.from, nights: prev.nights, check_in: prev.check_in, check_out: prev.check_out });
        return;
      }
      if (mode[i] === "custom") {
        const from = city.check_in ? daysBetween(city.check_in, line.check_in!) : null;
        // no nights of its own: the rest of the city from its first night
        const nights = line.nights > 0 ? line.nights : from != null ? Math.max(city.nights - from, 0) : 0;
        if (from != null) cursor = Math.max(cursor, from + nights);
        mine.push({ ...base, from, nights, check_in: line.check_in!, check_out: addDays(line.check_in!, nights) });
        return;
      }
      s += 1;
      let nights = Math.max(0, line.nights);
      if (nights === 0 && blanks > 0) {
        const share = Math.floor(remaining / blanks);
        const isLastBlank = seq.filter((l, j) => l.nights <= 0 && j > s).length === 0;
        // never past the city's end — only bites after a custom stay moved the cursor
        nights = Math.min(isLastBlank ? remaining : share, Math.max(city.nights - cursor, 0));
        remaining -= nights;
      }
      const check_in = city.check_in ? addDays(city.check_in, cursor) : null;
      mine.push({ ...base, from: cursor, nights, check_in, check_out: check_in ? addDays(check_in, nights) : null });
      cursor += nights;
    });
    out.push(...mine);
  });
  return out;
}

/**
 * Another hotel in a stop — after the last one, on the same dates (its rooms
 * split over the two), or on dates of its own (the city's, until the agent
 * narrows them). It carries the rooms' types, the currency and «مسترد / غير
 * مسترد» of the stay it was added from, never its price.
 */
export function addStay(
  cities: DraftCity[],
  hotels: DraftHotel[],
  index: number,
  dates: StayDates,
): { hotels: DraftHotel[]; id: string } {
  const city = cities[index];
  const lines = cityHotelLines(cities, hotels, index);
  const from = lines[lines.length - 1];
  if (!city) return { hotels, id: "" };
  const cov = hotelCoverage(cities, hotels)[index];
  // another hotel: the types follow, the previous hotel's own names for its rooms do not
  const rooms = (from?.rooms ?? [emptyRoomSpec()]).map((r) => ({ ...r, price: null, hotel_room_name: undefined }));
  const line = withRooms(
    {
      ...normalizeDraftHotel({ city_name: city.city_name }),
      city_key: cityKeys(cities)[index],
      // "after" takes what the city still lacks (0 = shares the rest with the last stay)
      nights: dates === "after" ? Math.max(cov.needed - (cov.covered - cov.extra), 0) : dates === "custom" ? city.nights : 0,
      ...(dates !== "after" ? { dates } : {}),
      ...(dates === "custom" && city.check_in ? { check_in: city.check_in } : {}),
      ...(from ? { manual_currency: from.manual_currency } : {}),
      ...(typeof from?.refundable === "boolean" ? { refundable: from.refundable } : {}),
    },
    // the point of a same-dates hotel is to take some of the rooms: it starts with one
    dates === "same" ? rooms.slice(0, 1) : rooms,
  );
  const at = from ? hotels.lastIndexOf(from) + 1 : hotels.length;
  return { hotels: [...hotels.slice(0, at), line, ...hotels.slice(at)], id: line.id };
}

/**
 * A stay's prices are its whole stay's, but the rate the agent means is the
 * NIGHT's (the owner, 2026-10-18: 546.67 a night jumped to 1,202.67 when a
 * second hotel took six of the eleven nights, fell to 248.49 when it was
 * removed, and to 496.97 when the city went 11 → 10 — a before/after
 * comparison ran twice on that path). So every stay remembers the nights its
 * prices are for (`priced_nights`): when its nights are anything else — split,
 * merged, removed, the city's nights changed — its room prices and manual price
 * are scaled by nights / priced_nights and the mark follows. A line seen for
 * the first time is marked at its nights, unchanged. Idempotent: running it
 * twice, or on a slice that carries an older line, gives the same rate.
 * Basic runs it on every change (BasicEditor commit).
 */
export function keepNightlyRates(cities: DraftCity[], hotels: DraftHotel[]): DraftHotel[] {
  const nights = new Map(deriveHotelStays(cities, hotels).map((s) => [s.line.id, s.nights]));
  const scale = (v: number | null, f: number) => (v == null ? v : Math.round(v * f * 100) / 100);
  return hotels.map((h) => {
    const now = nights.get(h.id) ?? 0;
    // a supplier rate quoted these nights; another stay is sourcingFits' to flag, not a figure to stretch
    if (h.sourcing || !now || h.priced_nights === now) return h;
    if (!h.priced_nights) return { ...h, priced_nights: now };
    const f = now / h.priced_nights;
    return { ...withRooms(h, h.rooms.map((r) => ({ ...r, price: scale(r.price, f) }))), manual_price: scale(h.manual_price, f), priced_nights: now };
  });
}

/** A custom-dated stay with a night outside its city's — never issued (pg.err.stayOutsideCity). */
export function stayOutsideCity(stay: HotelStay, city: Pick<DraftCity, "nights">): boolean {
  return stay.dates === "custom" && stay.from != null && (stay.from < 0 || stay.from + stay.nights > city.nights);
}

/**
 * Does a supplier rate still price this stay? The quote covered one stay —
 * stretched since (more nights, rooms or guests, another hotel) it would keep
 * pricing the original, and the offer would sell and book a bigger stay at the
 * smaller one's price. A rate with no record of what it quoted never fits.
 */
export function sourcingFits(stay: HotelStay, trip: { adults: number; children: number }): boolean {
  const q = stay.line.sourcing?.quoted_for;
  return (
    !!q &&
    q.check_in === stay.check_in &&
    q.check_out === stay.check_out &&
    q.rooms === (stay.line.rooms_count > 0 ? stay.line.rooms_count : 1) &&
    q.adults === trip.adults &&
    q.children === trip.children &&
    q.hotel_name === stay.line.hotel_name &&
    stay.line.rooms.every((r) => r.board_type === q.board_type && r.room_type_name === q.room_name)
  );
}

/** The cancellation line a stay prints: the supplier's own policy, else what the agent marked. */
export function stayCancellation(h: Pick<DraftHotel, "sourcing" | "refundable" | "refundable_until">): string | null {
  if (h.sourcing) return h.sourcing.cancellation_policy || null;
  if (h.refundable === true) return h.refundable_until ? `قابل للاسترداد حتى ${h.refundable_until}` : "قابل للاسترداد";
  return h.refundable === false ? "غير قابل للاسترداد" : null;
}

/**
 * Per-stop allocated-vs-owed, for the coverage bar and the blocking check — in
 * the cities' order, one entry per stop. Complete = covered === needed with no
 * extra night.
 */
export function hotelCoverage(cities: DraftCity[], hotels: DraftHotel[]): CityCoverage[] {
  const stays = deriveHotelStays(cities, hotels);
  const keys = cityKeys(cities);
  return cities.map((city, i) => {
    const mine = stays.filter((s) => s.city_index === i);
    const nights = new Set<number>();
    for (const s of mine) if (s.from != null) for (let k = 0; k < s.nights; k++) nights.add(s.from + k);
    return {
      city_name: city.city_name,
      city_key: keys[i],
      needed: city.nights,
      covered: nights.size,
      extra: [...nights].filter((n) => n < 0 || n >= city.nights).length,
      stays: mine,
    };
  });
}

/**
 * What a pricing item points at.
 *
 * The stay's id when it has one; otherwise the old `«المدينة — الفندق»` string,
 * so items written before this change keep matching their line instead of being
 * reconciled away as phantoms on the next save.
 */
export function pricingRefFor(stay: { line: DraftHotel; city_name: string }): string {
  return stay.line.id || `${stay.city_name} — ${stay.line.hotel_name}`;
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

export type ArrivalEdge = "prev_night" | "early_checkin" | "no_hotel";
export type DepartureEdge = "no_hotel_day" | "late_checkout";

/**
 * The trip's nights the edges move off or onto the hotels: an arrival night or
 * a last night spent without a hotel is still a night of the trip (+1 each),
 * a night booked before the arrival is a hotel night outside it (−1).
 */
export function edgeNights(cities: Pick<DraftCity, "edge_in" | "edge_out">[]): number {
  const first = cities[0];
  const last = cities[cities.length - 1];
  return (first?.edge_in === "no_hotel" ? 1 : 0) + (last?.edge_out === "no_hotel_day" ? 1 : 0) - (first?.edge_in === "prev_night" ? 1 : 0);
}

/** The nights spent on an overnight move between two cities, in no hotel (DraftCity.arrives_next_day). */
export function travelNights(cities: DraftCity[]): number {
  return cities.filter((c, i) => i > 0 && c.arrives_next_day).length;
}

/**
 * The trip nights the cities account for: their own, and the nights spent
 * travelling between them — what is compared with trip.nights. A city's hotels
 * cover its own nights only.
 */
export function totalCityNights(cities: DraftCity[]): number {
  return cities.reduce((sum, c) => sum + (Number.isFinite(c.nights) ? c.nights : 0), 0) + travelNights(cities) + edgeNights(cities);
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

/**
 * What a currency dropdown offers: the base set, every country's own currency,
 * and whatever the line already holds.
 *
 * The last part is the one that matters. A `<select>` whose value is not among
 * its options shows the FIRST option — so an SGD line read as SAR on screen,
 * and the next edit saved it as SAR.
 */
export function currencyOptions(
  countries: { default_currency?: string | null }[],
  ...current: (string | null | undefined)[]
): string[] {
  const extra = [...countries.map((c) => c.default_currency), ...current]
    .map((code) => code?.trim().toUpperCase() ?? "")
    .filter((code) => /^[A-Z]{3}$/.test(code) && !(CURRENCIES as readonly string[]).includes(code));
  return [...CURRENCIES, ...[...new Set(extra)].sort()];
}

// ---------- lookups (loaded server-side, passed to stage pages) ----------
export type LookupHotel = {
  id: string;
  name: string;
  stars: number | null;
  /** hotels.english_name — a name typed in Latin letters finds the hotel by it */
  name_en?: string | null;
  /** its code at TBO when it was picked from TBO's list (hotel_content_cache.internal_hotel_id) */
  tbo?: string | null;
};
export type LookupCity = {
  id: string;
  name: string;
  hotels: LookupHotel[];
  /** cities.lat / lng — the intercity distance warning (offer/overland.ts). */
  lat?: number | null;
  lng?: number | null;
};
export type LookupCountry = {
  id: string;
  name: string;
  /**
   * ISO-3166 alpha-2. Required by every real hotel supplier — they resolve a
   * city WITHIN a country, so a live search without this returns nothing and
   * looks like "the supplier has no hotels there".
   */
  iso2: string | null;
  /** IANA zone. Drives the time-difference note — see lib/offer/timezones.ts. */
  timezone: string | null;
  /** the country's own currency — offered in every currency dropdown. */
  default_currency?: string | null;
  cities: LookupCity[];
};
export type LookupRoomType = { id: string; name: string; hotel_id: string | null; default_board: BoardType | null };
/** `city` — the catalogue city the airport serves (airports.city_id), or null. */
/** `name_en`: the airport's English name — found by it too («Trabzon»). */
export type LookupAirport = { id: string; name: string; code: string | null; timezone: string | null; city: string | null; country?: string | null; name_en?: string | null };

/**
 * One approved line from the `terms` table — the company's master lists behind
 * /offers/offer-includes, /offers/offer-not-includes and
 * /offers/terms-and-conditions. `checked` marks the ones a new offer starts with;
 * `country_id` ties a line to one destination (null = every country).
 */
export type TermLibraryItem = { text: string; checked: boolean; country_id: string | null };

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

/** The lines a trip to this country may use: the global ones plus its own. */
export function libraryForCountry(library: TermLibrary, countryId: string | null): TermLibrary {
  const mine = (items: TermLibraryItem[]) => items.filter((i) => i.country_id === null || i.country_id === countryId);
  return { includes: mine(library.includes), excludes: mine(library.excludes), terms: mine(library.terms) };
}

/**
 * The trip moved to another country: swap the old country's approved lines for
 * the new one's ticked lines.
 *
 * Only text that is EXACTLY the previous country's library wording goes — a
 * global line, or anything the agent typed or reworded, is the agent's and
 * stays. A line the new country (or the global list) also carries stays too,
 * rather than being dropped and re-added at the bottom.
 */
export function reseedForCountry(
  services: DraftServices,
  library: TermLibrary,
  prevId: string | null,
  nextId: string | null,
): DraftServices {
  if (prevId === nextId) return services;
  const swap = (current: string[], items: TermLibraryItem[]) => {
    const keep = new Set(items.filter((i) => i.country_id === null || i.country_id === nextId).map((i) => i.text));
    const stale = new Set(items.filter((i) => prevId && i.country_id === prevId && !keep.has(i.text)).map((i) => i.text));
    const kept = current.filter((line) => !stale.has(line));
    const added = items.filter((i) => nextId && i.checked && i.country_id === nextId && !kept.includes(i.text)).map((i) => i.text);
    return [...kept, ...new Set(added)];
  };
  return {
    includes: swap(services.includes, library.includes),
    excludes: swap(services.excludes, library.excludes),
    terms: swap(services.terms, library.terms),
  };
}

/**
 * The trip moves to another country — from TripStage's picker or a Teletel
 * destination chip, so both write `trip.country` through here.
 *
 * The country's services («خدمات الدولة») count as its unticked «يشمل» lines,
 * so the old country's leave with its approved lines (reseedForCountry); and a
 * «خدمة» pricing line for a line that left goes too — mergeSuggestions never
 * drops a priced line, and a Malaysia offer must not charge for a Thai tour.
 */
export function moveTripCountry(
  data: Pick<DraftData, "trip" | "services" | "pricing">,
  lookups: Pick<GeneratorLookups, "countries" | "termLibrary" | "countryServices">,
  trip: DraftTrip,
): Pick<DraftData, "trip" | "services" | "pricing"> {
  const id = (name: string) => findLookupCountry(lookups.countries, name)?.id ?? null;
  const library: TermLibrary = {
    ...lookups.termLibrary,
    includes: [
      ...lookups.termLibrary.includes,
      ...lookups.countryServices.map((s) => ({ text: s.name, checked: false, country_id: s.country_id })),
    ],
  };
  const services = reseedForCountry(data.services, library, id(data.trip.country), id(trip.country));
  const gone = new Set(data.services.includes.filter((line) => !services.includes.includes(line)));
  const items = data.pricing.items.filter((p) => !(p.item_type === "service" && gone.has(p.description)));
  return {
    trip,
    services,
    pricing: items.length === data.pricing.items.length ? data.pricing : { ...data.pricing, items },
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
export function findLookupCountry<T extends { name: string }>(countries: T[], name: string): T | undefined {
  const fold = (v: string) =>
    v.replace(/[إأآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ـ\s]/g, "");
  // ponytail: naive fold — dropping every alef lets «تايلند» find «تايلاند», but
  // two countries that differ only by an alef would collide; add a country alias
  // column if that ever happens.
  const bare = (v: string) => fold(v).replace(/ا/g, "");
  const target = fold(name);
  if (!target) return undefined;
  const stripped = bare(name);
  return (
    countries.find((c) => c.name === name) ??
    countries.find((c) => fold(c.name) === target) ??
    (stripped ? countries.find((c) => bare(c.name) === stripped) : undefined)
  );
}

/**
 * A vehicle the agency actually offers, from `transportation_types`.
 *
 * The capacity travels with the name because that is what the choice turns on:
 * «فان» alone made an agent guess, and nine travellers in a seven-seater is
 * discovered at the kerb.
 */
export type LookupCarType = {
  name: string;
  name_en: string | null;
  pax: number | null;
  luggage: number | null;
};

export type GeneratorLookups = {
  /** SAR per unit of each currency (live, else the fallback table) — the preview's totals. */
  sarPer?: Record<string, number>;
  /** where `sarPer` came from and the day it is for — said next to the pricing totals. */
  ratesSource?: "live" | "fallback";
  ratesDate?: string;
  countries: LookupCountry[];
  roomTypes: LookupRoomType[];
  airports: LookupAirport[];
  carTypes: LookupCarType[];
  /** the admin-managed includes / excludes / terms lists. */
  termLibrary: TermLibrary;
  /** «الشروط المالية» rows — banks, payment milestones, instalment (finance-terms.ts) */
  finance?: FinanceTerm[];
  /**
   * Each country's services (from /services), one per name — offered under
   * «يشمل» as «خدمات الدولة». Names only: the prices stay on the server, and
   * «اقتراح التسعير» finds them again by this exact name.
   */
  countryServices: { country_id: string; name: string }[];
  /**
   * Partner companies that resell our files, for the customer stage's company
   * picker. Only name + colours: enough to choose and to preview the identity,
   * nothing the generator has any use for.
   */
  /** the carriers, for the flight stage's picker and the document's marks. */
  airlines: { iata: string; name: string; logo_url: string | null }[];
  /**
   * The hotel sources the agent may pick between, read from the enabled
   * suppliers rather than written into the screen — so connecting a new supplier
   * makes it appear on its own, and a demo one is flagged as demo.
   */
  hotelSources: { code: string; name: string; demo: boolean }[];
  /**
   * The agency's own suppliers (company_suppliers), for «المزوّد» beside a
   * flight or hotel price. `categories` is the admin's words: «فنادق، طيران».
   */
  companySuppliers?: { id: string; name: string; categories: string }[];
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
