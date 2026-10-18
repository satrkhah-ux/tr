import { describe, expect, it } from "vitest";

import {
  applyCommissionSettlement,
  calculateLegacyCommission,
  calculateTargetCommissions,
  computeTierBreakdown,
  fromHalalas,
  settleEmployeeVat,
  toHalalas,
  type LegacyTier,
  type SaleRow,
  type TargetPolicy,
} from "./engine";

const LEGACY_TIERS: LegacyTier[] = [
  { from: 0, to: 1_000, rate: 0.1, label: "first" },
  { from: 1_000, to: 2_000, rate: 0.07, label: "second" },
  { from: 2_000, to: null, rate: 0.05, label: "rest" },
];

const TARGET_POLICY: TargetPolicy = {
  levels: [
    { id: "lvl1", label: "level 1", costMultiplier: 1, rate: 0.1 },
    { id: "lvl2", label: "level 2", costMultiplier: 1.25, rate: 0.13 },
    { id: "lvl3", label: "level 3", costMultiplier: 1.5, rate: 0.16 },
  ],
  weightBlend: 0.5,
  individualFallback: { enabled: true, rate: 0.1 },
  departmentRates: {},
};

function row(
  employeeId: string,
  sales: number,
  profit: number,
  saleCount: number | null = null,
  refundCount: number | null = null,
): SaleRow {
  return { employeeId, sales, profit, saleCount, refundCount };
}

describe("integer-halalas money boundary", () => {
  it("rounds decimal inputs exactly and symmetrically", () => {
    expect(toHalalas(1.005)).toBe(101);
    expect(toHalalas("-1.005")).toBe(-101);
    expect(fromHalalas(101)).toBe(1.01);
  });

  it("applies adjustments, a zero floor, and VAT without floating-point drift", () => {
    expect(applyCommissionSettlement(220, [{ amount: 10.005 }], { enabled: true, rate: 0.15 }))
      .toMatchObject({
        baseCommissionHalalas: 22_000,
        adjustmentTotalHalalas: 1_001,
        netCommissionHalalas: 23_001,
        vatAmountHalalas: 3_450,
        grossPayableHalalas: 26_451,
      });

    expect(applyCommissionSettlement(50, [{ amount: -80 }], { enabled: true, rate: 0.15 }))
      .toMatchObject({
        adjustmentTotal: -80,
        netCommission: 0,
        vatAmount: 0,
        grossPayable: 0,
      });
  });
});

describe("legacy aggregate VAT settlement", () => {
  it("distributes one residual halala deterministically across equal employees", () => {
    const base = ["e3", "e1", "e2"].map((employeeId) => ({
      employeeId,
      ...applyCommissionSettlement(0.02, [], { enabled: false, rate: 0 }),
    }));
    const settled = settleEmployeeVat(base, { enabled: true, rate: 0.15 });
    expect(Object.fromEntries(settled.map((item) => [item.employeeId, item.vatAmountHalalas])))
      .toEqual({ e3: 0, e1: 1, e2: 0 });
    expect(settled.reduce((sum, item) => sum + item.vatAmountHalalas, 0)).toBe(1);
  });
});

describe("legacy policy parity", () => {
  it.each([
    [500, 50],
    [1_500, 135],
    [3_000, 220],
    [-50, 0],
  ])("calculates %s SAR eligible profit as %s SAR", (profit, expected) => {
    expect(computeTierBreakdown(profit, LEGACY_TIERS).total).toBe(expected);
  });

  it("deducts the estimated refund share with the original 50% cap", () => {
    const result = calculateLegacyCommission(
      row("e1", 20_000, 3_000, 10, 2),
      LEGACY_TIERS,
      0,
      "deduct_refund_profit",
    );

    expect(result.refundAdjustment).toBe(500);
    expect(result.eligibleProfit).toBe(2_500);
    expect(result.baseCommission).toBe(195);
    expect(result.companyShare).toBe(2_805);
  });

  it("caps the refund deduction at half of positive profit", () => {
    const result = calculateLegacyCommission(
      row("e1", 20_000, 3_000, 2, 5),
      LEGACY_TIERS,
      0,
      "deduct_refund_profit",
    );

    expect(result.refundAdjustment).toBe(1_500);
    expect(result.eligibleProfit).toBe(1_500);
    expect(result.baseCommission).toBe(135);
  });
});

describe("monthly target policy parity", () => {
  it("uses the configured sales/order blend to allocate the achieved pool", () => {
    const result = calculateTargetCommissions(
      [row("e1", 25_000, 100_000, 5), row("e2", 75_000, 200_000, 5)],
      250_000,
      {},
      TARGET_POLICY,
    );

    expect(result.activeLevel?.id).toBe("lvl1");
    expect(result.surplus).toBe(50_000);
    expect(result.salesPool).toBe(5_000);
    expect(result.employees.map((employee) => employee.weight)).toEqual([0.375, 0.625]);
    expect(result.employees.map((employee) => employee.baseCommission)).toEqual([1_875, 3_125]);
    expect(result.employeeBaseCommissionTotal).toBe(5_000);
  });

  it("settles equal fractional shares deterministically to the exact pool", () => {
    const input = [
      row("e3", 10_000, 100_000, 1),
      row("e1", 10_000, 100_000, 1),
      row("e2", 10_000, 100_000, 1),
    ];
    const result = calculateTargetCommissions(input, 250_000, {}, TARGET_POLICY);
    const byEmployee = Object.fromEntries(
      result.employees.map((employee) => [employee.employeeId, employee.baseCommission]),
    );

    expect(byEmployee).toEqual({ e3: 1_666.66, e1: 1_666.67, e2: 1_666.67 });
    expect(result.allocatedSalesPoolHalalas).toBe(500_000);
    expect(result.employeeBaseCommissionTotalHalalas).toBe(500_000);
    expect(result.reconciliation.employeeItemsEqualAllocatedPool).toBe(true);
  });

  it("uses the individual fallback only when the company target is not achieved", () => {
    const result = calculateTargetCommissions(
      [row("e1", 50_000, 20_000, 2), row("e2", 20_000, 5_000, 1)],
      100_000,
      { e1: 10_000, e2: 10_000 },
      TARGET_POLICY,
    );

    expect(result.activeLevel).toBeNull();
    expect(result.salesPool).toBe(0);
    expect(result.employees[0]).toMatchObject({ viaFallback: true, baseCommission: 2_000 });
    expect(result.employees[1]).toMatchObject({ viaFallback: false, baseCommission: 0 });
    expect(result.employeeBaseCommissionTotal).toBe(2_000);
  });

  it("reconciles employees, departments, adjustments, company share, and VAT", () => {
    const result = calculateTargetCommissions(
      [row("e1", 50_000, 150_000, 5), row("e2", 50_000, 150_000, 5)],
      250_000,
      {},
      {
        ...TARGET_POLICY,
        departmentRates: {
          marketing: { lvl1: 0.02 },
          operations: { lvl1: 0.02 },
        },
      },
      {
        adjustmentsByEmployee: {
          e1: [{ amount: 100 }],
          e2: [{ amount: -3_000 }],
        },
        vat: { enabled: true, rate: 0.15 },
      },
    );

    expect(result.employees.map((employee) => employee.netCommission)).toEqual([2_600, 0]);
    expect(result.departmentIncentives).toEqual({ marketing: 1_000, operations: 1_000 });
    expect(result.employeeNetCommissionTotal).toBe(2_600);
    expect(result.departmentIncentiveTotal).toBe(2_000);
    expect(result.totalNetIncentives).toBe(4_600);
    expect(result.totalVat).toBe(690);
    expect(result.totalGrossPayable).toBe(5_290);
    expect(result.companyRetainedProfit).toBe(295_400);
    expect(result.reconciliation).toEqual({
      employeeItemsEqualAllocatedPool: true,
      netSplitEqualsCompanyGrossProfit: true,
      vatItemsEqualAggregateVat: true,
      grossPayableEqualsNetPlusVat: true,
    });
  });

  it("distributes aggregate VAT residual halalas deterministically", () => {
    const result = calculateTargetCommissions(
      [row("e3", 1, 0.3, 1), row("e1", 1, 0.3, 1), row("e2", 1, 0.3, 1)],
      100,
      {},
      TARGET_POLICY,
      { vat: { enabled: true, rate: 0.15 } },
    );
    const vatByEmployee = Object.fromEntries(
      result.employees.map((employee) => [employee.employeeId, employee.vatAmountHalalas]),
    );

    expect(result.employees.map((employee) => employee.baseCommissionHalalas)).toEqual([3, 3, 3]);
    expect(vatByEmployee).toEqual({ e3: 0, e1: 1, e2: 0 });
    expect(result.totalVatHalalas).toBe(1);
    expect(result.reconciliation.vatItemsEqualAggregateVat).toBe(true);
  });

  it("tracks an undistributable pool as company-retained instead of inventing employee shares", () => {
    const result = calculateTargetCommissions(
      [row("e1", 0, 150_000, 0), row("e2", 0, 150_000, 0)],
      250_000,
      {},
      TARGET_POLICY,
    );

    expect(result.salesPool).toBe(5_000);
    expect(result.allocatedSalesPool).toBe(0);
    expect(result.unallocatedSalesPool).toBe(5_000);
    expect(result.companyRetainedProfit).toBe(300_000);
  });
});
