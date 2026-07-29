/**
 * Draft validation — pure and testable. Splits problems into BLOCKING errors
 * (stop production of the offer) vs WARNINGS (advice only), each attributed to
 * the stage that owns the fix so the validation panel can deep-link to it.
 * Structural rules delegate to the shared invariants module (offer/invariants.ts).
 */

import type { TranslationKey } from "@/lib/i18n";
import { validateInvariants, type InvariantViolation } from "./invariants";
import {
  deriveCityDates,
  totalCityNights,
  SCOPE_KEYS,
  SCOPE_STAGE,
  type DraftData,
  type StageKey,
} from "./draft-types";
import { flightTiming, itineraryStartDate, localDatePart } from "./schedule";
import { sellBlocks } from "@/lib/pricing/markup";

export type DraftIssue = {
  severity: "blocking" | "warning";
  stage: StageKey;
  /** i18n key for draft-level issues… */
  key?: TranslationKey;
  /** …or a pre-rendered bilingual invariant violation. */
  invariant?: InvariantViolation;
};

export type StageStatus = "empty" | "partial" | "complete" | "error";

export type DraftValidation = {
  ok: boolean;
  blocking: DraftIssue[];
  warnings: DraftIssue[];
  stages: Record<StageKey, StageStatus>;
  nights: { used: number; total: number; match: boolean };
};

const INVARIANT_STAGE: Record<InvariantViolation["code"], StageKey> = {
  nights_sum_mismatch: "cities",
  city_date_mismatch: "cities",
  hotel_date_mismatch: "hotels",
  hotel_missing_room_or_board: "hotels",
};

/**
 * How this hotel line states its rooms — internal room-type rows, names
 * inherited from the trip default, or a supplier rate that names its own room.
 *
 * EVERY room must be stated, not just the first: a second room added for a
 * driver and left blank would otherwise print as an unnamed room on a document
 * the client signs.
 */
function statedRoom(h: DraftData["hotels"][number]): string | null {
  const rooms = h.rooms.length > 0 ? h.rooms : [{ room_type_id: h.room_type_id, room_type_name: h.room_type_name }];
  const allStated = rooms.every((r) => Boolean(r.room_type_id || r.room_type_name.trim()));
  if (allStated) return "stated";
  return h.sourcing ? "supplier" : null;
}

/** null unless EVERY room says what it includes — same reasoning as statedRoom. */
function statedBoard(h: DraftData["hotels"][number]): string | null {
  const rooms = h.rooms.length > 0 ? h.rooms : [{ board_type: h.board_type }];
  return rooms.every((r) => Boolean(r.board_type)) ? (h.board_type ?? "stated") : null;
}

export function validateDraft(data: DraftData): DraftValidation {
  const blocking: DraftIssue[] = [];
  const warnings: DraftIssue[] = [];

  const itineraryStart = itineraryStartDate(data.trip, data.flights);
  const cities = deriveCityDates(itineraryStart, data.cities);
  const used = totalCityNights(cities);
  const total = data.trip.nights;

  // ---- trip-level blocking ----
  if (!data.trip.country.trim()) blocking.push({ severity: "blocking", stage: "trip", key: "pg.err.noCountry" });
  if (!data.trip.arrival_date) blocking.push({ severity: "blocking", stage: "trip", key: "pg.err.noArrival" });
  if (data.trip.adults <= 0) blocking.push({ severity: "blocking", stage: "trip", key: "pg.err.noAdults" });
  if (data.cities.length === 0) blocking.push({ severity: "blocking", stage: "cities", key: "pg.err.noCities" });

  // ---- structural invariants (nights sum, date spans, room+board) ----
  // Hotels inherit their city's derived dates; every hotel line must carry a
  // room type + board type (invariant #3).
  const cityByName = new Map(cities.map((c) => [c.city_name, c]));
  const invariantResult = validateInvariants({
    trip_nights: total,
    cities: cities.map((c) => ({
      city_name: c.city_name,
      nights: c.nights,
      check_in: c.check_in,
      check_out: c.check_out,
    })),
    hotels: data.hotels.map((h) => {
      const city = cityByName.get(h.city_name);
      return {
        hotel_name: h.hotel_name || h.city_name,
        // The rule is "this line states a room", not "this line has an internal
        // FK". A supplier rate carries the room in its own name, and a room type
        // inherited from the trip default is a name until a hotel is picked —
        // both are a stated room, and neither should block publishing.
        room_type_id: statedRoom(h),
        board_type: statedBoard(h),
        nights: city?.nights ?? null,
        check_in: city?.check_in ?? null,
        check_out: city?.check_out ?? null,
      };
    }),
  });
  for (const violation of invariantResult.violations) {
    // With no cities at all, the nights-sum violation duplicates pg.err.noCities.
    if (violation.code === "nights_sum_mismatch" && data.cities.length === 0) continue;
    blocking.push({ severity: "blocking", stage: INVARIANT_STAGE[violation.code], invariant: violation });
  }

  // Cities exist but no hotel lines yet → the offer can't print an itinerary.
  const missingHotelCities = cities.filter((c) => !data.hotels.some((h) => h.city_name === c.city_name));
  if (data.scope.hotels && data.cities.length > 0 && missingHotelCities.length > 0) {
    blocking.push({ severity: "blocking", stage: "hotels", key: "pg.err.missingHotels" });
  }

  // A supplier-priced line whose ACTUAL published SELL is below the supplier floor,
  // below the minimum margin, or non-positive BLOCKS publishing (prompt #2 min-margin,
  // #3 supplier floor). Critically, this re-checks the EFFECTIVE sell — the hotel
  // pricing item the agent may have edited in the Pricing stage AFTER pricing — not
  // the (possibly stale) sell computed at pricing time, so the floors can't be
  // bypassed by lowering the sell later.
  const supplierBlocked = data.hotels.some((h) => {
    const s = h.sourcing;
    if (!s) return false;
    const desc = `${h.city_name} — ${h.hotel_name}`;
    const item = data.pricing.items.find((p) => p.item_type === "hotel" && p.description === desc);
    const effectiveSell = item?.sell_price ?? s.sell_base;
    return sellBlocks(s.net_base, effectiveSell, { minMarginPct: s.min_margin_pct, floor: s.ref_sell_base }).length > 0;
  });
  if (supplierBlocked) {
    blocking.push({ severity: "blocking", stage: "hotels", key: "pg.supplier.blocked" });
  }

  // ---- warnings ----
  if (!data.customer.customer_name.trim()) warnings.push({ severity: "warning", stage: "customer", key: "pg.warn.noName" });
  if (!data.customer.customer_phone.trim()) warnings.push({ severity: "warning", stage: "customer", key: "pg.warn.noPhone" });
  if (data.scope.flights && data.flights.length === 0) {
    warnings.push({ severity: "warning", stage: "flights", key: "pg.warn.noFlights" });
  }

  // ---- flight guard rails (timezone-aware) ----
  // An impossible flight (arrives before it departs, once both airports resolve).
  if (data.flights.some((f) => flightTiming(f).arrivalBeforeDeparture)) {
    warnings.push({ severity: "warning", stage: "flights", key: "pg.warn.flightArrivalBeforeDeparture" });
  }
  // The outbound flight lands on a different date than the declared trip arrival —
  // hotel dates follow the flight, so this is worth surfacing.
  const outbound = data.flights.find((f) => f.leg_order === "outbound");
  const landing = localDatePart(outbound?.arrival_at);
  if (landing && data.trip.arrival_date && landing !== data.trip.arrival_date) {
    warnings.push({ severity: "warning", stage: "flights", key: "pg.warn.landingDateDiffers" });
  }
  if (data.services.includes.length === 0) warnings.push({ severity: "warning", stage: "services", key: "pg.warn.noServices" });

  // ---- ready-made company package («العروض الجاهزة») ----
  // Its price is fixed by management and carried in pricing.final_total instead
  // of priced line items, so the usual "no pricing lines" advice would be wrong.
  if (isFixedPrice(data)) {
    warnings.push({ severity: "warning", stage: "pricing", key: "ro.warn.fixedPrice" });
    if (outOfSeason(data)) {
      warnings.push({ severity: "warning", stage: "trip", key: "ro.warn.outOfSeason" });
    }
  } else if (data.pricing.items.length === 0) {
    warnings.push({ severity: "warning", stage: "pricing", key: "pg.warn.noPricing" });
  }

  // ONE gate for scope, rather than a guard on every push above: a stage the sale
  // excludes is hidden from the rail, so an issue pointing at it would be an
  // unfixable blocker — the agent cannot open the page to resolve it.
  const inScope = (issue: DraftIssue) => {
    const key = SCOPE_KEYS.find((k) => SCOPE_STAGE[k] === issue.stage);
    return key ? data.scope[key] : true;
  };
  const scopedBlocking = blocking.filter(inScope);

  return {
    ok: scopedBlocking.length === 0,
    blocking: scopedBlocking,
    warnings: warnings.filter(inScope),
    stages: stageStatuses(data, scopedBlocking),
    nights: { used, total, match: used === total && total > 0 },
  };
}

/** A draft seeded from a ready offer whose company price is already locked in. */
function isFixedPrice(data: DraftData): boolean {
  return Boolean(data.source && data.pricing.final_total && data.pricing.final_total > 0);
}

/** Travel date falls outside the season the company published the package for. */
function outOfSeason(data: DraftData): boolean {
  const date = data.trip.arrival_date;
  const from = data.source?.valid_from;
  const to = data.source?.valid_to;
  if (!date || (!from && !to)) return false;
  return Boolean((from && date < from) || (to && date > to));
}

function stageStatuses(data: DraftData, blocking: DraftIssue[]): Record<StageKey, StageStatus> {
  const hasBlocking = (stage: StageKey) => blocking.some((issue) => issue.stage === stage);

  const customerTouched = Boolean(data.customer.customer_name.trim() || data.customer.customer_phone.trim());
  const tripTouched = Boolean(data.trip.country || data.trip.arrival_date || data.trip.days > 0);
  const tripComplete = Boolean(data.trip.country.trim() && data.trip.arrival_date && data.trip.days > 0 && data.trip.adults > 0);
  const used = totalCityNights(data.cities);
  const hotelsComplete =
    data.cities.length > 0 &&
    data.cities.every((c) => data.hotels.some((h) => h.city_name === c.city_name)) &&
    data.hotels.every((h) => Boolean(statedRoom(h) && statedBoard(h)));
  const pricingComplete =
    isFixedPrice(data) || (data.pricing.items.length > 0 && data.pricing.items.every((i) => i.sell_price != null));
  const writtenDays = data.days.filter((d) => d.title.trim().length > 0);

  const status = (touched: boolean, complete: boolean, stage: StageKey): StageStatus => {
    if (hasBlocking(stage) && touched) return "error";
    if (complete) return "complete";
    if (touched) return "partial";
    return "empty";
  };

  return {
    customer: status(customerTouched, Boolean(data.customer.customer_name.trim()), "customer"),
    trip: status(tripTouched, tripComplete, "trip"),
    cities: status(data.cities.length > 0, data.cities.length > 0 && used === data.trip.nights && data.trip.nights > 0, "cities"),
    hotels: status(data.hotels.length > 0, hotelsComplete, "hotels"),
    flights: status(data.flights.length > 0, data.flights.length > 0, "flights"),
    transport: status(data.transport.length > 0, data.transport.length > 0, "transport"),
    services: status(
      data.services.includes.length + data.services.excludes.length + data.services.terms.length > 0,
      data.services.includes.length > 0,
      "services",
    ),
    visas: status(data.visas.length > 0, data.visas.length > 0, "visas"),
    // The daily program is OPTIONAL — it never blocks publishing. A day counts
    // as written only when it has a title; a bare skeleton is still "empty".
    itinerary: status(writtenDays.length > 0, writtenDays.length === data.days.length && data.days.length > 0, "itinerary"),
    pricing: status(data.pricing.items.length > 0 || isFixedPrice(data), pricingComplete, "pricing"),
    preview: data.produced_serial ? "complete" : "empty",
  };
}
