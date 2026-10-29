/**
 * RepackageData → the offer it issues (CreateOfferInput). Pure: no React, no
 * Supabase — so the mapping is tested without a database, and what the client's
 * document carries (and what it must never carry) is pinned in one place.
 *
 * What goes where:
 *   - the CLIENT (RepackageData.customer) → the offers row's customer;
 *   - our SELL = the package's price + the priced additions → `total`;
 *   - the supplier's COST → `buy_total` and the package's pricing line, internal
 *     tables only (never a hotel line, never the client's document);
 *   - the agent's additions → the «يشمل» list, and a pricing line each with its
 *     sell price and NO cost (an addition has none: it is ours to sell).
 */

import type { CreateOfferInput, OfferHotelInput, OfferPricingItemInput } from "@/lib/data/offers";
import type { RatesResult } from "@/lib/data/rates-actions";
import type { BoardType } from "@/lib/types";
import { convert, type CurrencyRates } from "@/lib/offer/pricing";
import {
  additionLine,
  clientTotal,
  packageNights,
  packageStays,
  packageStops,
  printableAdditions,
  type RepackageData,
} from "./repackage-types";

const BOARD_LABEL: Record<BoardType, string> = {
  RO: "غرفة فقط",
  BB: "شامل الإفطار",
  HB: "نصف إقامة",
  FB: "إقامة كاملة",
  AI: "شامل كليًا",
};

/** The description of the package's own pricing line — internal tables only, so it names no one. */
export const PACKAGE_LINE = "الباقة";

/**
 * The supplier's cost in the currency we sell in, so `pricings.buy_total` and
 * `offers.total` share one currency (the profit is their difference). Null when
 * the cost cannot be converted — the issue stops rather than store a cost in
 * the wrong currency.
 */
export function costInSellCurrency(
  cost: number | null,
  from: string,
  to: string,
  sarPer: CurrencyRates,
): { ok: true; amount: number | null } | { ok: false } {
  if (cost == null) return { ok: true, amount: null };
  const rates: CurrencyRates = { SAR: 1, ...sarPer };
  const f = from.trim().toUpperCase();
  const t = to.trim().toUpperCase();
  if (f === t) return { ok: true, amount: cost };
  const inSar = convert(cost, f, rates, "SAR");
  if (inSar == null) return { ok: false };
  const toRate = t === "SAR" ? 1 : rates[t];
  if (toRate == null || !Number.isFinite(toRate) || toRate <= 0) return { ok: false };
  return { ok: true, amount: Math.round((inSar / toRate + Number.EPSILON) * 100) / 100 };
}

export type OfferInputResult = { ok: true; input: CreateOfferInput } | { ok: false; error: "missingRates" | "noPackage" };

/**
 * `customerId` is the customers row the offer is filed under (looked up by the
 * caller — it needs the database). `rates` converts the supplier's cost when
 * it is in another currency than the sell price, and is stored with the offer.
 */
export function repackageOfferInput(
  data: RepackageData,
  opts: { customerId: string | null; importId: string; rates: RatesResult },
): OfferInputResult {
  const pkg = data.extracted;
  if (!pkg) return { ok: false, error: "noPackage" };

  const cost = costInSellCurrency(pkg.supplier_total, pkg.supplier_currency, data.final_currency, opts.rates.sarPer);
  if (!cost.ok) return { ok: false, error: "missingRates" };

  const nights = packageNights(pkg);
  const days = nights > 0 ? nights + 1 : 0;

  // One stay per hotel of each visit (a city visited twice keeps a hotel per
  // visit; two hotels in one visit chain inside it), dates chained from the
  // arrival — what the preview showed.
  const stays = packageStays(pkg);

  const hotels: OfferHotelInput[] = stays.flatMap((s) => {
    const h = s.hotel;
    if (!h) return [];
    return [
      {
        hotel_id: null,
        hotel_name: h.hotel_name || null,
        room_type_id: null,
        rooms_count: 1,
        board_type: s.board_type,
        check_in: s.check_in,
        check_out: s.check_out,
        nights: s.nights,
        // package priced as a whole (buy_total on pricings) → no per-line cost.
        buy_price: null,
        buy_currency: null,
        sell_price: null,
        sell_currency: null,
        // IP-SAFE: carry facts only. No supplier name / logo / photos lifted from
        // the PDF — supplier provenance stays as an opaque id on the offer row.
        cancellation_policy: null,
        excluded_surcharges: [],
        valid_until: null,
        supplier_id: null,
        supplier_name: null,
        rate_key: null,
        net_base: null,
        net_source_currency: null,
        fx_rate: null,
        fx_date: null,
        ref_sell_base: null,
        markup_amount: null,
        markup_pct: null,
        image_url: null,
        facilities: [],
        content_star_rating: null,
        room_type_name: h.room_type || null,
      },
    ];
  });

  const transferIncludes = pkg.transfers.map((t) => `المواصلات: ${t}`);
  const visaIncludes = pkg.visas.map((v) => `تأشيرة: ${v}`);
  const additions = printableAdditions(data);

  // The pricing lines: the package (sell + the supplier's cost, in ITS currency)
  // and each priced addition (sell only). They make the internal sheet add up to
  // the offer's total; the client's document reads none of them.
  const pricing_items: OfferPricingItemInput[] = [
    ...(data.final_total != null
      ? [
          {
            item_type: "service" as const,
            description: PACKAGE_LINE,
            quantity: 1,
            buy_price: pkg.supplier_total,
            buy_currency: pkg.supplier_total != null ? pkg.supplier_currency : null,
            sell_price: data.final_total,
            sell_currency: data.final_currency,
          },
        ]
      : []),
    ...additions
      .filter((a) => a.sell_price != null)
      .map((a) => ({
        item_type: "other" as const,
        description: a.title.trim(),
        quantity: 1,
        buy_price: null,
        buy_currency: null,
        sell_price: a.sell_price,
        sell_currency: data.final_currency,
      })),
  ];

  return {
    ok: true,
    input: {
      // the client link and the PDF read the name and phone from this row
      customer_id: opts.customerId,
      employee_id: null,
      destination: pkg.destination || pkg.country,
      duration: nights > 0 ? `${days} أيام / ${nights} ليالي` : null,
      offer_date: pkg.arrival_date,
      adults: pkg.adults,
      children: pkg.children,
      infants: pkg.infants,
      total: clientTotal(data), // our SELL: the package's price plus the priced additions
      buy_total: cost.amount, // supplier COST in the sell currency (internal — pricings only)
      currency: data.final_currency,
      // one row per VISIT, as the generator writes it: two hotels in one visit
      // name the first and say how many follow; each hotel is its own offer_hotels row
      cities: packageStops(pkg).map((stop, i) => {
        const mine = stays.filter((s) => s.stop === i);
        const first = mine[0];
        const extra = mine.length > 1 ? ` + ${mine.length - 1}` : "";
        return {
          city_name: stop.city_name,
          hotel_name: first?.hotel?.hotel_name ? `${first.hotel.hotel_name}${extra}` : null,
          room_type: first?.hotel?.room_type || null,
          nights: stop.nights,
          check_in: first?.check_in ?? null,
          check_out: mine.at(-1)?.check_out ?? null,
          meals: first?.board_type ? BOARD_LABEL[first.board_type] : null,
        };
      }),
      flights: pkg.flights.map((f) => ({
        carrier: f.airline || null,
        from_airport: f.from_airport || null,
        to_airport: f.to_airport || null,
        flight_date: f.departure_at ? f.departure_at.slice(0, 10) : null,
        passengers: pkg.adults + pkg.children,
        baggage: null,
        airline: f.airline || null,
        flight_no: f.flight_no || null,
        departure_at: f.departure_at,
        arrival_at: f.arrival_at,
        cabin_class: null,
        baggage_allowance: null,
        leg_order: null,
      })),
      services: [
        ...pkg.includes.map((label) => ({ label, kind: "include" as const })),
        ...transferIncludes.map((label) => ({ label, kind: "include" as const })),
        ...visaIncludes.map((label) => ({ label, kind: "include" as const })),
        // the agent's additions close the list, priced or not
        ...additions.map((a) => ({ label: additionLine(a), kind: "include" as const })),
        ...pkg.excludes.map((label) => ({ label, kind: "exclude" as const })),
      ],
      terms: pkg.terms,
      hotels,
      pricing_items,
      source_kind: "repackaged",
      source_supplier_id: data.source.supplier_id,
      source_import_id: opts.importId,
      // the rates the cost was converted at, frozen with the offer
      fx: opts.rates,
    },
  };
}
