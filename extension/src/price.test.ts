import { describe, expect, it } from "vitest";
import { readPrice } from "./price";

describe("a price as selected on a hotel site", () => {
  it("reads the number and the currency beside it", () => {
    expect(readPrice("SAR 1,890")).toEqual({ amount: 1890, currency: "SAR" });
    expect(readPrice("US$504 per stay")).toEqual({ amount: 504, currency: "USD" });
    expect(readPrice("ر.س ١٬٢٥٠")).toEqual({ amount: 1250, currency: "SAR" });
    expect(readPrice("1,250 ر.س")).toEqual({ amount: 1250, currency: "SAR" });
    expect(readPrice("€ 1.234")).toEqual({ amount: 1234, currency: "EUR" });
    expect(readPrice("RM 720")).toEqual({ amount: 720, currency: "MYR" });
    expect(readPrice("MYR 1 450")).toEqual({ amount: 1450, currency: "MYR" });
    expect(readPrice("TRY 12.500,50")).toEqual({ amount: 12500.5, currency: "TRY" });
    expect(readPrice("AED 899.99")).toEqual({ amount: 899.99, currency: "AED" });
  });

  it("takes the price to pay after the struck one", () => {
    expect(readPrice("SAR 2,100 SAR 1,890")).toEqual({ amount: 1890, currency: "SAR" });
    expect(readPrice("2,100 ر.س 1,890 ر.س")).toEqual({ amount: 1890, currency: "SAR" });
  });

  it("never takes a currency from a word away from the number", () => {
    // «الرسوم» holds «ر» and «س» — it is not «ر.س»
    expect(readPrice("USD 300 شامل الرسوم")).toEqual({ amount: 300, currency: "USD" });
    expect(readPrice("300 شامل الرسوم")).toEqual({ amount: 300, currency: null });
    // stars and nights are numbers too: the priced one wins
    expect(readPrice("فندق 5 نجوم — 3 ليالٍ — SAR 1,500")).toEqual({ amount: 1500, currency: "SAR" });
  });

  it("is nothing for nothing", () => {
    expect(readPrice("")).toBeNull();
    expect(readPrice("لا يوجد سعر")).toBeNull();
  });
});
