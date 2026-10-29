import { syncTypedPricing } from "./pricing-suggest";
import { typedAsCost } from "./draft-cost";
import { deriveCityDates, deriveHotelStays, pricingRefFor, soldHotels, type DraftData, type DraftPricingItem } from "./draft-types";
import { itineraryStartDate } from "./schedule";
import { packageProfitFor, withPackageProfit } from "./basic";
import { applyManualProfit, offerTotals, rebase, type CurrencyRates, type OfferTotals, type PricingLineInput } from "./pricing";
import { quoteMethod, type PaymentFees, type PayMethod } from "@/lib/payments/methods";

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
  /** our price before the client's way of paying added its charge — `totals.total` when none did */
  base: number | null;
  /** that charge (0 for none): in `totals.total` AND `totals.buy_total`, so the profit is the same */
  fee: number;
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
  /** session E's getPaymentFees(); without it no method adds anything (a partner's file) */
  fees?: PaymentFees,
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
  const priced = pin == null ? own : offerTotals(lines, sarPer, data.pricing.display_currency, pin);
  const fee = methodFee(priced.total, chargedMethod(data.pricing), fees);
  const totals = fee === 0 || priced.total == null
    ? priced
    : { ...priced, total: round2(priced.total + fee), buy_total: priced.buy_total == null ? null : round2(priced.buy_total + fee), total_sar: round2(priced.total + fee) };
  return { items, lines, totals, unpinned: own.total, pinned: pin != null, base: priced.total, fee };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The method whose charge the issue adds: a riyal quote only — E's fees carry a fixed part in SAR. */
export const chargedMethod = (pricing: Pick<DraftData["pricing"], "payment_method" | "display_currency">): PayMethod | undefined =>
  (pricing.display_currency || "SAR") === "SAR" ? pricing.payment_method : undefined;

function methodFee(base: number | null, method: PayMethod | undefined, fees: PaymentFees | undefined): number {
  if (base == null || !method || !fees) return 0;
  const q = quoteMethod(base, method, fees);
  return q.unset ? 0 : q.fee;
}

/**
 * «اعتمد هذه»: a version's client total back to our price before its way of paying added its charge
 * (the issue lays the charge on again). The charge is rounded to the cent, so the base whose quote
 * lands on the total exactly; a fee the administration changed since lands nearest.
 */
export function beforeCharge(total: number, method: PayMethod | undefined, fees: PaymentFees): number {
  const fee = method ? fees[method] : null;
  if (!method || !fee || (fee.pct === 0 && fee.fixed === 0)) return total;
  const guess = round2((total - fee.fixed) / (1 + fee.pct / 100));
  for (const d of [0, -0.01, 0.01, -0.02, 0.02]) {
    const base = round2(guess + d);
    if (Math.abs(base + methodFee(base, method, fees) - total) < 0.005) return base;
  }
  return guess;
}

/** «اعتمد هذه»: the adopted version's total, while nothing priced has changed since the adoption. */
export function adoptedPin(adopted: DraftData["pricing"]["adopted"], unpinned: number | null): number | null {
  if (!adopted || unpinned == null || adopted.base == null) return null;
  return Math.abs(unpinned - adopted.base) < 0.005 ? adopted.total : null;
}

/** Whether the file now prices differently from the total it was issued at (whole units, as issued). */
export const priceMoved = (now: number | null, issued: number | null): boolean =>
  now != null && issued != null && Math.abs(now - issued) >= 0.005;
