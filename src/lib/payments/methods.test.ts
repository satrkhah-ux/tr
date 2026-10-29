import { describe, expect, it } from "vitest";
import { DEFAULT_FEES, PAY_METHODS, parseFees, quoteAll, quoteMethod } from "./methods";

describe("«وسائل الدفع ورسومها» (the owner, 2026-10-29)", () => {
  it("adds 2.5% for Visa and a MyFatoorah link, nothing for cash/transfer/شبكة, rounded UP to the riyal", () => {
    expect(quoteMethod(10_000, "card", DEFAULT_FEES)).toEqual({ method: "card", unset: false, fee: 250, total: 10_250 });
    expect(quoteMethod(10_000, "link", DEFAULT_FEES)).toEqual({ method: "link", unset: false, fee: 250, total: 10_250 });
    expect(quoteMethod(10_000, "cash", DEFAULT_FEES)).toEqual({ method: "cash", unset: false, fee: 0, total: 10_000 });
    // 4,321 × 1.025 = 4,429.025 → 4,430: halalas never absorbed
    expect(quoteMethod(4321, "card", DEFAULT_FEES)).toMatchObject({ total: 4430, fee: 109 });
  });

  it("says Tabby and Tamara are unset until the administration sets them — never quotes a guessed price", () => {
    expect(quoteMethod(10_000, "tabby", DEFAULT_FEES)).toEqual({ method: "tabby", unset: true });
    expect(quoteMethod(10_000, "tamara", DEFAULT_FEES)).toEqual({ method: "tamara", unset: true });
  });

  it("reads the administration's settings over the defaults — a share plus a fixed charge", () => {
    const fees = parseFees(JSON.stringify({ tabby: { pct: 6, fixed: 1 }, card: { pct: 2 } }));
    expect(quoteMethod(1000, "tabby", fees)).toEqual({ method: "tabby", unset: false, fee: 61, total: 1061 });
    expect(quoteMethod(1000, "card", fees)).toMatchObject({ total: 1020 });
    // untouched methods keep their default
    expect(fees.link).toEqual({ pct: 2.5, fixed: 0 });
  });

  it("lets the administration UNSET a method with null, and ignores nonsense", () => {
    expect(parseFees(JSON.stringify({ card: null })).card).toBeNull();
    // out of range / not a number → the default stays
    expect(parseFees(JSON.stringify({ card: { pct: 95 } })).card).toEqual({ pct: 2.5, fixed: 0 });
    expect(parseFees(JSON.stringify({ card: { pct: "x" } })).card).toEqual({ pct: 2.5, fixed: 0 });
    expect(parseFees("not json")).toEqual(DEFAULT_FEES);
    expect(parseFees(null)).toEqual(DEFAULT_FEES);
  });

  it("quotes every method in the owner's order, and nothing for a zero price", () => {
    expect(quoteAll(500, DEFAULT_FEES).map((q) => q.method)).toEqual([...PAY_METHODS]);
    expect(quoteMethod(0, "card", DEFAULT_FEES)).toEqual({ method: "card", unset: false, fee: 0, total: 0 });
  });
});
