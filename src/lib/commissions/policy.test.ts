import { describe, expect, it } from "vitest";

import { buildCommissionCalculationSnapshot, commissionEngineResultForPersistence, createDefaultCommissionPolicy, parseCommissionPolicy } from "./policy";

const employee1 = "00000000-0000-4000-8000-000000000001";
const employee2 = "00000000-0000-4000-8000-000000000002";
const periodId = "00000000-0000-4000-8000-000000000010";

const policy = {
  targetModelEffectiveFrom: "2026-01-01",
  minEligibleProfit: 0,
  legacy: {
    tiers: [
      { from: 0, to: 1000, rate: 0.1, label: "الأولى" },
      { from: 1000, to: 2000, rate: 0.07, label: "الثانية" },
      { from: 2000, to: null, rate: 0.05, label: "الباقي" },
    ],
    refundHandling: "deduct_refund_profit",
  },
  target: {
    weightBlend: 0.5,
    levels: [
      { id: "lvl1", label: "الأول", costMultiplier: 1, rate: 0.1 },
      { id: "lvl2", label: "الثاني", costMultiplier: 1.25, rate: 0.13 },
      { id: "lvl3", label: "الثالث", costMultiplier: 1.5, rate: 0.16 },
    ],
  },
  individualFallback: { enabled: true, rate: 0.1 },
  vat: { enabled: true, rate: 0.15 },
  departments: [{ id: "marketing", name: "التسويق", levelRates: { lvl1: 0.02, lvl2: 0.025, lvl3: 0.03 } }],
  excludedEmployeeIds: [],
  employeeTargets: {},
};

describe("commission policy snapshot", () => {
  it("creates the complete original default policy", () => {
    expect(createDefaultCommissionPolicy()).toMatchObject({
      targetModelEffectiveFrom: "2026-01-01",
      legacy: { refundHandling: "deduct_refund_profit" },
      target: { weightBlend: 0.5 },
      individualFallback: { enabled: true, rate: 0.1 },
    });
  });
  it("validates the complete original policy document", () => {
    expect(parseCommissionPolicy(policy)).toMatchObject({ targetModelEffectiveFrom: "2026-01-01", target: { weightBlend: 0.5 } });
  });

  it("rejects tier gaps and unknown department levels", () => {
    const invalid = structuredClone(policy);
    invalid.legacy.tiers[1].from = 900;
    expect(() => parseCommissionPolicy(invalid)).toThrow(/متصلة/);
    const unknown = structuredClone(policy);
    (unknown.departments[0].levelRates as Record<string, number>).unknown = 0.01;
    expect(() => parseCommissionPolicy(unknown)).toThrow(/مستوى غير موجود/);
  });

  it("rejects calendar dates that normalize into another month", () => {
    const invalid = structuredClone(policy);
    invalid.targetModelEffectiveFrom = "2026-02-30";
    expect(() => parseCommissionPolicy(invalid)).toThrow(/تاريخ/);
  });

  it("builds a reconciled target snapshot in integer halalas", () => {
    const snapshot = buildCommissionCalculationSnapshot({
      period: { id: periodId, startsOn: "2026-01-01", monthlyCost: 250_000 },
      policy,
      rows: [
        { salesRowId: "00000000-0000-4000-8000-000000000101", employeeId: employee1, sales: 25_000, profit: 100_000, saleCount: 5, refundCount: 0 },
        { salesRowId: "00000000-0000-4000-8000-000000000102", employeeId: employee2, sales: 75_000, profit: 200_000, saleCount: 5, refundCount: 0 },
      ],
      adjustmentsByEmployee: { [employee1]: [{ amount: 10 }] },
    });
    expect(snapshot.model).toBe("target");
    expect(snapshot.result.employees.map((item) => item.baseCommissionHalalas)).toEqual([187_500, 312_500]);
    expect(Object.values(snapshot.result.reconciliation).every(Boolean)).toBe(true);
    const persisted = commissionEngineResultForPersistence(snapshot);
    expect(persisted).toMatchObject({
      employeeBaseCommissionTotal: 5_000,
      employeeAdjustmentTotal: 10,
      departmentIncentiveTotal: 1_000,
      totalNetIncentives: 6_010,
    });
    expect(persisted.departments[0].departmentName).toBe("التسويق");
  });

  it("selects legacy automatically before the effective date", () => {
    const snapshot = buildCommissionCalculationSnapshot({
      period: { id: periodId, startsOn: "2025-12-01", monthlyCost: 0 },
      policy,
      rows: [{ salesRowId: "00000000-0000-4000-8000-000000000101", employeeId: employee1, sales: 20_000, profit: 3_000, saleCount: 10, refundCount: 2 }],
    });
    expect(snapshot.model).toBe("legacy");
    expect(snapshot.result.employees[0]).toMatchObject({ eligibleProfitHalalas: 250_000, baseCommissionHalalas: 19_500 });
  });

  it("reconciles a legacy cycle when VAT is disabled but the policy retains its configured rate", () => {
    const disabledVatPolicy = structuredClone(policy);
    disabledVatPolicy.vat.enabled = false;
    const snapshot = buildCommissionCalculationSnapshot({
      period: { id: periodId, startsOn: "2025-12-01", monthlyCost: 0 },
      policy: disabledVatPolicy,
      rows: [{ salesRowId: "00000000-0000-4000-8000-000000000102", employeeId: employee1, sales: 20_000, profit: 3_000, saleCount: 10, refundCount: 0 }],
    });
    expect(snapshot.result.employees[0].vatAmountHalalas).toBe(0);
    expect(snapshot.result.reconciliation.vatItemsEqualAggregateVat).toBe(true);
  });
});
