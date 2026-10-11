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
  /**
   * Manual profit on top of the buy price, overriding whatever sell was stored.
   * Percentage wins when both are set — an agent who typed both meant the last
   * thing they typed, and silently adding them would produce a number neither
   * of them asked for.
   *
   * Applied to the UNIT buy price, so quantity multiplies the marked-up unit
   * exactly as it multiplies a typed one.
   */
  profit_pct?: number | null;
  profit_amount?: number | null;
};

/**
 * The unit sell price after a manual profit override.
 *
 * Exported because the draft has to store the resulting sell (the offer, the
 * document and the floor checks all read `sell_price`), and recomputing it in
 * two places is how they drift.
 */
export function applyManualProfit(
  buy: number | null,
  sell: number | null,
  profit_pct?: number | null,
  profit_amount?: number | null,
): number | null {
  if (buy == null) return sell;
  if (profit_pct != null && Number.isFinite(profit_pct)) return round2(buy * (1 + profit_pct / 100));
  if (profit_amount != null && Number.isFinite(profit_amount)) return round2(buy + profit_amount);
  return sell;
}

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

/**
 * «1 SAR = n X» → «SAR per 1 X», the shape every converter here uses.
 *
 * Keys in any case (the exchange-api feed is lower-case); anything that is
 * not a positive finite rate on a three-letter code is dropped rather than
 * turned into a nonsense rate.
 */
export function sarPerFromPerSar(perSar: Record<string, unknown>): CurrencyRates {
  const out: CurrencyRates = { SAR: 1 };
  for (const [code, rate] of Object.entries(perSar)) {
    if (/^[a-z]{3}$/i.test(code) && typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      out[code.toUpperCase()] = 1 / rate;
    }
  }
  return out;
}

/**
 * Rates re-based on the currency the client is quoted in.
 *
 * getRates() answers «SAR per one unit of X». Dividing by the quote currency's
 * own rate gives «quote currency per one unit of X», so computeOfferPricing
 * totals straight into it. null when the quote currency itself has no rate —
 * then no total can be trusted.
 */
export function rebase(sarPer: CurrencyRates, base: string): CurrencyRates | null {
  const own = base === "SAR" ? 1 : sarPer[base];
  if (own == null || !Number.isFinite(own) || own <= 0) return null;
  const out: CurrencyRates = {};
  for (const [code, rate] of Object.entries({ SAR: 1, ...sarPer })) out[code] = rate / own;
  return out;
}

export type OfferTotals = { total: number | null; buy_total: number | null; missing_rates: string[] };

/**
 * The offer's sell and buy totals, in the currency the client is quoted in.
 *
 * Every line is converted BEFORE it is added. Issuing used to add the raw
 * numbers, so a 1,200 THB transfer went into a SAR offer as 1,200 SAR — only
 * the pricing screen converted, and the agent saw one total while the client
 * was sent another. A line with no currency is in the quote currency, which
 * is what the raw sum always assumed. `missing_rates` lists codes with no
 * rate: the caller refuses to issue rather than print a sum that quietly left
 * them out.
 */
export function offerTotals(
  lines: PricingLineInput[],
  sarPer: CurrencyRates,
  base: string,
  finalTotal: number | null,
): OfferTotals {
  if (lines.length === 0) return { total: finalTotal, buy_total: null, missing_rates: [] };
  const rates = rebase(sarPer, base);
  if (!rates) return { total: finalTotal, buy_total: null, missing_rates: [base] };
  const summary = computeOfferPricing(
    lines.map((l) => ({ ...l, buy_currency: l.buy_currency || base, sell_currency: l.sell_currency || base })),
    rates,
    base,
  );
  return { total: finalTotal ?? summary.total_sell, buy_total: summary.total_buy, missing_rates: summary.missing_rates };
}

function nativeTotal(unit: number | null, quantity: number): number | null {
  if (unit == null || !Number.isFinite(unit)) return null;
  return round2(unit * quantity);
}

/** Compute per-line native + base amounts, profit and margin for one line. */
export function computeLine(line: PricingLineInput, rates: CurrencyRates, base: string): LinePricing {
  const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1;
  const total_buy = nativeTotal(line.buy_price, quantity);
  // A manual profit is stated against the buy price and in ITS currency, so it
  // is applied before conversion — marking up a converted figure would move the
  // margin every time the exchange rate did.
  const unitSell = applyManualProfit(line.buy_price, line.sell_price, line.profit_pct, line.profit_amount);
  const total_sell = nativeTotal(unitSell, quantity);

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
