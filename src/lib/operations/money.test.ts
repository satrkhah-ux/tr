import { describe, expect, it } from "vitest";
import {
  caseProfit,
  cashflowBuckets,
  clientDue,
  expectedCost,
  groupProfit,
  moneyLines,
  openInvoices,
  supplierDueDate,
  type CaseBooking,
  type CaseFacts,
  type CashItem,
} from "./money";

const sar = (amount: number) => ({ amount, currency: "SAR" });
const booking = (b: Partial<CaseBooking>): CaseBooking => ({
  status: "confirmed",
  is_paid: false,
  start_date: null,
  deadline: null,
  cost: null,
  ...b,
});
const facts = (f: Partial<CaseFacts>): CaseFacts => ({
  sale: null,
  expectedCost: [],
  partner: false,
  invoice: null,
  clientPayments: [],
  supplierPayments: [],
  bookings: [],
  ...f,
});

describe("moneyLines", () => {
  it("is per currency, never summed across, with a margin only where there is revenue", () => {
    expect(moneyLines([sar(1000), { amount: 50, currency: "SAR", kind: "refund" }], [sar(600), { amount: 100, currency: "USD" }])).toEqual([
      { currency: "SAR", revenue: 950, cost: 600, profit: 350, margin: 36.8 },
      { currency: "USD", revenue: 0, cost: 100, profit: -100, margin: null },
    ]);
  });
});

describe("expectedCost", () => {
  it("prefers the pricings buy_total", () => {
    expect(expectedCost(sar(700), [{ quantity: 1, buy_price: 999, buy_currency: "USD", total_buy: null }], "SAR")).toEqual([sar(700)]);
  });
  it("else sums the pricing lines per buy currency", () => {
    expect(
      expectedCost(
        null,
        [
          { quantity: 2, buy_price: 100, buy_currency: "SAR", total_buy: null },
          { quantity: 1, buy_price: null, buy_currency: "SAR", total_buy: 300 },
          { quantity: 1, buy_price: 50, buy_currency: "USD", total_buy: null },
          { quantity: 1, buy_price: null, buy_currency: "SAR", total_buy: null },
          { quantity: 0, buy_price: 40, buy_currency: "", total_buy: null },
        ],
        "SAR",
      ),
    ).toEqual([sar(540), { amount: 50, currency: "USD" }]);
  });
});

describe("caseProfit", () => {
  it("our file: expected sale vs buy; actual payments in vs suppliers paid + still owed", () => {
    const p = caseProfit(
      facts({
        sale: sar(21270),
        expectedCost: [sar(16000)],
        clientPayments: [sar(10635), { amount: 135, currency: "SAR", kind: "refund" }],
        supplierPayments: [sar(5000), { amount: 200, currency: "SAR", kind: "refund" }],
        bookings: [
          booking({ is_paid: true, cost: sar(4800) }), // paid: counted by its payment, not its cost
          booking({ cost: sar(9000) }), // confirmed, unpaid: still owed
          booking({ status: "pending", cost: sar(3000) }), // not confirmed: no debt yet
          booking({ cost: null }), // no cost known
        ],
      }),
    );
    expect(p.expected).toEqual([{ currency: "SAR", revenue: 21270, cost: 16000, profit: 5270, margin: 24.8 }]);
    expect(p.received).toEqual([sar(10500)]);
    expect(p.supplierPaid).toEqual([sar(4800)]);
    expect(p.supplierOwed).toEqual([sar(9000)]);
    expect(p.actual).toEqual([{ currency: "SAR", revenue: 10500, cost: 13800, profit: -3300, margin: -31.4 }]);
  });

  it("a partner's file earns its invoice — not what its client paid the partner", () => {
    const p = caseProfit(
      facts({ partner: true, sale: sar(9000), invoice: sar(9000), clientPayments: [sar(12000)], bookings: [booking({ cost: sar(7000) })] }),
    );
    expect(p.received).toEqual([sar(9000)]);
    expect(p.actual).toEqual([{ currency: "SAR", revenue: 9000, cost: 7000, profit: 2000, margin: 22.2 }]);
  });

  it("keeps a cost in another currency on its own line", () => {
    const p = caseProfit(facts({ clientPayments: [sar(1000)], bookings: [booking({ cost: { amount: 200, currency: "USD" } })] }));
    expect(p.actual.map((l) => [l.currency, l.profit])).toEqual([
      ["SAR", 1000],
      ["USD", -200],
    ]);
  });
});

describe("groupProfit", () => {
  it("adds cases per key and currency, and recomputes the margin from the sums", () => {
    const c = (key: string, sale: number, buy: number, got: number) => ({
      key,
      profit: caseProfit(facts({ sale: sar(sale), expectedCost: [sar(buy)], clientPayments: [sar(got)] })),
    });
    const rows = groupProfit([c("a", 1000, 800, 1000), c("a", 3000, 2000, 0), c("b", 500, 500, 500)], (x) => x.key);
    expect(rows).toEqual([
      {
        key: "a",
        cases: 2,
        currency: "SAR",
        expected: { currency: "SAR", revenue: 4000, cost: 2800, profit: 1200, margin: 30 },
        actual: { currency: "SAR", revenue: 1000, cost: 0, profit: 1000, margin: 100 },
      },
      {
        key: "b",
        cases: 1,
        currency: "SAR",
        expected: { currency: "SAR", revenue: 500, cost: 500, profit: 0, margin: 0 },
        actual: { currency: "SAR", revenue: 500, cost: 0, profit: 500, margin: 100 },
      },
    ]);
  });
});

describe("clientDue", () => {
  it("what is left of each installment after payments settle the earliest first", () => {
    expect(
      clientDue(
        [
          { due_date: "2026-11-01", amount: 5000 },
          { due_date: "2026-10-01", amount: 5000 },
          { due_date: null, amount: 1000 },
        ],
        6000,
        "2026-10-13",
      ),
    ).toEqual([
      { date: "2026-11-01", amount: 4000 },
      { date: null, amount: 1000 },
    ]);
  });
});

describe("openInvoices", () => {
  it("a partner's payments settle its oldest invoices first, per currency and per partner", () => {
    const inv = (partner_id: string, issued_at: string, amount: number, currency = "SAR") => ({ partner_id, issued_at, amount, currency });
    const out = openInvoices(
      [inv("p1", "2026-10-05", 3000), inv("p1", "2026-10-01", 2000), inv("p1", "2026-10-02", 100, "USD"), inv("p2", "2026-10-01", 1000)],
      [
        { partner_id: "p1", amount: 2500, currency: "SAR" },
        { partner_id: "p2", amount: 1500, currency: "SAR" },
      ],
    );
    expect(out.map((i) => [i.partner_id, i.issued_at, i.currency, i.open])).toEqual([
      ["p1", "2026-10-01", "SAR", 0],
      ["p2", "2026-10-01", "SAR", 0],
      ["p1", "2026-10-02", "USD", 100],
      ["p1", "2026-10-05", "SAR", 2500],
    ]);
  });
});

describe("supplierDueDate", () => {
  it("the cancellation deadline or the start, whichever is first", () => {
    expect(supplierDueDate({ deadline: "2026-11-10", start_date: "2026-11-20" })).toBe("2026-11-10");
    expect(supplierDueDate({ deadline: null, start_date: "2026-11-20" })).toBe("2026-11-20");
    expect(supplierDueDate({ deadline: null, start_date: null })).toBeNull();
  });
});

describe("cashflowBuckets", () => {
  const item = (direction: "in" | "out", date: string | null, amount: number, currency = "SAR"): CashItem => ({
    direction,
    date,
    amount,
    currency,
    kind: direction === "in" ? "installment" : "supplier",
    operation_id: null,
    serial: "S",
    title: "",
  });

  it("overdue, eight rolling weeks from today, then later or undated; net per currency", () => {
    const buckets = cashflowBuckets(
      [
        item("in", "2026-10-12", 1000), // yesterday: overdue
        item("in", "2026-10-13", 500), // today: week 1
        item("out", "2026-10-19", 300), // day 6: still week 1
        item("out", "2026-10-20", 200, "USD"), // day 7: week 2
        item("in", "2026-12-07", 50), // day 55: week 8
        item("out", "2026-12-08", 70), // day 56: later
        item("in", null, 10), // undated: later
        item("out", "2026-10-14", 0), // nothing due
      ],
      "2026-10-13",
    );
    expect(buckets).toHaveLength(10);
    expect(buckets.map((b) => b.key)).toEqual(["overdue", ...Array(8).fill("week"), "later"]);
    expect(buckets[1]).toMatchObject({ from: "2026-10-13", to: "2026-10-19", lines: [{ currency: "SAR", in: 500, out: 300, net: 200 }] });
    expect(buckets[0].lines).toEqual([{ currency: "SAR", in: 1000, out: 0, net: 1000 }]);
    expect(buckets[2].lines).toEqual([{ currency: "USD", in: 0, out: 200, net: -200 }]);
    expect(buckets[8].lines).toEqual([{ currency: "SAR", in: 50, out: 0, net: 50 }]);
    expect(buckets[9].lines).toEqual([{ currency: "SAR", in: 10, out: 70, net: -60 }]);
    expect(buckets.flatMap((b) => b.items)).toHaveLength(7);
  });
});
