import { describe, expect, it } from "vitest";
import { caseAccounts, fileAccounts } from "./accounts";
import { ADDITION_PRICE, georgiaData, SELL, SUPPLIER_COST } from "./fixture";
import type { CaseFacts } from "@/lib/operations/money";

/** A confirmed repackaged file as loadCases reads it: sold, costed at issue, the supplier's package line on the case. */
const facts = (over: Partial<CaseFacts> = {}): CaseFacts => ({
  sale: { amount: SELL + ADDITION_PRICE, currency: "SAR" },
  expectedCost: [{ amount: SUPPLIER_COST, currency: "SAR" }],
  partner: false,
  invoice: null,
  clientPayments: [],
  supplierPayments: [],
  bookings: [{ status: "pending", is_paid: false, start_date: null, deadline: null, cost: { amount: SUPPLIER_COST, currency: "SAR" } }],
  ...over,
});
const account = (f: CaseFacts, paid = 0) => caseAccounts({ facts: f, total: f.sale?.amount ?? null, currency: "SAR", paid });

describe("a repackaged file's accounts — sell, cost, profit, received, remaining", () => {
  it("expected profit is the sell less the supplier's cost, with its margin", () => {
    const a = account(facts());
    expect(a.sale).toEqual({ amount: 8820, currency: "SAR" });
    expect(a.expected).toEqual([{ currency: "SAR", revenue: 8820, cost: SUPPLIER_COST, profit: 1428.5, margin: 16.2 }]);
  });

  it("what the client paid and what he still owes", () => {
    const a = account(facts({ clientPayments: [{ amount: 4000, currency: "SAR", kind: "deposit" }, { amount: 500, currency: "SAR", kind: "refund" }] }), 3500);
    expect(a.received).toEqual([{ currency: "SAR", amount: 3500 }]);
    expect(a.paid).toBe(3500);
    expect(a.remaining).toBe(5320);
  });

  it("the supplier's debt appears only once the supplier confirmed the line, and falls as we pay it", () => {
    // pending: not a debt yet
    expect(account(facts()).supplierOwed).toEqual([]);
    const confirmed = facts({ bookings: [{ status: "confirmed", is_paid: false, start_date: null, deadline: null, cost: { amount: SUPPLIER_COST, currency: "SAR" } }] });
    expect(account(confirmed).supplierOwed).toEqual([{ currency: "SAR", amount: SUPPLIER_COST }]);
    // paid in part: what we paid, and the line still stands until it is marked paid
    const partly = { ...confirmed, supplierPayments: [{ amount: 2000, currency: "SAR", kind: "payment" }] };
    expect(account(partly).supplierPaid).toEqual([{ currency: "SAR", amount: 2000 }]);
    // marked paid: nothing left owed
    const settled = { ...partly, bookings: [{ ...confirmed.bookings[0], is_paid: true }] };
    expect(account(settled).supplierOwed).toEqual([]);
  });

  it("the actual profit is the money in against what we paid and still owe the supplier", () => {
    const a = account(
      facts({
        clientPayments: [{ amount: 8820, currency: "SAR", kind: "final" }],
        supplierPayments: [{ amount: SUPPLIER_COST, currency: "SAR", kind: "payment" }],
        bookings: [{ status: "confirmed", is_paid: true, start_date: null, deadline: null, cost: { amount: SUPPLIER_COST, currency: "SAR" } }],
      }),
      8820,
    );
    expect(a.remaining).toBe(0);
    expect(a.actual).toEqual([{ currency: "SAR", revenue: 8820, cost: SUPPLIER_COST, profit: 1428.5, margin: 16.2 }]);
  });

  it("a supplier paid in another currency is its own line — never summed into the sale's", () => {
    const usd = account(facts({ supplierPayments: [{ amount: 500, currency: "USD", kind: "payment" }], clientPayments: [{ amount: 1000, currency: "SAR", kind: "deposit" }] }), 1000);
    expect(usd.actual.map((l) => l.currency).sort()).toEqual(["SAR", "USD"]);
  });

  it("before the case exists the accounts are the file's own prices: our total less the supplier's cost", () => {
    const a = fileAccounts(georgiaData(), SUPPLIER_COST);
    expect(a.sale).toEqual({ amount: 8820, currency: "SAR" });
    expect(a.expected[0]).toMatchObject({ revenue: 8820, cost: SUPPLIER_COST, profit: 1428.5 });
    expect(a.paid).toBe(0);
    expect(a.remaining).toBe(8820);
    expect(a.actual).toEqual([]);
    // no package price yet: nothing to show against
    expect(fileAccounts(georgiaData({ final_total: null }), SUPPLIER_COST).sale).toBeNull();
  });
});
