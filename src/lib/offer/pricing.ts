/**
 * Offer pricing — pure, dependency-free, multi-currency.
 *
 * Every line carries its own buy/sell price + currency. To sum a mixed-currency
 * offer we convert each line into a single BASE currency (default SAR) using a
 * rates map. `rates[c]` = value of 1 unit of currency `c` expressed in the base
 * (so `rates.SAR === 1`). A currency with no rate is reported in `missing_rates`
 * and excluded from the base totals rather than silently counted as zero.
 *
 * This module NEVER decides who may see the numbers — it just computes them.
 * Redaction for client output happens in dto.ts (structural omission).
 */

import type { PricingItemType } from "@/lib/types";

export type CurrencyRates = Record<string, number>;

export type PricingLineInput = {
  item_type?: PricingItemType;
  description?: string | null;
  quantity: number;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
};

export type LinePricing = {
  item_type: PricingItemType | null;
  description: string | null;
  quantity: number;
  // native-currency line totals (quantity * unit price)
  total_buy: number | null;
  buy_currency: string | null;
  total_sell: number | null;
  sell_currency: string | null;
  // converted into the base currency (null when the rate is unknown)
  base_buy: number | null;
  base_sell: number | null;
  profit_base: number | null;
  margin_pct: number | null;
};

export type OfferPricingSummary = {
  base: string;
  total_buy: number;
  total_sell: number;
  profit: number;
  /** profit / total_sell * 100, or null when total_sell is 0. */
  margin_pct: number | null;
  lines: LinePricing[];
  currencies: string[];
  /** currencies seen on a line but absent from the rates map. */
  missing_rates: string[];
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Convert `amount` from `currency` into `base`. null when the rate is unknown. */
export function convert(
  amount: number,
  currency: string | null,
  rates: CurrencyRates,
  base: string,
): number | null {
  if (currency == null || currency === "") return null;
  if (currency === base) return round2(amount);
  const rate = rates[currency];
  if (rate == null || !Number.isFinite(rate)) return null;
  return round2(amount * rate);
}

function nativeTotal(unit: number | null, quantity: number): number | null {
  if (unit == null || !Number.isFinite(unit)) return null;
  return round2(unit * quantity);
}

/** Compute per-line native + base amounts, profit and margin for one line. */
export function computeLine(line: PricingLineInput, rates: CurrencyRates, base: string): LinePricing {
  const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1;
  const total_buy = nativeTotal(line.buy_price, quantity);
  const total_sell = nativeTotal(line.sell_price, quantity);

  const base_buy = total_buy == null ? null : convert(total_buy, line.buy_currency, rates, base);
  const base_sell = total_sell == null ? null : convert(total_sell, line.sell_currency, rates, base);

  const profit_base = base_buy != null && base_sell != null ? round2(base_sell - base_buy) : null;
  const margin_pct =
    profit_base != null && base_sell != null && base_sell !== 0 ? round2((profit_base / base_sell) * 100) : null;

  return {
    item_type: line.item_type ?? null,
    description: line.description ?? null,
    quantity,
    total_buy,
    buy_currency: line.buy_currency,
    total_sell,
    sell_currency: line.sell_currency,
    base_buy,
    base_sell,
    profit_base,
    margin_pct,
  };
}

/** Roll every line up into a single-currency offer summary (buy, sell, profit, margin). */
export function computeOfferPricing(
  lines: PricingLineInput[],
  rates: CurrencyRates,
  base = "SAR",
): OfferPricingSummary {
  const computed = lines.map((line) => computeLine(line, rates, base));

  const currencies = new Set<string>();
  const missing = new Set<string>();
  let total_buy = 0;
  let total_sell = 0;

  for (const line of computed) {
    for (const [amount, currency, converted] of [
      [line.total_buy, line.buy_currency, line.base_buy] as const,
      [line.total_sell, line.sell_currency, line.base_sell] as const,
    ]) {
      if (amount == null || currency == null || currency === "") continue;
      currencies.add(currency);
      if (converted == null) missing.add(currency);
    }
    if (line.base_buy != null) total_buy += line.base_buy;
    if (line.base_sell != null) total_sell += line.base_sell;
  }

  total_buy = round2(total_buy);
  total_sell = round2(total_sell);
  const profit = round2(total_sell - total_buy);
  const margin_pct = total_sell !== 0 ? round2((profit / total_sell) * 100) : null;

  return {
    base,
    total_buy,
    total_sell,
    profit,
    margin_pct,
    lines: computed,
    currencies: [...currencies].sort(),
    missing_rates: [...missing].sort(),
  };
}
