import { describe, expect, it } from "vitest";
import { commissionMonth, type CommissionCase } from "./month";

const base = (over: Partial<CommissionCase>): CommissionCase => ({
  id: "op1",
  serial: "AD-1",
  destination: "تركيا",
  employee_id: "e1",
  client_status: "paid_full",
  cancelled: false,
  last_paid_on: "2026-10-05",
  facts: {
    sale: { amount: 10000, currency: "SAR" },
    expectedCost: [],
    partner: false,
    invoice: null,
    clientPayments: [{ amount: 10000, currency: "SAR", kind: "deposit" }],
    supplierPayments: [{ amount: 6000, currency: "SAR" }],
    bookings: [],
  },
  ...over,
});

describe("commissionMonth", () => {
  it("counts a file in the month it was paid in full, on its actual profit", () => {
    const { employees } = commissionMonth([base({})], "2026-10", {});
    expect(employees).toEqual([
      { employee_id: "e1", sales: 10000, profit: 4000, files: [expect.objectContaining({ serial: "AD-1", revenue: 10000, cost: 6000, profit: 4000 })] },
    ]);
  });

  it("flags a file with no supplier cost recorded", () => {
    const { employees } = commissionMonth([base({ facts: { ...base({}).facts, supplierPayments: [] } })], "2026-10", {});
    expect(employees[0].files[0]).toMatchObject({ profit: 10000, no_cost: true });
  });

  it("leaves out unpaid, cancelled, other-month and unowned files", () => {
    const { employees } = commissionMonth(
      [
        base({ client_status: "paid_partial" }),
        base({ cancelled: true }),
        base({ last_paid_on: "2026-09-30" }),
        base({ employee_id: null }),
      ],
      "2026-10",
      {},
    );
    expect(employees).toEqual([]);
  });

  it("converts to riyals, subtracts refunds and still-owed bookings, and skips an unknown currency", () => {
    const usd = base({
      id: "op2",
      serial: "AD-2",
      facts: {
        ...base({}).facts,
        clientPayments: [
          { amount: 1000, currency: "USD", kind: "deposit" },
          { amount: 100, currency: "USD", kind: "refund" },
        ],
        supplierPayments: [],
        bookings: [{ status: "confirmed", is_paid: false, start_date: null, deadline: null, cost: { amount: 500, currency: "USD" } }],
      },
    });
    const xyz = base({ id: "op3", serial: "AD-3", facts: { ...base({}).facts, clientPayments: [{ amount: 1, currency: "XYZ" }], supplierPayments: [] } });
    const { employees, skipped } = commissionMonth([usd, xyz], "2026-10", { USD: 3.75 });
    expect(employees[0].profit).toBe(1500); // (900 − 500) × 3.75
    expect(skipped).toEqual([{ operation_id: "op3", serial: "AD-3", employee_id: "e1", currency: "XYZ" }]);
  });
});
