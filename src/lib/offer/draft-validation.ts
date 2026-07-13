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
        // a supplier-selected hotel carries the rate's room name (not an internal
        // room_type_id) — treat its sourcing as satisfying the room requirement.
        room_type_id: h.room_type_id ?? (h.sourcing ? "supplier" : null),
        board_type: h.board_type,
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
  if (data.cities.length > 0 && missingHotelCities.length > 0) {
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
  if (data.flights.length === 0) warnings.push({ severity: "warning", stage: "flights", key: "pg.warn.noFlights" });

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
  if (data.pricing.items.length === 0) warnings.push({ severity: "warning", stage: "pricing", key: "pg.warn.noPricing" });

  return {
    ok: blocking.length === 0,
    blocking,
    warnings,
    stages: stageStatuses(data, blocking),
    nights: { used, total, match: used === total && total > 0 },
  };
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
    data.hotels.every((h) => Boolean((h.room_type_id || h.sourcing) && h.board_type));
  const pricingComplete = data.pricing.items.length > 0 && data.pricing.items.every((i) => i.sell_price != null);

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
    pricing: status(data.pricing.items.length > 0, pricingComplete, "pricing"),
    preview: data.produced_serial ? "complete" : "empty",
  };
}
