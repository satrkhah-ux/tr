"use server";

/**
 * Currency rates. By default fetches a live keyless source (open.er-api.com,
 * base=SAR). A custom `RATES_API_URL` (exchangerate.host-compatible: base=SAR)
 * overrides it. If both fail, a maintained fallback table keeps the converter
 * working. Values are "SAR per 1 unit". Only the known currency set is exposed
 * so the converter dropdown stays stable regardless of source.
 */

export type RatesResult = {
  sarPer: Record<string, number>;
  source: "live" | "fallback";
  updatedAt: string;
};

/** SAR per 1 unit of currency (fallback / offline table). */
const FALLBACK_SAR_PER: Record<string, number> = {
  SAR: 1,
  USD: 3.75,
  EUR: 4.06,
  AED: 1.02,
  TRY: 0.11,
  MYR: 0.84,
  THB: 0.10,
  IDR: 0.00023,
  GBP: 4.77,
};

const KNOWN = Object.keys(FALLBACK_SAR_PER);

export async function getRates(): Promise<RatesResult> {
  const custom = process.env.RATES_API_URL;
  const endpoint = custom
    ? `${custom}${custom.includes("?") ? "&" : "?"}base=SAR&symbols=${KNOWN.filter((c) => c !== "SAR").join(",")}`
    : "https://open.er-api.com/v6/latest/SAR";

  try {
    const res = await fetch(endpoint, { next: { revalidate: 3600 } });
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      if (json.rates) {
        // Source gives SAR -> X; we need SAR per 1 X = 1 / rate.
        const sarPer: Record<string, number> = { SAR: 1 };
        for (const code of KNOWN) {
          if (code === "SAR") continue;
          const rate = json.rates[code];
          if (typeof rate === "number" && rate > 0) sarPer[code] = 1 / rate;
        }
        if (Object.keys(sarPer).length > 1) {
          return { sarPer, source: "live", updatedAt: new Date().toISOString() };
        }
      }
    }
  } catch {
    // fall through to fallback table
  }

  return { sarPer: { ...FALLBACK_SAR_PER }, source: "fallback", updatedAt: new Date().toISOString() };
}
