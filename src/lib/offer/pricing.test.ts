import { describe, it, expect } from "vitest";
import { convert, computeLine, computeOfferPricing, type CurrencyRates } from "./pricing";

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
