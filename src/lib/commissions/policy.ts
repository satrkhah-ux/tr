import {
  calculateLegacyCommission,
  calculateTargetCommissions,
  fromHalalas,
  settleEmployeeVat,
  type CommissionAdjustment,
  type EmployeeCommission,
  type LegacyTier,
  type SaleRow,
  type TargetCommissionResult,
  type TargetLevel,
  type TargetPolicy,
  type VatPolicy,
} from "./engine";

export type CommissionPolicyDocument = {
  targetModelEffectiveFrom: string;
  minEligibleProfit: number;
  legacy: {
    tiers: LegacyTier[];
    refundHandling: "none" | "deduct_refund_profit";
  };
  target: {
    weightBlend: number;
    levels: TargetLevel[];
  };
  individualFallback: { enabled: boolean; rate: number };
  vat: VatPolicy;
  departments: Array<{
    id: string;
    name: string;
    levelRates: Record<string, number>;
  }>;
  excludedEmployeeIds: string[];
  employeeTargets?: Record<string, number>;
};

export type CommissionSourceRow = SaleRow & {
  salesRowId: string;
};

export type CommissionCalculationSnapshot = {
  schemaVersion: 1;
  model: "legacy" | "target";
  period: { id: string; startsOn: string; monthlyCost: number };
  policy: CommissionPolicyDocument;
  sourceRows: CommissionSourceRow[];
  adjustmentsByEmployee: Record<string, CommissionAdjustment[]>;
  result: {
    employees: EmployeeCommission[];
    departments: TargetCommissionResult["departments"];
    totals: Record<string, number | string | boolean | null>;
    reconciliation: TargetCommissionResult["reconciliation"] | {
      employeeItemsEqualAllocatedPool: true;
      netSplitEqualsCompanyGrossProfit: true;
      grossPayableEqualsNetPlusVat: true;
      vatItemsEqualAggregateVat: true;
    };
  };
};

export type CommissionEnginePersistenceResult = {
  employees: EmployeeCommission[];
  departments: Array<TargetCommissionResult["departments"][number] & { departmentName: string }>;
  employeeBaseCommissionTotal: number;
  employeeAdjustmentTotal: number;
  employeeNetCommissionTotal: number;
  departmentIncentiveTotal: number;
  totalNetIncentives: number;
  totalVat: number;
  totalGrossPayable: number;
  reconciliation: CommissionCalculationSnapshot["result"]["reconciliation"];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_LIMIT = Number.MAX_SAFE_INTEGER / 100;

export function createDefaultCommissionPolicy(targetModelEffectiveFrom = "2026-01-01"): CommissionPolicyDocument {
  return parseCommissionPolicy({
    targetModelEffectiveFrom,
    minEligibleProfit: 0,
    legacy: {
      tiers: [
        { from: 0, to: 1_000, rate: 0.10, label: "أول 1,000 ريال" },
        { from: 1_000, to: 2_000, rate: 0.07, label: "ثاني 1,000 ريال" },
        { from: 2_000, to: null, rate: 0.05, label: "كل ما زاد" },
      ],
      refundHandling: "deduct_refund_profit",
    },
    target: {
      weightBlend: 0.5,
      levels: [
        { id: "lvl1", label: "المستوى الأول — تغطية التكلفة", costMultiplier: 1, rate: 0.10 },
        { id: "lvl2", label: "المستوى الثاني — تحقيق الهدف", costMultiplier: 1.25, rate: 0.13 },
        { id: "lvl3", label: "المستوى الثالث — تجاوز الهدف", costMultiplier: 1.5, rate: 0.16 },
      ],
    },
    individualFallback: { enabled: true, rate: 0.10 },
    vat: { enabled: false, rate: 0.15 },
    departments: [
      { id: "dept_mkt", name: "التسويق", levelRates: { lvl1: 0.02, lvl2: 0.025, lvl3: 0.03 } },
      { id: "dept_fin", name: "المالية", levelRates: { lvl1: 0.02, lvl2: 0.025, lvl3: 0.03 } },
      { id: "dept_ops", name: "العمليات", levelRates: { lvl1: 0.02, lvl2: 0.025, lvl3: 0.03 } },
    ],
    excludedEmployeeIds: [],
    employeeTargets: {},
  });
}

export function parseCommissionPolicy(value: unknown): CommissionPolicyDocument {
  if (!isRecord(value)) throw new Error("وثيقة سياسة العمولة غير صحيحة");
  const targetModelEffectiveFrom = requiredDate(value.targetModelEffectiveFrom, "تاريخ بدء نظام الهدف");
  const minEligibleProfit = money(value.minEligibleProfit, "الحد الأدنى للربح المؤهل", true);
  const legacyObject = requiredRecord(value.legacy, "سياسة الشرائح القديمة");
  const legacyTiers = requiredArray(legacyObject.tiers, "شرائح النظام القديم").map(parseTier);
  assertOrderedTiers(legacyTiers);
  const refundHandling = legacyObject.refundHandling;
  if (refundHandling !== "none" && refundHandling !== "deduct_refund_profit") {
    throw new Error("طريقة معالجة المرتجعات غير صحيحة");
  }

  const targetObject = requiredRecord(value.target, "سياسة الهدف");
  const weightBlend = rate(targetObject.weightBlend, "مزيج وزن الطلبات");
  const levels = requiredArray(targetObject.levels, "مستويات الهدف").map(parseLevel);
  assertUnique(levels.map((level) => level.id), "معرّف مستوى الهدف");
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index].costMultiplier <= levels[index - 1].costMultiplier) {
      throw new Error("يجب ترتيب مستويات الهدف تصاعدياً دون تكرار");
    }
  }

  const fallbackObject = requiredRecord(value.individualFallback, "شبكة الأمان الفردية");
  const individualFallback = {
    enabled: boolean(fallbackObject.enabled, "تفعيل شبكة الأمان"),
    rate: rate(fallbackObject.rate, "نسبة شبكة الأمان"),
  };
  const vatObject = requiredRecord(value.vat, "ضريبة القيمة المضافة");
  const vat = { enabled: boolean(vatObject.enabled, "تفعيل الضريبة"), rate: rate(vatObject.rate, "نسبة الضريبة") };

  const departments = requiredArray(value.departments, "الأقسام").map((item) => {
    const department = requiredRecord(item, "القسم");
    const id = requiredText(department.id, "معرّف القسم", 100);
    const name = requiredText(department.name, "اسم القسم", 200);
    const levelRatesObject = requiredRecord(department.levelRates, "نسب القسم");
    const levelRates: Record<string, number> = {};
    for (const level of levels) levelRates[level.id] = rate(levelRatesObject[level.id] ?? 0, `نسبة ${name}`);
    if (Object.keys(levelRatesObject).some((idValue) => !levels.some((level) => level.id === idValue))) {
      throw new Error(`يحتوي القسم ${name} على مستوى غير موجود`);
    }
    return { id, name, levelRates };
  });
  assertUnique(departments.map((department) => department.id), "معرّف القسم");

  const excludedEmployeeIds = requiredArray(value.excludedEmployeeIds, "الموظفون المستبعدون")
    .map((id) => uuid(id, "معرّف موظف مستبعد"));
  assertUnique(excludedEmployeeIds, "الموظف المستبعد");
  const employeeTargets = parseEmployeeTargets(value.employeeTargets ?? {});

  return {
    targetModelEffectiveFrom,
    minEligibleProfit,
    legacy: { tiers: legacyTiers, refundHandling },
    target: { weightBlend, levels },
    individualFallback,
    vat,
    departments,
    excludedEmployeeIds,
    employeeTargets,
  };
}

export function buildCommissionCalculationSnapshot(input: {
  period: { id: string; startsOn: string; monthlyCost: number };
  policy: unknown;
  rows: CommissionSourceRow[];
  adjustmentsByEmployee?: Record<string, CommissionAdjustment[]>;
}): CommissionCalculationSnapshot {
  const policy = parseCommissionPolicy(input.policy);
  const startsOn = requiredDate(input.period.startsOn, "تاريخ بداية الفترة");
  const monthlyCost = money(input.period.monthlyCost, "تكلفة الفترة", true);
  const periodId = uuid(input.period.id, "معرّف الفترة");
  if (input.rows.length === 0) throw new Error("الفترة لا تحتوي على صفوف مبيعات");
  assertUnique(input.rows.map((row) => uuid(row.salesRowId, "معرّف صف المبيعات")), "صف المبيعات");
  assertUnique(input.rows.map((row) => uuid(row.employeeId, "معرّف الموظف")), "موظف الفترة");
  const excluded = new Set(policy.excludedEmployeeIds);
  const sourceRows = input.rows.map((row) => ({
    salesRowId: row.salesRowId,
    employeeId: row.employeeId,
    sales: money(row.sales, "المبيعات"),
    profit: money(row.profit, "الربح"),
    saleCount: count(row.saleCount, "عدد المبيعات"),
    refundCount: count(row.refundCount, "عدد المرتجعات"),
    excluded: Boolean(row.excluded || excluded.has(row.employeeId)),
  }));
  for (const row of sourceRows) {
    if (row.saleCount !== null && row.refundCount !== null && row.refundCount > row.saleCount) {
      throw new Error("عدد المرتجعات لا يمكن أن يتجاوز عدد المبيعات");
    }
  }
  const adjustmentsByEmployee = parseAdjustments(input.adjustmentsByEmployee ?? {}, new Set(sourceRows.map((row) => row.employeeId)));
  const usesTarget = startsOn >= policy.targetModelEffectiveFrom;

  if (!usesTarget) {
    const employees = settleEmployeeVat(sourceRows.map((row) => calculateLegacyCommission(
      row,
      policy.legacy.tiers,
      policy.minEligibleProfit,
      policy.legacy.refundHandling,
      { adjustments: adjustmentsByEmployee[row.employeeId], vat: { enabled: false, rate: 0 } },
    )), policy.vat);
    const employeeNet = sum(employees.map((employee) => employee.netCommissionHalalas));
    const totalVat = sum(employees.map((employee) => employee.vatAmountHalalas));
    const grossProfit = sum(employees.map((employee) => employee.grossProfitHalalas));
    const grossPayable = sum(employees.map((employee) => employee.grossPayableHalalas));
    return {
      schemaVersion: 1,
      model: "legacy",
      period: { id: periodId, startsOn, monthlyCost },
      policy,
      sourceRows,
      adjustmentsByEmployee,
      result: {
        employees,
        departments: [],
        totals: { employeeNetHalalas: employeeNet, totalVatHalalas: totalVat, totalGrossPayableHalalas: grossPayable, companyGrossProfitHalalas: grossProfit, companyRetainedProfitHalalas: grossProfit - employeeNet },
        reconciliation: {
          employeeItemsEqualAllocatedPool: true,
          netSplitEqualsCompanyGrossProfit: grossProfit === (grossProfit - employeeNet) + employeeNet,
          grossPayableEqualsNetPlusVat: grossPayable === employeeNet + totalVat,
          vatItemsEqualAggregateVat: totalVat === Math.round(
            employeeNet * (policy.vat.enabled ? policy.vat.rate : 0),
          ),
        },
      },
    };
  }

  const targetPolicy: TargetPolicy = {
    levels: policy.target.levels,
    weightBlend: policy.target.weightBlend,
    individualFallback: policy.individualFallback,
    departmentRates: Object.fromEntries(policy.departments.map((department) => [department.id, department.levelRates])),
  };
  const calculation = calculateTargetCommissions(
    sourceRows,
    monthlyCost,
    policy.employeeTargets ?? {},
    targetPolicy,
    { adjustmentsByEmployee, vat: policy.vat },
  );
  if (!Object.values(calculation.reconciliation).every(Boolean)) throw new Error("فشلت التسوية الداخلية لمحرك العمولة");
  return {
    schemaVersion: 1,
    model: "target",
    period: { id: periodId, startsOn, monthlyCost },
    policy,
    sourceRows,
    adjustmentsByEmployee,
    result: {
      employees: calculation.employees,
      departments: calculation.departments,
      totals: {
        activeLevelId: calculation.activeLevel?.id ?? null,
        totalProfitHalalas: calculation.totalProfitHalalas,
        companyGrossProfitHalalas: calculation.companyGrossProfitHalalas,
        surplusHalalas: calculation.surplusHalalas,
        salesPoolHalalas: calculation.salesPoolHalalas,
        employeeNetHalalas: calculation.employeeNetCommissionTotalHalalas,
        departmentIncentiveHalalas: calculation.departmentIncentiveTotalHalalas,
        totalNetIncentivesHalalas: calculation.totalNetIncentivesHalalas,
        totalVatHalalas: calculation.totalVatHalalas,
        totalGrossPayableHalalas: calculation.totalGrossPayableHalalas,
        companyRetainedProfitHalalas: calculation.companyRetainedProfitHalalas,
      },
      reconciliation: calculation.reconciliation,
    },
  };
}

export function commissionEngineResultForPersistence(
  snapshot: CommissionCalculationSnapshot,
): CommissionEnginePersistenceResult {
  const departmentNames = new Map(snapshot.policy.departments.map((department) => [department.id, department.name]));
  const employeeBaseHalalas = sum(snapshot.result.employees.map((employee) => employee.baseCommissionHalalas));
  const employeeAdjustmentHalalas = sum(snapshot.result.employees.map((employee) => employee.adjustmentTotalHalalas));
  const employeeNetHalalas = sum(snapshot.result.employees.map((employee) => employee.netCommissionHalalas));
  const departmentHalalas = sum(snapshot.result.departments.map((department) => department.baseIncentiveHalalas));
  const vatHalalas = sum([
    ...snapshot.result.employees.map((employee) => employee.vatAmountHalalas),
    ...snapshot.result.departments.map((department) => department.vatAmountHalalas),
  ]);
  const grossHalalas = sum([
    ...snapshot.result.employees.map((employee) => employee.grossPayableHalalas),
    ...snapshot.result.departments.map((department) => department.grossPayableHalalas),
  ]);
  return {
    employees: snapshot.result.employees,
    departments: snapshot.result.departments.map((department) => ({
      ...department,
      departmentName: departmentNames.get(department.departmentId) ?? department.departmentId,
    })),
    employeeBaseCommissionTotal: fromHalalas(employeeBaseHalalas),
    employeeAdjustmentTotal: fromHalalas(employeeAdjustmentHalalas),
    employeeNetCommissionTotal: fromHalalas(employeeNetHalalas),
    departmentIncentiveTotal: fromHalalas(departmentHalalas),
    totalNetIncentives: fromHalalas(employeeNetHalalas + departmentHalalas),
    totalVat: fromHalalas(vatHalalas),
    totalGrossPayable: fromHalalas(grossHalalas),
    reconciliation: snapshot.result.reconciliation,
  };
}

function parseTier(value: unknown): LegacyTier {
  const tier = requiredRecord(value, "شريحة العمولة");
  const from = money(tier.from, "بداية الشريحة", true);
  const to = tier.to === null ? null : money(tier.to, "نهاية الشريحة", true);
  if (to !== null && to <= from) throw new Error("نهاية الشريحة يجب أن تتجاوز بدايتها");
  return { from, to, rate: rate(tier.rate, "نسبة الشريحة"), label: requiredText(tier.label, "اسم الشريحة", 200) };
}

function parseLevel(value: unknown): TargetLevel {
  const level = requiredRecord(value, "مستوى الهدف");
  const costMultiplier = finite(level.costMultiplier, "مضاعف التكلفة");
  if (costMultiplier <= 0 || costMultiplier > 100) throw new Error("مضاعف التكلفة خارج النطاق");
  return { id: requiredText(level.id, "معرّف المستوى", 100), label: requiredText(level.label, "اسم المستوى", 200), costMultiplier, rate: rate(level.rate, "نسبة المستوى") };
}

function assertOrderedTiers(tiers: LegacyTier[]) {
  if (tiers.length === 0) throw new Error("يجب تعريف شريحة عمولة واحدة على الأقل");
  if (tiers[0].from !== 0) throw new Error("يجب أن تبدأ الشرائح من صفر");
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const next = tiers[index + 1];
    if (tier.to === null && next) throw new Error("الشريحة المفتوحة يجب أن تكون الأخيرة");
    if (next && tier.to !== next.from) throw new Error("يجب أن تكون الشرائح متصلة دون فجوات أو تداخل");
  }
}

function parseEmployeeTargets(value: unknown) {
  const source = requiredRecord(value, "أهداف الموظفين");
  const result: Record<string, number> = {};
  for (const [employeeId, target] of Object.entries(source)) result[uuid(employeeId, "معرّف هدف الموظف")] = money(target, "هدف الموظف", true);
  return result;
}

function parseAdjustments(value: unknown, employeeIds: Set<string>) {
  const source = requiredRecord(value, "تعديلات الموظفين");
  const result: Record<string, CommissionAdjustment[]> = {};
  for (const [employeeId, rawAdjustments] of Object.entries(source)) {
    const validId = uuid(employeeId, "معرّف موظف التعديل");
    if (!employeeIds.has(validId)) throw new Error("يوجد تعديل لموظف غير موجود في الفترة");
    result[validId] = requiredArray(rawAdjustments, "تعديلات الموظف").map((adjustment) => {
      const item = requiredRecord(adjustment, "التعديل");
      return { amount: money(item.amount, "قيمة التعديل") };
    });
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requiredRecord(value: unknown, field: string) { if (!isRecord(value)) throw new Error(`${field} غير صحيح`); return value; }
function requiredArray(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${field} غير صحيح`); return value; }
function requiredText(value: unknown, field: string, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} غير صحيح`); return value.trim(); }
function requiredDate(value: unknown, field: string) {
  const text = requiredText(value, field, 10);
  if (!DATE_PATTERN.test(text)) throw new Error(`${field} غير صحيح`);
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error(`${field} غير صحيح`);
  return text;
}
function boolean(value: unknown, field: string) { if (typeof value !== "boolean") throw new Error(`${field} غير صحيح`); return value; }
function finite(value: unknown, field: string) { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} غير صحيح`); return value; }
function money(value: unknown, field: string, nonnegative = false) { const result = finite(value, field); if (Math.abs(result) > MONEY_LIMIT || (nonnegative && result < 0)) throw new Error(`${field} خارج النطاق`); return result; }
function rate(value: unknown, field: string) { const result = finite(value, field); if (result < 0 || result > 1) throw new Error(`${field} يجب أن تكون بين 0 و1`); return result; }
function count(value: unknown, field: string) { if (value === null) return null; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} غير صحيح`); return value; }
function uuid(value: unknown, field: string) { const text = requiredText(value, field, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`${field} غير صحيح`); return text.toLowerCase(); }
function assertUnique(items: string[], field: string) { if (new Set(items).size !== items.length) throw new Error(`${field} مكرر`); }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
