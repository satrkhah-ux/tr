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
  deriveHotelStays,
  hotelCoverage,
  pricingRefFor,
  SCOPE_KEYS,
  stayTotal,
  totalCityNights,
  STAGE_SCOPE,
  type DraftData,
  type StageKey,
} from "./draft-types";
import { flightTiming, itineraryStartDate, localDatePart } from "./schedule";
import { citiesFromFlights, citiesMatchFlights, domesticMismatches } from "./flight-cities";
import { dayOneIsUsable } from "./timezones";
import { sellBlocks } from "@/lib/pricing/markup";
import { applyManualProfit } from "./pricing";

/**
 * Where an issue actually LIVES on the form.
 *
 * The panel could always say WHICH stage was wrong; it could never say which
 * box. An agent read "اختر دولة الرحلة" in a column on the far side of the
 * screen and then had to go hunting for the field it meant. These ids are what
 * let the message sit under the input instead.
 *
 * A dotted path names a single input; a bare name ("cities", "flights") names a
 * whole section, because "you have no cities" is not about one box.
 */
export type FieldId =
  | "trip.country"
  | "trip.arrival_date"
  | "trip.adults"
  | "customer.customer_name"
  | "customer.customer_phone"
  | "cities"
  | "hotels"
  | "flights"
  | "itinerary"
  | "services.includes"
  | "pricing"
  | "trip.rooms"
  | "trip.meal_plan"
  | "trip.nights"
  | "scope"
  | "transport"
  | "visas";

export type DraftIssue = {
  severity: "blocking" | "warning";
  stage: StageKey;
  /** which input on the form this is about — see FieldId. */
  field?: FieldId;
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

const INVARIANT_FIELD: Record<InvariantViolation["code"], FieldId> = {
  nights_sum_mismatch: "cities",
  city_date_mismatch: "cities",
  hotel_date_mismatch: "hotels",
  hotel_missing_room_or_board: "hotels",
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
  if (!data.trip.country.trim()) blocking.push({ severity: "blocking", stage: "trip", field: "trip.country", key: "pg.err.noCountry" });
  if (!data.trip.arrival_date) blocking.push({ severity: "blocking", stage: "trip", field: "trip.arrival_date", key: "pg.err.noArrival" });
  if (data.trip.adults <= 0) blocking.push({ severity: "blocking", stage: "trip", field: "trip.adults", key: "pg.err.noAdults" });
  if (data.cities.length === 0) blocking.push({ severity: "blocking", stage: "cities", field: "cities", key: "pg.err.noCities" });

  // ---- what each card may not leave empty ----
  // The card flow will not move past a card with one of these open, so each
  // names the card that owns the field. A partner company's file carries no
  // client of ours, so a direct sale is the only one asked for a name and phone.
  const need = (stage: StageKey, field: FieldId, key: TranslationKey) =>
    blocking.push({ severity: "blocking", stage, field, key });
  if (!isCompanySale(data)) {
    if (!data.customer.customer_name.trim()) need("customer", "customer.customer_name", "pg.warn.noName");
    if (!data.customer.customer_phone.trim()) need("customer", "customer.customer_phone", "pg.warn.noPhone");
  }
  if (data.trip.rooms <= 0) need("customer", "trip.rooms", "pg.err.noRooms");
  if (!data.trip.meal_plan) need("customer", "trip.meal_plan", "pg.err.noMealPlan");
  if (data.trip.nights <= 0) need("trip", "trip.nights", "pg.err.noNights");
  const anyScope = SCOPE_KEYS.some((k) => data.scope[k]) || data.transport_plan.tours.enabled;
  if (!anyScope) need("scope", "scope", "pg.scope.noneOn");
  if (data.scope.transport) {
    const plan = data.transport_plan;
    // an intercity leg that is flown or taken by train needs no vehicle
    const byCar = [plan.airport, plan.tours, ...(plan.intercity.mode === "car" ? [plan.intercity] : [])];
    if (byCar.some((leg) => leg.enabled && (!leg.car_type.trim() || leg.cars <= 0))) {
      need("transport", "transport", "pg.err.transportVehicle");
    }
  }
  if (data.scope.services && data.services.includes.length === 0) need("services", "services.includes", "pg.warn.noServices");
  if (data.scope.visas && (data.visas.length === 0 || data.visas.some((v) => !v.visa_type.trim()))) {
    need("visas", "visas", "pg.err.visaType");
  }
  // ---- flights: complete legs, one priced booking each, through a supplier ----
  // A ready-made package's locked total already holds the tickets.
  const legDone = (f: DraftData["flights"][number]) =>
    Boolean(f.from_airport.trim() && f.to_airport.trim() && f.flight_no.trim() && f.departure_at && f.arrival_at);
  const intl = data.flights.filter((f) => f.leg_order !== "internal");
  const dom = data.flights.filter((f) => f.leg_order === "internal");
  const booking = data.flight_booking;
  if (data.scope.flights_intl) {
    if (intl.length === 0) need("flights", "flights", "pg.err.noIntlFlights");
    else if (intl.some((f) => !legDone(f))) need("flights", "flights", "pg.err.flightIncomplete");
    if (intl.length > 0 && !isFixedPrice(data)) {
      if (booking.intl_price == null || booking.intl_price <= 0) need("flights", "flights", "pg.err.flightUnpriced");
      if (!booking.intl_supplier.trim()) need("flights", "flights", "pg.err.flightSupplier");
    }
  }
  if (data.scope.flights_domestic && dom.length > 0) {
    if (dom.some((f) => !legDone(f))) need("flights", "flights", "pg.err.flightIncomplete");
    if (!isFixedPrice(data)) {
      if (booking.dom_price == null || booking.dom_price <= 0) need("flights", "flights", "pg.err.domFlightUnpriced");
      if (!booking.dom_supplier.trim()) need("flights", "flights", "pg.err.domFlightSupplier");
    }
  }
  // The booking and the programme must agree on where the group sleeps.
  if (domesticMismatches(data.flights, cities).length > 0) need("flights", "flights", "pg.err.domesticMismatch");

  // A day with no title is a day the client reads as missing. «يوم حر» is a
  // title, so a deliberately empty day is one press away.
  if (data.days.length > 0 && data.days.some((d) => !d.title.trim())) need("itinerary", "itinerary", "pg.err.dayUntitled");

  // ---- structural invariants (nights sum, date spans, room+board) ----
  // A city's nights are covered by one or more stays in sequence; each stay
  // carries its own span, and every stay must state a room + board (invariant #3).
  const stays = deriveHotelStays(cities, data.hotels);
  const coverage = hotelCoverage(cities, data.hotels);
  const invariantResult = validateInvariants({
    trip_nights: total,
    cities: cities.map((c) => ({
      city_name: c.city_name,
      nights: c.nights,
      check_in: c.check_in,
      check_out: c.check_out,
    })),
    // Each stay is checked against ITS OWN span, not its city's. A city split
    // across two hotels has two spans that are each shorter than the city, and
    // handing the city's dates to both would fail the date invariant on a
    // perfectly correct plan.
    hotels: stays.map((s) => ({
      hotel_name: s.line.hotel_name || s.city_name,
      // The rule is "this line states a room", not "this line has an internal
      // FK". A supplier rate carries the room in its own name, and a room type
      // inherited from the trip default is a name until a hotel is picked —
      // both are a stated room, and neither should block publishing.
      room_type_id: statedRoom(s.line),
      board_type: statedBoard(s.line),
      nights: s.nights,
      check_in: s.check_in,
      check_out: s.check_out,
    })),
  });
  for (const violation of invariantResult.violations) {
    // With no cities at all, the nights-sum violation duplicates pg.err.noCities.
    if (violation.code === "nights_sum_mismatch" && data.cities.length === 0) continue;
    blocking.push({
      severity: "blocking",
      stage: INVARIANT_STAGE[violation.code],
      field: INVARIANT_FIELD[violation.code],
      invariant: violation,
    });
  }

  // Nights, not rows.
  //
  // The old rule was "every city has a hotel line", which a city split across
  // two hotels satisfies while still leaving the guest without a room for two
  // of its nights — the exact failure this stage exists to prevent. Under and
  // over are both blocking: over means we are paying for a night the itinerary
  // does not have.
  const uncovered = coverage.filter((c) => c.covered !== c.needed);
  if (data.scope.hotels && data.cities.length > 0 && uncovered.length > 0) {
    blocking.push({ severity: "blocking", stage: "hotels", field: "hotels", key: "pg.err.missingHotels" });
  }
  // The hotel's price is typed on its stay — it changes daily, so it is never
  // taken from a list. A ready-made package carries its own locked total.
  if (
    data.scope.hotels &&
    !isFixedPrice(data) &&
    stays.some((s) => s.line.hotel_name.trim() && !s.line.sourcing && stayTotal(s.line) == null)
  ) {
    blocking.push({ severity: "blocking", stage: "hotels", field: "hotels", key: "pg.err.stayUnpriced" });
  }

  // A supplier-priced line whose ACTUAL published SELL is below the supplier floor,
  // below the minimum margin, or non-positive BLOCKS publishing (prompt #2 min-margin,
  // #3 supplier floor). Critically, this re-checks the EFFECTIVE sell — the hotel
  // pricing item the agent may have edited in the Pricing stage AFTER pricing — not
  // the (possibly stale) sell computed at pricing time, so the floors can't be
  // bypassed by lowering the sell later.
  const supplierBlocked = stays.some((stay) => {
    const s = stay.line.sourcing;
    if (!s) return false;
    const ref = pricingRefFor(stay);
    const desc = `${stay.city_name} — ${stay.line.hotel_name}`;
    const item = data.pricing.items.find(
      (p) => p.item_type === "hotel" && (p.ref ? p.ref === ref : p.description === desc),
    );
    // The floor is checked against what will actually be PUBLISHED, so a manual
    // profit counts here exactly as a typed sell price does — otherwise a line
    // marked up by rule would be judged on the price before the markup.
    const effectiveSell =
      applyManualProfit(item?.buy_price ?? null, item?.sell_price ?? null, item?.profit_pct, item?.profit_amount) ??
      s.sell_base;
    return sellBlocks(s.net_base, effectiveSell, { minMarginPct: s.min_margin_pct, floor: s.ref_sell_base }).length > 0;
  });
  if (supplierBlocked) {
    blocking.push({ severity: "blocking", stage: "hotels", field: "hotels", key: "pg.supplier.blocked" });
  }

  // ---- warnings ----
  // A file built FOR a partner company is not sold to a person we know: the
  // partner has the client, and asking us for their name and phone would be
  // asking for data we are not entitled to. So the two advisories only apply to
  // a direct sale.
  // The flights describe other cities than the card holds — one press on the
  // cities card takes the flights' version. Advice, not a block: a road city
  // the agent added between two flights is a legitimate difference.
  {
    const derived = citiesFromFlights(data.flights);
    if (derived && data.cities.length > 0 && !citiesMatchFlights(data.cities, derived)) {
      warnings.push({ severity: "warning", stage: "cities", field: "cities", key: "pg.warn.citiesDifferFromFlights" });
    }
  }

  // ---- flight guard rails (timezone-aware) ----
  // An impossible flight (arrives before it departs, once both airports resolve).
  if (data.flights.some((f) => flightTiming(f).arrivalBeforeDeparture)) {
    warnings.push({ severity: "warning", stage: "flights", field: "flights", key: "pg.warn.flightArrivalBeforeDeparture" });
  }
  // The outbound flight lands on a different date than the declared trip arrival —
  // hotel dates follow the flight, so this is worth surfacing.
  const outbound = data.flights.find((f) => f.leg_order === "outbound");
  const landing = localDatePart(outbound?.arrival_at);
  if (landing && data.trip.arrival_date && landing !== data.trip.arrival_date) {
    warnings.push({ severity: "warning", stage: "flights", field: "flights", key: "pg.warn.landingDateDiffers" });
  }
  // A group that lands at 04:00 or 23:40 is not touring that day. Selling one
  // there is the mistake this catches — the client counts the day and asks what
  // they paid for it.
  {
    const landing = data.flights.find((f) => f.leg_order === "outbound")?.arrival_at ?? null;
    const dayOne = data.days.find((d) => d.kind !== "travel");
    const planned = Boolean(dayOne && (dayOne.title.trim() || dayOne.activities.some((a) => a.trim())));
    if (landing && planned && !dayOneIsUsable(landing)) {
      warnings.push({ severity: "warning", stage: "itinerary", field: "itinerary", key: "pg.warn.dayOneLateArrival" });
    }
  }

  // The ONE thing the «الخدمات» switch does: a sale that includes no ground
  // services stops being nagged to list them. The stage itself stays — it
  // holds the «لا يشمل» list, which every document prints.

  // ---- ready-made company package («العروض الجاهزة») ----
  // Its price is fixed by management and carried in pricing.final_total instead
  // of priced line items, so the usual "no pricing lines" advice would be wrong.
  if (isFixedPrice(data)) {
    warnings.push({ severity: "warning", stage: "pricing", field: "pricing", key: "ro.warn.fixedPrice" });
    if (outOfSeason(data)) {
      warnings.push({ severity: "warning", stage: "trip", field: "trip.arrival_date", key: "ro.warn.outOfSeason" });
    }
  } else if (data.pricing.items.length === 0) {
    warnings.push({ severity: "warning", stage: "pricing", field: "pricing", key: "pg.warn.noPricing" });
  }


  // ONE gate for scope, rather than a guard on every push above: a stage the sale
  // excludes is hidden from the rail, so an issue pointing at it would be an
  // unfixable blocker — the agent cannot open the page to resolve it.
  const inScope = (issue: DraftIssue) => {
    const keys = STAGE_SCOPE[issue.stage];
    return keys ? keys.some((k) => data.scope[k]) : true;
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

/** Built for a registered partner company rather than for a walk-in client. */
export function isCompanySale(data: DraftData): boolean {
  return Boolean(data.customer.partner_company_id) || Boolean(data.customer.company.trim());
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

  const customerTouched = Boolean(
    data.customer.customer_name.trim() || data.customer.customer_phone.trim() || isCompanySale(data),
  );
  const tripTouched = Boolean(data.trip.country || data.trip.arrival_date || data.trip.days > 0);
  const tripComplete = Boolean(data.trip.country.trim() && data.trip.arrival_date && data.trip.days > 0 && data.trip.adults > 0);
  const used = totalCityNights(data.cities);
  const hotelsComplete =
    data.cities.length > 0 &&
    // «مكتمل» means every night has a bed, not "a row exists per city".
    hotelCoverage(data.cities, data.hotels).every((c) => c.covered === c.needed) &&
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
    // Always answered — the draft opens with a default scope, and every
    // combination of switches is a legitimate one.
    scope: "complete" as StageStatus,
    // Naming the partner company completes the stage on its own.
    customer: status(customerTouched, isCompanySale(data) || Boolean(data.customer.customer_name.trim()), "customer"),
    trip: status(tripTouched, tripComplete, "trip"),
    // «المدن والفنادق» is ONE card now, so it has to answer for both: a hotel
    // blocker used to sit on a chip of its own, and folding the cards without
    // folding the status would show a green tick over an offer that cannot be
    // produced.
    cities:
      (hasBlocking("cities") || hasBlocking("hotels")) && data.cities.length > 0
        ? "error"
        : status(
            data.cities.length > 0,
            data.cities.length > 0 &&
              used === data.trip.nights &&
              data.trip.nights > 0 &&
              (!data.scope.hotels || hotelsComplete),
            "cities",
          ),
    hotels: status(data.hotels.length > 0, hotelsComplete, "hotels"),
    transport: status(
      data.transport_plan.airport.enabled || data.transport_plan.tours.enabled || data.transport_plan.intercity.enabled,
      !hasBlocking("transport"),
      "transport",
    ),
    flights: status(data.flights.length > 0, data.flights.length > 0, "flights"),
    services: status(
      data.services.includes.length + data.services.excludes.length > 0,
      data.services.includes.length > 0,
      "services",
    ),
    // Terms never block and never warn — an offer may legitimately carry none.
    terms: data.services.terms.length > 0 ? "complete" : "empty",
    visas: status(data.visas.length > 0, data.visas.length > 0, "visas"),
    // The daily program is OPTIONAL — it never blocks publishing. A day counts
    // as written only when it has a title; a bare skeleton is still "empty".
    itinerary: status(writtenDays.length > 0, writtenDays.length === data.days.length && data.days.length > 0, "itinerary"),
    pricing: status(data.pricing.items.length > 0 || isFixedPrice(data), pricingComplete, "pricing"),
    preview: data.produced_serial ? "complete" : "empty",
  };
}
