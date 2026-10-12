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
  return `/package-generator/${draftId}`;
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
   * A room-type NAME, not an id: room_types rows belong to a hotel, and at this
   * point no hotel is chosen. The agent means "a suite", and the hotel stage
   * resolves that to the picked hotel's own row when it has one.
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
  /** derived from trip.arrival_date + the nights chain (deriveCityDates). */
  check_in: string | null;
  check_out: string | null;
};

/** One tour day of a city: what it is (a tour_programs row, or typed) and what it costs the group. */
export type TourPick = {
  program_id: string | null;
  title: string;
  /** the programme's description — the day's activity on the document. */
  text: string;
  price: number | null;
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
  /**
   * What THIS room costs for the whole stay.
   *
   * Per room, because a file routinely books two different ones — a double for
   * the parents and a triple for the children — and one price for the line
   * either overcharged for the smaller or undercharged for the larger. Null
   * means «not priced yet», which is not the same as free.
   */
  price: number | null;
  /** «إطلالة على البحر» — what this room looks out on, when the booking says. */
  view?: string;
};

export function emptyRoomSpec(): DraftRoomSpec {
  return { room_type_id: null, room_type_name: "", board_type: null, price: null };
}

/**
 * The rooms' types as one line — «ديلوكس × 2 + جناح». A stay booking two
 * different rooms printed only the first one's type.
 */
export function roomTypesText(
  rooms: Pick<DraftRoomSpec, "room_type_name" | "board_type" | "view">[],
  /** the board's printed name — given, so rooms on different boards say which is which. */
  boardLabel?: (board: BoardType) => string,
): string {
  const boards = new Set(rooms.map((r) => r.board_type ?? ""));
  const counts = new Map<string, number>();
  for (const r of rooms) {
    const name = r.room_type_name.trim();
    if (!name) continue;
    const view = r.view?.trim() ? ` — ${r.view.trim()}` : "";
    const board = boards.size > 1 && r.board_type && boardLabel ? ` (${boardLabel(r.board_type)})` : "";
    const key = `${name}${view}${board}`;
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

/** One hotel line per city (aligned by city_name). Prices live in the pricing stage. */
export type DraftHotel = {
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
      r.room_type_name === from ? { ...r, room_type_name: to, room_type_id: null } : r,
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
  const rooms = rawRooms.map((r) => ({
    ...emptyRoomSpec(),
    ...(r && typeof r === "object" ? (r as Partial<DraftRoomSpec>) : {}),
    price: typeof (r as Partial<DraftRoomSpec>)?.price === "number" ? (r as DraftRoomSpec).price : null,
  }));
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
    ...(typeof h.supplier === "string" && h.supplier ? { supplier: h.supplier } : {}),
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
};

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

export type FlightBooking = {
  mode: FlightBookingMode;
  cabin: string;
  intl_price: number | null;
  intl_currency: string;
  intl_supplier: string;
  dom_price: number | null;
  dom_currency: string;
  dom_supplier: string;
};

export function emptyFlightBooking(): FlightBooking {
  return {
    mode: "round",
    cabin: "اقتصادية",
    intl_price: null,
    intl_currency: "SAR",
    intl_supplier: "",
    dom_price: null,
    dom_currency: "SAR",
    dom_supplier: "",
  };
}

function normalizeFlightBooking(raw: unknown): FlightBooking {
  const b = (raw && typeof raw === "object" ? raw : {}) as Partial<FlightBooking>;
  const empty = emptyFlightBooking();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  return {
    mode: b.mode === "oneway" || b.mode === "multi" ? b.mode : "round",
    cabin: str(b.cabin, empty.cabin),
    intl_price: num(b.intl_price),
    intl_currency: str(b.intl_currency, "SAR") || "SAR",
    intl_supplier: str(b.intl_supplier, ""),
    dom_price: num(b.dom_price),
    dom_currency: str(b.dom_currency, "SAR") || "SAR",
    dom_supplier: str(b.dom_supplier, ""),
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
};

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
export function vehicleText(leg: TransportLeg, fallback = ""): string {
  const base = leg.car_type.trim() || fallback;
  if (!base) return "";
  return leg.cars > 1 ? `${base} × ${leg.cars}` : base;
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
export function deriveTransportRows(plan: TransportPlan, cities: { city_name: string; check_in: string | null }[]): DraftTransport[] {
  const rows: DraftTransport[] = [];
  const first = cities[0]?.city_name?.trim();
  const last = cities[cities.length - 1]?.city_name?.trim();

  if (plan.airport.enabled) {
    rows.push({
      from_place: TRANSPORT_AIRPORT,
      to_place: first ? `${TRANSPORT_HOTEL_PREFIX}${first}` : "الفندق",
      car_type: vehicleText(plan.airport),
      date: cities[0]?.check_in ?? null,
      note: plan.airport.note,
    });
    rows.push({
      from_place: last ? `${TRANSPORT_HOTEL_PREFIX}${last}` : "الفندق",
      to_place: TRANSPORT_AIRPORT,
      car_type: vehicleText(plan.farewell ?? plan.airport),
      date: null,
      note: plan.airport.note,
    });
  }

  if (plan.tours.enabled) {
    rows.push({
      from_place: TRANSPORT_TOURS,
      to_place: first ?? "",
      car_type: vehicleText(plan.tours),
      date: null,
      note: plan.tours.note,
    });
  }

  if (plan.intercity.enabled) {
    for (let i = 1; i < cities.length; i++) {
      const from = cities[i - 1]?.city_name?.trim();
      const to = cities[i]?.city_name?.trim();
      if (!from || !to) continue;
      rows.push({
        from_place: from,
        to_place: to,
        car_type: hopVehicle(plan, hopMode(plan, from, to)),
        date: cities[i]?.check_in ?? null,
        note: plan.intercity.note,
      });
    }
  }

  return rows;
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
    from_city: typeof f.from_city === "string" ? f.from_city : "",
    to_city: typeof f.to_city === "string" ? f.to_city : "",
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
  const cities = Array.isArray(source.cities) ? source.cities : [];

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
    hotels: Array.isArray(source.hotels) ? source.hotels.map(normalizeDraftHotel) : [],
    flights: Array.isArray(source.flights) ? source.flights.map(normalizeDraftFlight) : [],
    flight_booking: normalizeFlightBooking(source.flight_booking),
    transport_plan: transportPlan,
    // DERIVED, always. Rows are no longer authored, so a stale array from an
    // older draft is simply replaced by what the plan says today.
    // A sale that excludes transport prints no transfers. The PLAN is kept —
    // flip the switch back and the rows return — but leaving the rows derived
    // meant the document still promised an airport pickup on a file whose
    // transport switch was off.
    transport: scope.transport ? deriveTransportRows(transportPlan, cities) : [],
    services: { ...empty.services, ...(source.services ?? {}) },
    visas: Array.isArray(source.visas) ? source.visas : [],
    days: normalizeDraftDays(source.days),
    pricing: { ...empty.pricing, ...(source.pricing ?? {}) },
    produced_serial: typeof source.produced_serial === "string" ? source.produced_serial : null,
    source: normalizeDraftSource(source.source),
  };
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

/** A stay: one hotel line, with the dates its position in the city gives it. */
export type HotelStay = {
  line: DraftHotel;
  city_name: string;
  nights: number;
  check_in: string | null;
  check_out: string | null;
};

/** Nights allocated vs nights owed, per city. */
export type CityCoverage = {
  city_name: string;
  needed: number;
  covered: number;
  stays: HotelStay[];
};

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
 */
export function deriveHotelStays(cities: DraftCity[], hotels: DraftHotel[]): HotelStay[] {
  const out: HotelStay[] = [];
  for (const city of cities) {
    const lines = hotels.filter((h) => h.city_name === city.city_name);
    // What the explicit numbers do not claim is left for the lines that ask for
    // "the rest" — split evenly, remainder to the first, so 3 nights over 2
    // blank lines is 2+1 rather than 1.5 each.
    const explicit = lines.reduce((sum, l) => sum + Math.max(0, l.nights), 0);
    const blanks = lines.filter((l) => l.nights <= 0).length;
    let remaining = Math.max(0, city.nights - explicit);
    let cursor = city.check_in;

    lines.forEach((line, i) => {
      let nights = Math.max(0, line.nights);
      if (nights === 0 && blanks > 0) {
        const share = Math.floor(remaining / blanks);
        const isLastBlank = lines.filter((l, j) => l.nights <= 0 && j > i).length === 0;
        nights = isLastBlank ? remaining : share;
        remaining -= nights;
      }
      const check_in = cursor;
      const check_out = check_in ? addDays(check_in, nights) : null;
      cursor = check_out;
      out.push({ line, city_name: city.city_name, nights, check_in, check_out });
    });
  }
  return out;
}

/** Per-city allocated-vs-owed, for the coverage bar and the blocking check. */
export function hotelCoverage(cities: DraftCity[], hotels: DraftHotel[]): CityCoverage[] {
  const stays = deriveHotelStays(cities, hotels);
  return cities.map((city) => {
    const mine = stays.filter((s) => s.city_name === city.city_name);
    return {
      city_name: city.city_name,
      needed: city.nights,
      covered: mine.reduce((sum, s) => sum + s.nights, 0),
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
  /** IANA zone. Drives the time-difference note — see lib/offer/timezones.ts. */
  timezone: string | null;
  /** the country's own currency — offered in every currency dropdown. */
  default_currency?: string | null;
  cities: LookupCity[];
};
export type LookupRoomType = { id: string; name: string; hotel_id: string | null; default_board: BoardType | null };
/** `city` — the catalogue city the airport serves (airports.city_id), or null. */
export type LookupAirport = { id: string; name: string; code: string | null; timezone: string | null; city: string | null };

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
