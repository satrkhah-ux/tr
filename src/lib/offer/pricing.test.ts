import { describe, it, expect } from "vitest";
import {
  convert,
  computeLine,
  computeOfferPricing,
  editedTotalSar,
  offerSarTotal,
  offerTotals,
  ratesFor,
  rebase,
  sarPerFromPerSar,
  type CurrencyRates,
} from "./pricing";

const rates: CurrencyRates = { SAR: 1, USD: 3.75 };

describe("convert", () => {
  it("passes base currency through", () => {
    expect(convert(100, "SAR", rates, "SAR")).toBe(100);
  });
  it("applies the rate to base", () => {
    expect(convert(100, "USD", rates, "SAR")).toBe(375);
  });
  it("returns null for an unknown currency", () => {
    expect(convert(100, "EUR", rates, "SAR")).toBeNull();
    expect(convert(100, null, rates, "SAR")).toBeNull();
  });
});

describe("manual profit", () => {
  it("prices a percentage on top of the buy price", () => {
    const line = computeLine(
      { quantity: 1, buy_price: 1000, buy_currency: "SAR", sell_price: 1100, sell_currency: "SAR", profit_pct: 20 },
      { SAR: 1 },
      "SAR",
    );
    // 1100 was the stored sell; the agent's 20% replaces it.
    expect(line.total_sell).toBe(1200);
    expect(line.profit_base).toBe(200);
  });

  it("prices a flat amount", () => {
    const line = computeLine(
      { quantity: 1, buy_price: 1000, buy_currency: "SAR", sell_price: null, sell_currency: "SAR", profit_amount: 350 },
      { SAR: 1 },
      "SAR",
    );
    expect(line.total_sell).toBe(1350);
  });

  it("lets the percentage win when both are set, rather than adding them", () => {
    const line = computeLine(
      {
        quantity: 1,
        buy_price: 1000,
        buy_currency: "SAR",
        sell_price: null,
        sell_currency: "SAR",
        profit_pct: 10,
        profit_amount: 500,
      },
      { SAR: 1 },
      "SAR",
    );
    expect(line.total_sell).toBe(1100);
  });

  it("multiplies the marked-up UNIT by quantity", () => {
    const line = computeLine(
      { quantity: 3, buy_price: 100, buy_currency: "SAR", sell_price: null, sell_currency: "SAR", profit_pct: 10 },
      { SAR: 1 },
      "SAR",
    );
    expect(line.total_sell).toBe(330);
  });

  it("leaves the stored sell alone when neither is set", () => {
    const line = computeLine(
      { quantity: 1, buy_price: 1000, buy_currency: "SAR", sell_price: 1234, sell_currency: "SAR" },
      { SAR: 1 },
      "SAR",
    );
    expect(line.total_sell).toBe(1234);
  });

  it("cannot invent a sell for a line with no buy price", () => {
    const line = computeLine(
      { quantity: 1, buy_price: null, buy_currency: "SAR", sell_price: 900, sell_currency: "SAR", profit_pct: 50 },
      { SAR: 1 },
      "SAR",
    );
    expect(line.total_sell).toBe(900);
  });
});

describe("computeLine", () => {
  it("computes native totals, profit and margin", () => {
    const line = computeLine(
      { quantity: 2, buy_price: 100, buy_currency: "SAR", sell_price: 150, sell_currency: "SAR" },
      rates,
      "SAR",
    );
    expect(line.total_buy).toBe(200);
    expect(line.total_sell).toBe(300);
    expect(line.profit_base).toBe(100);
    expect(line.margin_pct).toBeCloseTo(33.33, 1);
  });
});

describe("computeOfferPricing", () => {
  it("rolls up a multi-currency offer with profit + margin", () => {
    const summary = computeOfferPricing(
      [
        // USD line → 375 buy / 562.5 sell in SAR
        { item_type: "hotel", quantity: 1, buy_price: 100, buy_currency: "USD", sell_price: 150, sell_currency: "USD" },
        // SAR line → 200 buy / 250 sell
        { item_type: "flight", quantity: 1, buy_price: 200, buy_currency: "SAR", sell_price: 250, sell_currency: "SAR" },
      ],
      rates,
      "SAR",
    );
    expect(summary.total_buy).toBe(575);
    expect(summary.total_sell).toBe(812.5);
    expect(summary.profit).toBe(237.5);
    expect(summary.margin_pct).toBeCloseTo(29.23, 1);
    expect(summary.currencies).toContain("USD");
    expect(summary.currencies).toContain("SAR");
  });

  it("flags currencies with no rate instead of counting them as zero", () => {
    const summary = computeOfferPricing(
      [{ item_type: "visa", quantity: 1, buy_price: 10, buy_currency: "JPY", sell_price: 20, sell_currency: "JPY" }],
      rates,
      "SAR",
    );
    expect(summary.missing_rates).toContain("JPY");
    expect(summary.total_sell).toBe(0);
  });

  it("returns null margin when total_sell is zero", () => {
    const summary = computeOfferPricing([], rates, "SAR");
    expect(summary.total_sell).toBe(0);
    expect(summary.margin_pct).toBeNull();
  });
});

describe("offerTotals — the issued total converts every line", () => {
  const sarPer: CurrencyRates = { SAR: 1, USD: 3.75, THB: 0.1 };
  const line = (sell: number, cur: string, quantity = 1) => ({
    quantity,
    buy_price: null,
    buy_currency: cur,
    sell_price: sell,
    sell_currency: cur,
  });
  const mixed = [line(3000, "SAR"), line(1200, "THB"), line(2000, "THB")];

  it("1,200 THB is 120 SAR, not 1,200 — the raw-sum bug", () => {
    expect(offerTotals(mixed, sarPer, "SAR", null).total).toBe(3320);
  });
  it("totals in the quote currency the client is sent", () => {
    expect(offerTotals(mixed, sarPer, "USD", null).total).toBe(886); // 885.33 up to the whole dollar
  });
  it("the client's total goes up to the whole riyal — the owner, 2026-10-18", () => {
    expect(offerTotals([line(7371.5, "SAR")], sarPer, "SAR", null).total).toBe(7372);
    expect(offerTotals([line(7371.01, "SAR")], sarPer, "SAR", null).total).toBe(7372);
    expect(offerTotals([line(7371, "SAR")], sarPer, "SAR", null).total).toBe(7371);
  });
  it("a typed final total wins", () => {
    expect(offerTotals(mixed, sarPer, "SAR", 4599).total).toBe(4599);
  });
  it("reports a currency with no rate instead of silently leaving it out", () => {
    expect(offerTotals([line(100, "SAR"), line(100, "VND")], sarPer, "SAR", null).missing_rates).toEqual(["VND"]);
  });
  it("an unknown quote currency is itself reported", () => {
    expect(offerTotals(mixed, sarPer, "XYZ", null).missing_rates).toEqual(["XYZ"]);
  });
  it("a line with no currency is in the quote currency", () => {
    expect(offerTotals([line(50, "")], sarPer, "USD", null).total).toBe(50);
  });
  it("a manual profit is applied in the buy currency, before converting", () => {
    const l = { quantity: 1, buy_price: 1000, buy_currency: "THB", sell_price: null, sell_currency: "THB", profit_pct: 20 };
    expect(offerTotals([l], sarPer, "SAR", null)).toMatchObject({ total: 120, buy_total: 100 });
  });
  it("no lines → the typed total, no buy total", () => {
    expect(offerTotals([], sarPer, "SAR", null)).toEqual({ total: null, buy_total: null, total_sar: null, missing_rates: [] });
  });
  it("total_sar is the quoted total back in riyals — typed or computed", () => {
    expect(offerTotals(mixed, sarPer, "SAR", null).total_sar).toBe(3320);
    expect(offerTotals(mixed, sarPer, "USD", 1000).total_sar).toBe(3750);
    expect(offerTotals(mixed, sarPer, "XYZ", 1000).total_sar).toBeNull();
  });
  it("rebase keeps SAR reachable from any quote currency", () => {
    expect(rebase(sarPer, "USD")?.SAR).toBeCloseTo(1 / 3.75, 10);
  });
});

describe("the issued offer's rate snapshot", () => {
  const sarPer: CurrencyRates = { SAR: 1, USD: 3.75, THB: 0.1, EUR: 4.2 };
  it("keeps only the codes the offer uses, plus SAR", () => {
    expect(ratesFor(sarPer, ["THB", null, "", "USD", "VND"])).toEqual({ SAR: 1, THB: 0.1, USD: 3.75 });
  });
  it("recomputed at the stored rates, in the offer's own currency", () => {
    const stored = ratesFor(sarPer, ["THB", "USD"]);
    const lines = [{ quantity: 1, buy_price: 750, buy_currency: "THB", sell_price: 1000, sell_currency: "THB" }];
    const summary = computeOfferPricing(lines, rebase(stored, "USD") ?? {}, "USD");
    expect(summary).toMatchObject({ base: "USD", total_sell: 26.67, total_buy: 20, missing_rates: [] });
  });
});

describe("offerSarTotal — KPIs add riyals, never mixed currencies", () => {
  it("counts another currency at its stored riyal total", () => {
    expect(offerSarTotal({ total: 1000, total_sar: 3750, currency: "USD" })).toBe(3750);
  });
  it("counts a riyal offer at its live total, not a riyal figure left behind by an edit", () => {
    // issued at 10,000, then edited to 12,000 on /offers
    expect(offerSarTotal({ total: 12000, total_sar: 10000, currency: "SAR" })).toBe(12000);
  });
  it("an older offer counts its total only when it was quoted in riyals or said nothing", () => {
    expect(offerSarTotal({ total: 500, total_sar: null, currency: "SAR" })).toBe(500);
    expect(offerSarTotal({ total: "500.00", total_sar: null, currency: null })).toBe(500);
    expect(offerSarTotal({ total: 4000, total_sar: null, currency: "USD" })).toBe(0);
  });
  it("a missing total is nothing", () => {
    expect(offerSarTotal({ total: null, currency: "SAR" })).toBe(0);
  });
});

describe("editedTotalSar — an edited total moves its riyal figure with it", () => {
  it("a riyal offer is its total", () => {
    expect(editedTotalSar({ total: 10000, total_sar: 10000, currency: "SAR" }, 12000, 1)).toBe(12000);
  });
  it("another currency keeps the rate it was issued at, not today's", () => {
    expect(editedTotalSar({ total: 1000, total_sar: 3750, currency: "USD" }, 1200, 3.8)).toBe(4500);
  });
  it("falls back to today's rate when it never had a riyal figure, and to null without one", () => {
    expect(editedTotalSar({ total: 1000, total_sar: null, currency: "USD" }, 1200, 3.8)).toBe(4560);
    expect(editedTotalSar({ total: 1000, total_sar: null, currency: "XYZ" }, 1200, undefined)).toBeNull();
    expect(editedTotalSar({ total: 1000, total_sar: 3750, currency: "USD" }, null, 3.8)).toBeNull();
  });
});

describe("sarPerFromPerSar — the exchange-api feed", () => {
  it("inverts «1 SAR = n X» and upper-cases the codes", () => {
    const r = sarPerFromPerSar({ usd: 0.26666667, thb: 8.96509614 });
    expect(r.SAR).toBe(1);
    expect(r.USD).toBeCloseTo(3.75, 4);
    expect(r.THB).toBeCloseTo(0.11154, 4);
  });
  it("drops zero, negative, non-numeric and non-currency keys", () => {
    expect(Object.keys(sarPerFromPerSar({ eur: 0, gbp: -1, try: "13", "1inch": 2, sar: 1 })).sort()).toEqual(["SAR"]);
  });
});
