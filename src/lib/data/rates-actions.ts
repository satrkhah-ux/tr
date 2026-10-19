"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sarPerFromPerSar, usdSarRate } from "@/lib/offer/pricing";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ttlCache } from "@/lib/ttl-cache";

/**
 * Currency rates as «SAR per 1 unit». The first source that answers wins:
 *   1. fawazahmed0/exchange-api on jsDelivr — free, keyless, no rate limit,
 *      300+ currencies, published daily (the agency's choice, 2026-10-11);
 *   2. the same feed on its Cloudflare mirror;
 *   3. open.er-api.com (keyless, ~160 currencies).
 * A custom RATES_API_URL (exchangerate.host-compatible, base=SAR) goes first
 * when set. EVERY currency a source returns is kept: the old filter to nine
 * codes made a VND or GEL line «missing a rate» even with a live feed.
 *
 * The offline table is the last resort and says so (`source: "fallback"`).
 */

export type RatesResult = {
  sarPer: Record<string, number>;
  source: "live" | "fallback";
  updatedAt: string;
};

/**
 * SAR per 1 unit — the offline table, as of 2026-10-11. The previous values
 * had drifted up to 45% (TRY 0.11 against 0.076 live), and every total
 * computed while the feeds were unreachable carried that error.
 */
const FALLBACK_SAR_PER: Record<string, number> = {
  SAR: 1,
  USD: 3.75,
  EUR: 4.2,
  GBP: 4.96,
  AED: 1.021,
  TRY: 0.0762,
  MYR: 0.918,
  THB: 0.1115,
  IDR: 0.00021,
  SGD: 2.929,
  GEL: 1.442,
  AZN: 2.204,
  EGP: 0.0716,
  RUB: 0.044,
  VND: 0.000145,
};

// A fresh signal per request: one made at module load would already be spent.
const fetchOptions = () => ({ next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) });

/** exchange-api: `{ date: "2026-10-11", sar: { usd: 0.2667, … } }` (1 SAR = n X). */
async function fromExchangeApi(url: string): Promise<RatesResult | null> {
  const res = await fetch(url, fetchOptions());
  if (!res.ok) return null;
  const json = (await res.json()) as { date?: string; sar?: Record<string, unknown> };
  if (!json.sar) return null;
  const sarPer = sarPerFromPerSar(json.sar);
  if (Object.keys(sarPer).length < 2) return null;
  return { sarPer, source: "live", updatedAt: json.date ? `${json.date}T00:00:00.000Z` : new Date().toISOString() };
}

/** open.er-api / exchangerate.host: `{ rates: { USD: 0.2667, … } }` against base SAR. */
async function fromRatesApi(url: string): Promise<RatesResult | null> {
  const res = await fetch(url, fetchOptions());
  if (!res.ok) return null;
  const json = (await res.json()) as { rates?: Record<string, unknown>; time_last_update_unix?: number };
  if (!json.rates) return null;
  const sarPer = sarPerFromPerSar(json.rates);
  if (Object.keys(sarPer).length < 2) return null;
  const when = json.time_last_update_unix ? new Date(json.time_last_update_unix * 1000) : new Date();
  return { sarPer, source: "live", updatedAt: when.toISOString() };
}

// a minute: a changed rate reaches every new price within one
const usdRates = ttlCache<"usd", number>(60_000);

/** The company's dollar (pricing.ts usdSarRate) — app_settings `usd_sar_rate`, 3.80 until the administration sets another. */
async function companyUsd(): Promise<number> {
  const known = usdRates.get("usd");
  if (known) return known;
  try {
    const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient).from("app_settings").select("value").eq("key", "usd_sar_rate").maybeSingle();
    const rate = usdSarRate((data as { value?: string } | null)?.value);
    usdRates.set("usd", rate);
    return rate;
  } catch {
    return usdSarRate(null);
  }
}

/**
 * The rates every caller prices with — the feed for every currency but the
 * dollar, which is the company's (the owner, 2026-10-19: 3.80 «بدل السعر
 * الاصلي», profit and commissions included). The feed is SAR-based, so no
 * other currency leans on the dollar.
 */
export async function getRates(): Promise<RatesResult> {
  const [rates, usd] = await Promise.all([marketRates(), companyUsd()]);
  return { ...rates, sarPer: { ...rates.sarPer, USD: usd } };
}

// ten minutes: the feeds publish daily, and every page that prices asked them again (the owner, 2026-10-19: «ثقيلة»)
const marketCache = ttlCache<"market", RatesResult>(10 * 60_000);

async function marketRates(): Promise<RatesResult> {
  const known = marketCache.get("market");
  if (known) return known;
  const fresh = await fetchMarketRates();
  // the offline table is not kept: the next call tries the feeds again
  if (fresh.source === "live") marketCache.set("market", fresh);
  return fresh;
}

async function fetchMarketRates(): Promise<RatesResult> {
  const custom = process.env.RATES_API_URL;
  const sources = [
    ...(custom ? [() => fromRatesApi(`${custom}${custom.includes("?") ? "&" : "?"}base=SAR`)] : []),
    () => fromExchangeApi("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/sar.json"),
    () => fromExchangeApi("https://latest.currency-api.pages.dev/v1/currencies/sar.json"),
    () => fromRatesApi("https://open.er-api.com/v6/latest/SAR"),
  ];
  for (const source of sources) {
    try {
      const rates = await source();
      if (rates) return rates;
    } catch {
      // a timeout or a bad payload — try the next source
    }
  }
  return { sarPer: { ...FALLBACK_SAR_PER }, source: "fallback", updatedAt: new Date().toISOString() };
}
