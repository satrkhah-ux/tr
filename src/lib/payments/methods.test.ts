import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEES,
  DEFAULT_SETTLEMENT,
  expectedSettlement,
  methodFeeFn,
  PAY_METHODS,
  PAYMENT_METHOD_LIST,
  PAYMENT_METHODS,
  parseFees,
  parseSettlement,
  paymentFee,
  quoteAll,
  quoteMethod,
} from "./methods";

describe("«وسائل الدفع ورسومها» (the owner, 2026-10-29)", () => {
  it("adds 8.766% for Tabby and Tamara on top of the price — the owner's sheet to the halala", () => {
    expect(quoteMethod(15_510, "tabby", DEFAULT_FEES)).toEqual({ method: "tabby", unset: false, fee: 1359.61, total: 16_869.61 });
    expect(quoteMethod(15_510, "tamara", DEFAULT_FEES)).toEqual({ method: "tamara", unset: false, fee: 1359.61, total: 16_869.61 });
  });

  it("adds 2.5% for Visa and a MyFatoorah link, nothing for cash/transfer/شبكة, 2 decimals", () => {
    expect(quoteMethod(10_000, "card", DEFAULT_FEES)).toEqual({ method: "card", unset: false, fee: 250, total: 10_250 });
    expect(quoteMethod(10_000, "link", DEFAULT_FEES)).toEqual({ method: "link", unset: false, fee: 250, total: 10_250 });
    expect(quoteMethod(10_000, "cash", DEFAULT_FEES)).toEqual({ method: "cash", unset: false, fee: 0, total: 10_000 });
    // 4,321 × 2.5% = 108.025 → 108.03
    expect(quoteMethod(4321, "card", DEFAULT_FEES)).toMatchObject({ fee: 108.03, total: 4429.03 });
  });

  it("reads the administration's settings over the defaults — a share to 3 decimals plus a fixed charge", () => {
    const fees = parseFees(JSON.stringify({ tabby: { pct: 6.125, fixed: 1 }, card: { pct: 2 } }));
    expect(fees.tabby).toEqual({ pct: 6.125, fixed: 1 });
    expect(quoteMethod(1000, "tabby", fees)).toEqual({ method: "tabby", unset: false, fee: 62.25, total: 1062.25 });
    expect(quoteMethod(1000, "card", fees)).toMatchObject({ total: 1020 });
    expect(fees.link).toEqual({ pct: 2.5, fixed: 0 });
  });

  it("lets the administration UNSET a method with null, and ignores nonsense", () => {
    expect(parseFees(JSON.stringify({ card: null })).card).toBeNull();
    expect(quoteMethod(1000, "card", parseFees(JSON.stringify({ card: null })))).toEqual({ method: "card", unset: true });
    expect(parseFees(JSON.stringify({ card: { pct: 95 } })).card).toEqual({ pct: 2.5, fixed: 0 });
    expect(parseFees(JSON.stringify({ card: { pct: "x" } })).card).toEqual({ pct: 2.5, fixed: 0 });
    expect(parseFees("not json")).toEqual(DEFAULT_FEES);
    expect(parseFees(null)).toEqual(DEFAULT_FEES);
  });

  it("gives F and G one call — fee, total, the client's line — and null for an unknown or unset method", () => {
    expect(paymentFee("tabby", 15_510, DEFAULT_FEES)).toEqual({ fee: 1359.61, total: 16_869.61, note: "16,869.61 ريال شامل الرسوم" });
    expect(paymentFee("card", 10_000, DEFAULT_FEES)).toEqual({ fee: 250, total: 10_250, note: "10,250 ريال شامل الرسوم" });
    expect(paymentFee("cash", 10_000, DEFAULT_FEES)).toEqual({ fee: 0, total: 10_000, note: "بدون رسوم" });
    expect(paymentFee("bitcoin", 10_000, DEFAULT_FEES)).toBeNull();
    expect(paymentFee("card", 10_000, parseFees(JSON.stringify({ card: null })))).toBeNull();
    // G's FeeFn shape: (methodId, amount) with the fees bound
    expect(methodFeeFn(DEFAULT_FEES)("tamara", 15_510)?.total).toBe(16_869.61);
    expect(PAYMENT_METHOD_LIST.map((m) => m.id)).toEqual([...PAY_METHODS]);
    expect(PAYMENT_METHODS).toEqual(PAY_METHODS);
  });

  it("quotes every method in the owner's order, and nothing for a zero price", () => {
    expect(quoteAll(500, DEFAULT_FEES).map((q) => q.method)).toEqual([...PAY_METHODS]);
    expect(quoteMethod(0, "card", DEFAULT_FEES)).toEqual({ method: "card", unset: false, fee: 0, total: 0 });
  });
});

describe("Tabby / Tamara settlement on Wednesdays (the owner, 2026-10-29)", () => {
  // 2026-10-26 is a Monday, 2026-10-28 a Wednesday
  it("pays a Monday's money not this Wednesday but the next — «بل الأربعاء الأخرى»", () => {
    expect(expectedSettlement("2026-10-26")).toBe("2026-11-04");
  });

  it("pays a Wednesday's money the following Wednesday, a Thursday's the Wednesday after next", () => {
    expect(expectedSettlement("2026-10-28")).toBe("2026-11-04");
    expect(expectedSettlement("2026-10-29")).toBe("2026-11-11");
  });

  it("follows the administration's weekday and lag", () => {
    // «the next Wednesday» reading: lag 0
    expect(expectedSettlement("2026-10-26", { weekday: 3, lagWeeks: 0 })).toBe("2026-10-28");
    // Sundays, two weeks later
    expect(expectedSettlement("2026-10-26", { weekday: 0, lagWeeks: 2 })).toBe("2026-11-15");
    expect(expectedSettlement("not a date")).toBeNull();
  });

  it("reads the setting safely", () => {
    expect(parseSettlement(null)).toEqual(DEFAULT_SETTLEMENT);
    expect(parseSettlement(JSON.stringify({ weekday: 9, lagWeeks: -1 }))).toEqual(DEFAULT_SETTLEMENT);
    expect(parseSettlement(JSON.stringify({ weekday: 0, lagWeeks: 2 }))).toEqual({ weekday: 0, lagWeeks: 2 });
  });
});
