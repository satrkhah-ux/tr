/**
 * Draft/import data → a CLIENT offer DTO, for previewing the real document
 * before anything is produced.
 *
 * Both wizards used to draw their own summary card: the generator has one
 * layout, the repackage wizard another, and the printed PDF a third. So the
 * screen never actually showed what the client would receive. This adapter lets
 * BOTH previews render `components/offer-doc/OfferDocument` — the same component
 * the published document and the PDF render — so "what you see is what prints"
 * is true again.
 *
 * Pure module: no React, no Supabase, no `node:*`. It builds a CLIENT DTO only,
 * so buy price / supplier cost are structurally out of reach.
 */

import { partnerBrand, type DocBrand } from "@/components/offer-doc/brand";
import { BOARD_AR } from "@/components/offer-doc/labels";
import type { ClientOfferDTO } from "./dto";
import {
  baggageLabel,
  deriveCityDates,
  deriveHotelStays,
  findLookupCountry,
  matchPartner,
  mealPlanIncludeLine,
  roomTypesText,
  soldHotels,
  stayCancellation,
  type DraftData,
  type GeneratorLookups,
  flightsLater,
  FLIGHTS_LATER_LINE,
} from "./draft-types";
import { itineraryStartDate } from "./schedule";
import { financeSection, type FinanceTerm } from "./finance-terms";
import { clientStayLine, draftTransportNote } from "./itinerary";
import { AIRPORT_TRANSFER_LINE, advancedDayNote, advancedLines, meetsElsewhere } from "./advanced";
import { offerTotals, type CurrencyRates } from "./pricing";
import { additionLine, clientTotal, packageNights, packageStays, printableAdditions, type ExtractedPackage, type RepackageData } from "@/lib/repackage/repackage-types";

/** Placeholder serial shown while the offer has not been produced yet. */
const PENDING_SERIAL = "—";

/** Days/nights as the document's cover prints them. */
function durationText(days: number, nights: number): string | null {
  return nights > 0 ? `${nights} ليالي - ${days} أيام` : null;
}

/**
 * The client DTO still carries a `pricing` block — the redaction strips its
 * internal keys but keeps the shape. The document reads it only on the INTERNAL
 * branch, so a preview supplies an empty one rather than a fabricated breakdown.
 */
const emptyPricing = (base: string): ClientOfferDTO["pricing"] => ({
  base,
  total_sell: 0,
  lines: [],
  currencies: [],
  missing_rates: [],
});

/** Fields a preview never has: no serial-time metadata, no climate lookup. */
const emptyBase = (): Pick<
  ClientOfferDTO,
  "employee_name" | "offer_date" | "validity_date" | "climate" | "transport" | "visas" | "days"
> => ({
  employee_name: null,
  offer_date: null,
  validity_date: null,
  climate: [],
  transport: [],
  visas: [],
  days: [],
});

/**
 * The package generator's live preview. Dates are derived exactly as
 * produceOfferFromDraft derives them, so the preview and the produced offer
 * agree on check-in/check-out.
 */
/** The «الشروط المالية» rows and the trip's country, from the lookups the editor already holds. */
export function draftFinance(data: Pick<DraftData, "trip">, lookups: Pick<GeneratorLookups, "countries" | "finance">): DraftFinance {
  return { items: lookups.finance ?? [], countryId: findLookupCountry(lookups.countries, data.trip.country)?.id ?? null };
}
export type DraftFinance = { items: FinanceTerm[]; countryId: string | null };

export function draftToPreviewOffer(
  data: DraftData,
  /** carriers, so the preview draws the same marks the produced PDF will. */
  airlines: GeneratorLookups["airlines"] = [],
  /** SAR per unit, so the preview totals in the quote currency the way issuing does. */
  sarPer: CurrencyRates = { SAR: 1 },
  /** «الشروط المالية» rows + the trip's country (draftFinance) — what the issued PDF prints */
  finance: DraftFinance = { items: [], countryId: null },
): ClientOfferDTO {
  const start = itineraryStartDate(data.trip, data.flights);
  const cities = deriveCityDates(start, data.cities);
  const nights = data.trip.nights || cities.reduce((sum, c) => sum + c.nights, 0);
  const days = data.trip.days || (nights > 0 ? nights + 1 : 0);
  const route = advancedLines(data.advanced);

  return {
    ...emptyBase(),
    serial: data.produced_serial ?? PENDING_SERIAL,
    destination: data.trip.destination || data.trip.country || null,
    customer_name: data.customer.customer_name || null,
    customer_phone: data.customer.customer_phone || null,
    arrival_date: data.trip.arrival_date,
    departure_date: data.trip.departure_date,
    duration: durationText(days, nights),
    issue_date: null,
    adults: data.trip.adults,
    children: data.trip.children,
    infants: data.trip.infants,
    total: draftSellTotal(data, sarPer),
    currency: data.pricing.display_currency,
    pricing: emptyPricing(data.pricing.display_currency),
    // what the issue prints: the hotels this file sells (soldHotels)
    hotels: deriveHotelStays(cities, soldHotels(data)).map(({ line: h, nights: stayNights, check_in, check_out }) => {
      return {
        city_name: h.city_name || null,
        hotel_name: h.hotel_name || null,
        stars: h.sourcing?.star_rating ?? null,
        room_type: roomTypesText(h.rooms, (b) => BOARD_AR[b]) || h.room_type_name || h.sourcing?.room_name || null,
        board_type: h.board_type,
        rooms_count: h.rooms_count,
        nights: stayNights,
        check_in,
        check_out,
        sell_price: null,
        sell_currency: null,
        cancellation_policy: stayCancellation(h),
        excluded_surcharges: h.sourcing?.excluded_surcharges ?? [],
        valid_until: h.sourcing?.valid_until ?? null,
        image_url: h.sourcing?.image_url ?? null,
        facilities: h.sourcing?.facilities ?? [],
      };
    }),
    // as the issue prints them: a part «أضف لاحقاً» is said, not shown (drafts.ts produce)
    flights: data.flights.filter((f) => !(f.leg_order === "internal" ? data.flight_booking.later_dom : data.flight_booking.later_intl)).map((f) => ({
      airline: f.airline || null,
      airline_iata: f.airline_iata || null,
      airline_logo_url: airlines.find((a) => a.iata === f.airline_iata)?.logo_url ?? null,
      flight_no: f.flight_no || null,
      from_airport: f.from_airport || null,
      to_airport: f.to_airport || null,
      departure_at: f.departure_at,
      arrival_at: f.arrival_at,
      cabin_class: f.cabin_class || null,
      baggage_allowance: baggageLabel(f) || null,
      leg_order: f.leg_order,
      sell_price: null,
      sell_currency: null,
    })),
    transport: data.transport
      .map((t) => (t.text || [t.from_place, t.to_place].filter(Boolean).join(" → ")) + (t.car_type ? ` — ${t.car_type}` : ""))
      .filter((line) => line.trim().length > 1),
    visas: data.visas.map((v) => [v.country, v.visa_type].filter(Boolean).join(" — ")).filter(Boolean),
    // The meal plan is stated the same way the produced offer states it, so
    // the agent is previewing the paper rather than something close to it.
    includes: [
      ...route.includes,
      // what the issued offer drops (withScopeLines), the preview drops too
      ...data.services.includes.filter((l) => !(meetsElsewhere(data.advanced) && l === AIRPORT_TRANSFER_LINE)),
      ...(mealPlanIncludeLine(data.trip) ? [mealPlanIncludeLine(data.trip)!] : []),
      ...(flightsLater(data) && !data.services.includes.includes(FLIGHTS_LATER_LINE) ? [FLIGHTS_LATER_LINE] : []),
    ],
    excludes: [...route.excludes, ...data.services.excludes],
    terms: data.services.terms,
    finance: financeSection(finance.items, {
      countryId: finance.countryId,
      total: draftSellTotal(data, sarPer),
      currency: data.pricing.display_currency,
      travelDate: start,
      issueDate: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
    }),
    days: data.days
      // index on the FULL list: the transport line depends on a day's neighbours
      .map((d, index) => ({ d, move: data.scope.transport ? advancedDayNote(draftTransportNote(data, data.days, index), data.advanced) : null }))
      .filter(({ d, move }) => d.title.trim() || d.activities.length > 0 || move)
      .map(({ d, move }) => ({
        transport_note: move,
        day_number: d.day_number,
        date: d.date,
        city_name: d.city_name,
        title: d.title,
        // as the issue adds it: the client's own hotel on the day the group reaches it
        activities: d.activities.concat(clientStayLine(cities, d.date) ?? []),
        temp_max: d.weather?.temp_max ?? null,
        temp_min: d.weather?.temp_min ?? null,
        rain_chance: d.weather?.rain_chance ?? null,
        weather_code: d.weather?.code ?? null,
        weather_source: d.weather?.source ?? null,
      })),
  };
}

/**
 * The draft's sell total — the number the client would see.
 *
 * Exported so the drafts list prints exactly what the preview prints: a fixed
 * company price when the draft came from a ready package, otherwise the priced
 * items. A second implementation in the list would drift the first time either
 * rule changed.
 */
export function draftSellTotal(data: DraftData, sarPer: CurrencyRates = { SAR: 1 }): number | null {
  const priced = data.pricing.items.filter((i) => i.sell_price != null);
  return offerTotals(priced, sarPer, data.pricing.display_currency, data.pricing.final_total).total;
}

/**
 * The repackage wizard's preview. Built on packageStays — the very mapping
 * produceRepackageOffer issues (each stop its own hotel, dates chained from the
 * arrival) — so the preview shows the offer that button will actually create.
 *
 * `supplier_total` is deliberately NOT read: the client sees our sell price
 * (`final_total` plus the priced additions), and the supplier's cost never
 * enters this tree.
 */
export function repackageToPreviewOffer(data: RepackageData): ClientOfferDTO | null {
  const pkg: ExtractedPackage | null = data.extracted;
  if (!pkg) return null;

  const nights = packageNights(pkg);
  const days = nights > 0 ? nights + 1 : 0;
  const stays = packageStays(pkg);

  return {
    ...emptyBase(),
    serial: data.produced_serial ?? PENDING_SERIAL,
    destination: pkg.destination || pkg.country || null,
    customer_name: data.customer.customer_name.trim() || null,
    customer_phone: data.customer.customer_phone.trim() || null,
    arrival_date: pkg.arrival_date,
    // the issued document ends where its last stay checks out — so does this one
    departure_date: stays.at(-1)?.check_out ?? pkg.departure_date,
    duration: durationText(days, nights),
    issue_date: null,
    adults: pkg.adults,
    children: pkg.children,
    infants: pkg.infants,
    // the package's sell price plus the priced additions — what the client pays
    total: clientTotal(data),
    currency: data.final_currency,
    pricing: emptyPricing(data.final_currency),
    hotels: stays.map((s) => ({
      city_name: s.city_name || null,
      hotel_name: s.hotel?.hotel_name || null,
      stars: null,
      room_type: s.hotel?.room_type || null,
      board_type: s.board_type,
      rooms_count: 1,
      nights: s.nights,
      check_in: s.check_in,
      check_out: s.check_out,
      sell_price: null,
      sell_currency: null,
      cancellation_policy: null,
      excluded_surcharges: [],
      valid_until: null,
      image_url: null,
      facilities: [],
    })),
    flights: pkg.flights.map((f) => ({
      airline: f.airline || null,
      flight_no: f.flight_no || null,
      from_airport: f.from_airport || null,
      to_airport: f.to_airport || null,
      departure_at: f.departure_at,
      arrival_at: f.arrival_at,
      cabin_class: null,
      baggage_allowance: null,
      leg_order: null,
      sell_price: null,
      sell_currency: null,
    })),
    transport: pkg.transfers,
    visas: pkg.visas,
    // the agent's additions close the «يشمل» list, as the issued offer prints them
    includes: [...pkg.includes, ...printableAdditions(data).map(additionLine)],
    excludes: pkg.excludes,
    terms: pkg.terms,
  };
}

/**
 * The brand the in-generator preview should draw.
 *
 * Same resolution the server does at export time, from the same two fields — so
 * an agent sees the partner's cover and colours BEFORE producing, not after.
 * Kept here rather than in the shell so both preview surfaces share it.
 */
export function draftBrand(
  data: DraftData,
  partners: GeneratorLookups["partners"],
  /** the viewer is the partner whose file this is — it prints its price */
  ownFile = false,
): { brand: DocBrand | undefined; showPrices: boolean } {
  const partner = matchPartner(data.customer, partners);
  if (!partner) return { brand: undefined, showPrices: true };
  // Matches what produceOfferFromDraft will write, so the preview here is what
  // comes out — and the export screen can still flip it per file afterwards.
  return { brand: partnerBrand(partner, partner.logo_url), showPrices: ownFile };
}
