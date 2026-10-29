import { syncTypedPricing } from "./pricing-suggest";
import { typedAsCost } from "./draft-cost";
import { deriveCityDates, deriveHotelStays, pricingRefFor, soldHotels, type DraftData, type DraftPricingItem } from "./draft-types";
import { itineraryStartDate } from "./schedule";
import { packageProfitFor, withPackageProfit } from "./basic";
import { applyManualProfit, offerTotals, rebase, type CurrencyRates, type OfferTotals, type PricingLineInput } from "./pricing";

/**
 * How an issue prices a file — ONE function for the issue itself (produceOfferFromDraft), for
 * «تطبيق تحديث السعر» (is the file's price still the issued one?) and for «اعتمد هذه» (an older
 * version back at its own price), so the three can never disagree (the owner, 2026-10-29).
 */

/** The stays a hotel line may still price: a removed hotel's price never issues as a phantom line. */
export function issuedHotelRefs(data: DraftData): Set<string> {
  const stays = deriveHotelStays(deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities), soldHotels(data));
  return new Set(stays.flatMap((s) => [pricingRefFor(s), `${s.city_name} — ${s.line.hotel_name}`]));
}

/** Our own file's sheet as issuing reads it: a figure an agent typed is our cost, so the margin goes on it. */
export const ownIssueSheet = (data: DraftData): DraftPricingItem[] => typedAsCost(syncTypedPricing(data).items);

export type IssuePricing = {
  items: DraftPricingItem[];
  /** each line at the sell the agent sees — a manual profit applied */
  lines: PricingLineInput[];
  totals: OfferTotals;
  /** the total before any «اعتمد هذه» pin — what the file itself prices at */
  unpinned: number | null;
  pinned: boolean;
};

/**
 * The sheet priced for issue: stale hotel lines dropped, the package profit laid on, each line's
 * manual profit applied, the total rounded up in the quote currency. While the file is still the
 * version it adopted (its own total = the `base` recorded then), the adopted version's total stands.
 */
export function issuePricing(
  sheet: DraftPricingItem[],
  data: Pick<DraftData, "pricing">,
  validHotelRefs: Set<string>,
  defaultPct: number | null,
  sarPer: CurrencyRates,
): IssuePricing {
  const quote = data.pricing.display_currency || "SAR";
  const items = withPackageProfit(
    sheet.filter((it) => it.item_type !== "hotel" || validHotelRefs.has(it.ref ?? it.description ?? "")),
    packageProfitFor(data.pricing, defaultPct),
    rebase(sarPer, quote) ?? {},
    quote,
  );
  const lines = items.map((item) => ({
    quantity: item.quantity,
    buy_price: item.buy_price,
    buy_currency: item.buy_currency,
    sell_price: applyManualProfit(item.buy_price, item.sell_price, item.profit_pct, item.profit_amount),
    sell_currency: item.sell_currency,
  }));
  const own = offerTotals(lines, sarPer, data.pricing.display_currency, data.pricing.final_total);
  const pin = adoptedPin(data.pricing.adopted, own.total);
  const totals = pin == null ? own : offerTotals(lines, sarPer, data.pricing.display_currency, pin);
  return { items, lines, totals, unpinned: own.total, pinned: pin != null };
}

/** «اعتمد هذه»: the adopted version's total, while nothing priced has changed since the adoption. */
export function adoptedPin(adopted: DraftData["pricing"]["adopted"], unpinned: number | null): number | null {
  if (!adopted || unpinned == null || adopted.base == null) return null;
  return Math.abs(unpinned - adopted.base) < 0.005 ? adopted.total : null;
}

/** Whether the file now prices differently from the total it was issued at (whole units, as issued). */
export const priceMoved = (now: number | null, issued: number | null): boolean =>
  now != null && issued != null && Math.abs(now - issued) >= 0.005;
