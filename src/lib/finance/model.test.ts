import { describe, expect, it } from "vitest";
import { breakEven, monthPlan, parseBook, payrollByTeam, quarter, rentDue, salariesIn, summary, treasury, type FinanceBook } from "./model";

const book: FinanceBook = {
  updatedAt: "",
  reservePct: 20,
  treasuryOut: [],
  expenses: [{ id: "x1", date: "2027-03-15", title: "إعلانات", amount: 3000, note: "" }],
  partners: [{ id: "n", name: "شريك أ", share: 50 }, { id: "a", name: "شريك ب", share: 30 }, { id: "k", name: "شريك ج", share: 20 }],
  bookings: [
    { id: "b1", date: "2027-01-10", title: "بكج", seller: "", sale: 30000, cost: 20000, note: "" },
    { id: "b2", date: "2027-02-03", title: "طيران", seller: "", sale: 5000, cost: 6000, note: "خسارة" },
    { id: "b3", date: "2026-12-30", title: "خارج الربع", seller: "", sale: 9000, cost: 1000, note: "" },
  ],
  rents: [{ id: "r", name: "مكتب", yearly: 40000, every: 3, startMonth: 10, note: "" }],
  staff: [
    { id: "a", name: "أ", job: "", team: "المبيعات", place: "", salary: 3000, note: "", stopFrom: "", startFrom: "" },
    { id: "b", name: "ب", job: "", team: "المبيعات", place: "", salary: 2000, note: "", stopFrom: "2027-02", startFrom: "" },
    { id: "c", name: "ج", job: "", team: "المالية", place: "", salary: 1000, note: "", stopFrom: "", startFrom: "" },
  ],
  debts: [
    { id: "d", creditor: "سيارات", kind: "installment", amount: 5000, monthly: 2000, payments: [{ id: "p", date: "2026-10-01", amount: 1000, note: "" }], note: "" },
    { id: "e", creditor: "مورد", kind: "supplier", amount: 7000, monthly: 0, payments: [], note: "" },
  ],
};

describe("finance book", () => {
  it("adds salaries by team", () => {
    expect(payrollByTeam(book.staff).map((t) => [t.team, t.total])).toEqual([["المبيعات", 5000], ["المالية", 1000]]);
  });
  it("asks for a quarter's rent on its months only", () => {
    expect([10, 11, 12, 1, 4, 7].map((m) => rentDue(book.rents[0], m))).toEqual([10000, 0, 0, 10000, 10000, 10000]);
  });
  it("plans instalments until the debt is paid, across the year end", () => {
    const plan = monthPlan(book, 2026, 11, 4);
    expect(plan.map((p) => [p.year, p.month, p.installments])).toEqual([[2026, 11, 2000], [2026, 12, 2000], [2027, 1, 0], [2027, 2, 0]]);
    expect(plan[2].total).toBe(6000 + 10000);
    expect(plan[3].salaries).toBe(4000); // «ب» stops from February
  });
  it("sums what is left", () => {
    const s = summary(book);
    expect([s.salaries, s.debtLeft, s.debtPaid, s.installments]).toEqual([6000, 11000, 1000, 2000]);
  });
  it("pays a changed salary as two rows: the old one until it stops, the new one from its start", () => {
    const changed = { ...book, staff: [
      { id: "o", name: "د", job: "", team: "الشركاء", place: "", salary: 3000, note: "", startFrom: "2026-02", stopFrom: "2026-10" },
      { id: "n", name: "د", job: "", team: "الشركاء", place: "", salary: 7500, note: "", startFrom: "2026-10", stopFrom: "" },
    ] };
    expect([1, 2, 9, 10, 11].map((m) => salariesIn(changed.staff, 2026, m))).toEqual([0, 3000, 3000, 7500, 7500]);
    // today counts only what is paid now, so the old row is neither in the total nor «stopping»
    expect(summary(changed, "2026-10")).toMatchObject({ salaries: 7500, stopping: 0, salariesAfter: 7500 });
    expect(payrollByTeam(changed.staff, "2026-10")[0].total).toBe(7500);
  });
  it("sends 20% of each booking's profit to the treasury, never of a loss", () => {
    expect(treasury(book)).toBe(2000 + 0 + 1600);
    // what is taken out of the treasury comes off its balance
    expect(treasury({ ...book, treasuryOut: [{ id: "o", date: "2026-10-24", title: "دين سابق", amount: 3600, note: "" }] })).toBe(0);
  });
  it("splits a quarter's profit after the treasury and all expenses, by share", () => {
    const q = quarter({ ...book, debts: [] }, 2027, 1);
    // Q1 2027: profit 10000 − 1000 = 9000, treasury 2000; fixed: Jan 6000+10000 rent, Feb 4000, Mar 4000
    expect([q.bookings, q.profit, q.reserve, q.fixed, q.other]).toEqual([2, 9000, 2000, 24000, 3000]);
    expect(q.distributable).toBe(9000 - 2000 - 24000 - 3000);
    expect(q.shares.every((s) => s.amount === 0)).toBe(true);
    const rich = quarter({ ...book, debts: [], bookings: [{ ...book.bookings[0], sale: 70000 }] }, 2027, 1);
    expect(rich.shares.map((s) => s.amount)).toEqual([0.5, 0.3, 0.2].map((f) => f * (50000 - 10000 - 24000 - 3000)));
  });
  it("finds the monthly profit that covers the fixed costs after the treasury share", () => {
    expect(breakEven({ ...book, debts: [] }, 2027, 3)).toBe(4000 / 0.8);
  });
  it("reads a book saved before the profits tab", () => {
    const { bookings, partners, reservePct, expenses, ...old } = book;
    void bookings; void partners; void reservePct; void expenses;
    expect(parseBook({ ...old, staff: old.staff.map(({ stopFrom, ...s }) => (void stopFrom, s)) })).toMatchObject({ bookings: [], partners: [], expenses: [], treasuryOut: [], reservePct: 20 });
  });
  it("refuses a malformed book", () => {
    expect(parseBook(book)).not.toBeNull();
    expect(parseBook({ ...book, staff: [{ ...book.staff[0], salary: -1 }] })).toBeNull();
    expect(parseBook({ ...book, rents: [{ ...book.rents[0], every: 4 }] })).toBeNull();
    expect(parseBook({ ...book, debts: [{ ...book.debts[0], kind: "x" }] })).toBeNull();
  });
});
