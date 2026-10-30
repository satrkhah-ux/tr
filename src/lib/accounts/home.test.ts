import { describe, expect, it } from "vitest";
import { accountsHome, recentMonths, type HomeCase } from "./home";

const facts = (sale: number, buy: number, currency = "SAR") => ({
  sale: { amount: sale, currency },
  expectedCost: [{ amount: buy, currency }],
  partner: false,
  invoice: null,
  clientPayments: [],
  supplierPayments: [],
  bookings: [],
});
const base = { travel_start: null, cancelled: false, currency: "SAR", installments: [], paid: 0 };
const cases: HomeCase[] = [
  // confirmed on the 3rd: 10,000 sold, 8,500 buy; half paid; its agreed second half was due on the 20th
  { ...base, id: "a", serial: "A-1", month: "2026-10", confirmed_on: "2026-10-03", total: 10000, facts: facts(10000, 8500), paid: 5000,
    installments: [{ due_date: "2026-10-03", amount: 5000 }, { due_date: "2026-10-20", amount: 5000 }] },
  // the 30th: week 5; nothing owed late yet (the house terms: half today)
  { ...base, id: "b", serial: "B-2", month: "2026-10", confirmed_on: "2026-10-30", total: 4000, facts: facts(4000, 3000) },
  // another month, another currency and a cancelled case stay out of the month's figures
  { ...base, id: "c", serial: "C-3", month: "2026-09", confirmed_on: "2026-09-10", total: 2000, facts: facts(2000, 1000), paid: 2000 },
  { ...base, id: "d", serial: "D-4", month: "2026-10", confirmed_on: "2026-10-05", currency: "USD", total: 900, facts: facts(900, 700, "USD") },
  { ...base, id: "e", serial: "E-5", month: "2026-10", confirmed_on: "2026-10-06", cancelled: true, total: 7000, facts: facts(7000, 1) },
];

describe("«الحسابات» home", () => {
  const home = accountsHome({
    month: "2026-10",
    today: "2026-10-30",
    cases,
    payments: [
      { operation_id: "a", amount: 5000, currency: "SAR", kind: "deposit", paid_on: "2026-10-03" },
      { operation_id: "c", amount: 2000, currency: "SAR", kind: "final", paid_on: "2026-09-12" },
      { operation_id: "a", amount: 300, currency: "SAR", kind: "refund", paid_on: "2026-10-25" },
    ],
    suppliers: [
      { operation_id: "a", supplier: "القافلة", cost: 6000, currency: "SAR", status: "confirmed" },
      { operation_id: "a", supplier: "TBO", cost: 2500, currency: "SAR", status: "confirmed" },
      { operation_id: "b", supplier: "القافلة", cost: 3000, currency: "SAR", status: "confirmed" },
      { operation_id: "b", supplier: "TBO", cost: 900, currency: "SAR", status: "cancelled" },
      { operation_id: "c", supplier: "TBO", cost: 1000, currency: "SAR", status: "confirmed" },
    ],
  });

  it("adds the month's riyal sales and their expected profit, apart from other currencies and cancelled cases", () => {
    expect([home.sales, home.count, home.profit, home.margin, home.other]).toEqual([14000, 2, 2500, 17.9, 1]);
  });
  it("draws the sales by week of the month", () => {
    expect(home.weeks.map((w) => w.amount)).toEqual([10000, 0, 0, 0, 4000]);
  });
  it("counts the money in during the month, refunds out", () => {
    expect(home.collected).toBe(4700);
  });
  it("owes and lates by today's schedule — the agreed one, else the house terms", () => {
    expect(home.receivable).toBe(5000 + 4000);
    expect(home.overdue.invoices).toEqual([{ id: "a", serial: "A-1", amount: 5000, since: "2026-10-20", days: 10 }]);
  });
  it("ranks the month's suppliers by what their live bookings cost", () => {
    expect(home.suppliers).toEqual([{ name: "القافلة", amount: 9000, bookings: 2 }, { name: "TBO", amount: 2500, bookings: 1 }]);
  });
  it("offers the last months, newest first, across the year end", () => {
    expect(recentMonths("2026-02", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
});
