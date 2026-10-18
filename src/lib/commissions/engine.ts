export type Money = number;

/** Integer minor units. One SAR is exactly 100 halalas. */
export type Halalas = number;

export type SaleRow = {
  employeeId: string;
  sales: Money;
  profit: Money;
  saleCount: number | null;
  refundCount: number | null;
  excluded?: boolean;
};

export type LegacyTier = {
  from: Money;
  to: Money | null;
  rate: number;
  label: string;
};

export type TargetLevel = {
  id: string;
  label: string;
  costMultiplier: number;
  rate: number;
};

export type TargetPolicy = {
  levels: TargetLevel[];
  weightBlend: number;
  individualFallback: { enabled: boolean; rate: number };
  departmentRates: Record<string, Record<string, number>>;
};

export type VatPolicy = {
  enabled: boolean;
  rate: number;
};

/** Only adjustments supplied to the engine are part of the financial snapshot. */
export type CommissionAdjustment = {
  amount: Money;
};

export type CommissionSettlementOptions = {
  adjustments?: readonly CommissionAdjustment[];
  vat?: VatPolicy;
};

export type TargetCalculationOptions = {
  adjustmentsByEmployee?: Readonly<Record<string, readonly CommissionAdjustment[]>>;
  vat?: VatPolicy;
};

export type TierBreakdown = LegacyTier & {
  base: Money;
  commission: Money;
  baseHalalas: Halalas;
  commissionHalalas: Halalas;
};

export type CommissionSettlement = {
  baseCommission: Money;
  adjustmentTotal: Money;
  netCommission: Money;
  vatAmount: Money;
  grossPayable: Money;
  baseCommissionHalalas: Halalas;
  adjustmentTotalHalalas: Halalas;
  netCommissionHalalas: Halalas;
  vatAmountHalalas: Halalas;
  grossPayableHalalas: Halalas;
};

export type EmployeeCommission = CommissionSettlement & {
  employeeId: string;
  model: "legacy" | "target";
  grossSales: Money;
  grossProfit: Money;
  eligibleProfit: Money;
  refundAdjustment: Money;
  companyShare: Money;
  grossSalesHalalas: Halalas;
  grossProfitHalalas: Halalas;
  eligibleProfitHalalas: Halalas;
  refundAdjustmentHalalas: Halalas;
  companyShareHalalas: Halalas;
  salesShare: number;
  orderShare: number;
  weight: number;
  viaFallback: boolean;
  tierBreakdown: TierBreakdown[];
};

export type DepartmentIncentive = {
  departmentId: string;
  rate: number;
  baseIncentive: Money;
  vatAmount: Money;
  grossPayable: Money;
  baseIncentiveHalalas: Halalas;
  vatAmountHalalas: Halalas;
  grossPayableHalalas: Halalas;
};

export type TargetCommissionResult = {
  /** Profit eligible for target-level evaluation (excluded employees omitted). */
  totalProfit: Money;
  /** Accounting profit before commissions (all supplied rows included). */
  companyGrossProfit: Money;
  surplus: Money;
  activeLevel: TargetLevel | null;
  salesPool: Money;
  allocatedSalesPool: Money;
  unallocatedSalesPool: Money;
  employeeBaseCommissionTotal: Money;
  employeeAdjustmentTotal: Money;
  employeeNetCommissionTotal: Money;
  departmentIncentiveTotal: Money;
  totalNetIncentives: Money;
  totalVat: Money;
  totalGrossPayable: Money;
  companyRetainedProfit: Money;
  totalProfitHalalas: Halalas;
  companyGrossProfitHalalas: Halalas;
  surplusHalalas: Halalas;
  salesPoolHalalas: Halalas;
  allocatedSalesPoolHalalas: Halalas;
  unallocatedSalesPoolHalalas: Halalas;
  employeeBaseCommissionTotalHalalas: Halalas;
  employeeAdjustmentTotalHalalas: Halalas;
  employeeNetCommissionTotalHalalas: Halalas;
  departmentIncentiveTotalHalalas: Halalas;
  totalNetIncentivesHalalas: Halalas;
  totalVatHalalas: Halalas;
  totalGrossPayableHalalas: Halalas;
  companyRetainedProfitHalalas: Halalas;
  departmentIncentives: Record<string, Money>;
  departments: DepartmentIncentive[];
  employees: EmployeeCommission[];
  reconciliation: {
    employeeItemsEqualAllocatedPool: boolean;
    netSplitEqualsCompanyGrossProfit: boolean;
    vatItemsEqualAggregateVat: boolean;
    grossPayableEqualsNetPlusVat: boolean;
  };
};

type Fraction = {
  numerator: bigint;
  denominator: bigint;
};

type PreparedRow = {
  source: SaleRow;
  salesHalalas: Halalas;
  profitHalalas: Halalas;
  saleCount: number | null;
  refundCount: number | null;
};

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_TEN = BigInt(10);
const BIG_HUNDRED = BigInt(100);
const ZERO_FRACTION: Fraction = { numerator: BIG_ZERO, denominator: BIG_ONE };
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function bigintAbs(value: bigint): bigint {
  return value < BIG_ZERO ? -value : value;
}

function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let left = bigintAbs(a);
  let right = bigintAbs(b);
  while (right !== BIG_ZERO) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left || BIG_ONE;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator === BIG_ZERO) throw new Error("Fraction denominator cannot be zero.");
  const sign = denominator < BIG_ZERO ? -BIG_ONE : BIG_ONE;
  const normalizedNumerator = numerator * sign;
  const normalizedDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator);
  return {
    numerator: normalizedNumerator / divisor,
    denominator: normalizedDenominator / divisor,
  };
}

function addFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subtractFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function multiplyFractions(left: Fraction, right: Fraction): Fraction {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

function decimalFraction(value: number | string, field: string): Fraction {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  if (text.length === 0 || text.length > 128) {
    throw new Error(`${field} is not a supported decimal value.`);
  }

  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new Error(`${field} is not a supported decimal value.`);

  const sign = match[1] === "-" ? -BIG_ONE : BIG_ONE;
  const integerDigits = match[2];
  const decimalDigits = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) {
    throw new Error(`${field} exponent is outside the supported range.`);
  }

  const digits = BigInt(`${integerDigits}${decimalDigits}` || "0");
  const scale = decimalDigits.length - exponent;
  if (scale <= 0) {
    return fraction(sign * digits * BIG_TEN ** BigInt(-scale), BIG_ONE);
  }
  return fraction(sign * digits, BIG_TEN ** BigInt(scale));
}

function roundFraction(value: Fraction): bigint {
  const negative = value.numerator < BIG_ZERO;
  const absoluteNumerator = bigintAbs(value.numerator);
  let rounded = absoluteNumerator / value.denominator;
  const remainder = absoluteNumerator % value.denominator;
  if (remainder * BIG_TWO >= value.denominator) rounded += BIG_ONE;
  return negative ? -rounded : rounded;
}

function toSafeInteger(value: bigint, field: string): number {
  if (value > MAX_SAFE_BIGINT || value < -MAX_SAFE_BIGINT) {
    throw new Error(`${field} exceeds the supported exact-money range.`);
  }
  return Number(value);
}

function sumHalalas(values: readonly Halalas[], field: string): Halalas {
  return toSafeInteger(
    values.reduce((sum, value) => sum + BigInt(value), BIG_ZERO),
    field,
  );
}

/** Converts a decimal SAR value to integer halalas using half-away-from-zero rounding. */
export function toHalalas(value: Money | string): Halalas {
  const parsed = decimalFraction(value, "money");
  return toSafeInteger(
    roundFraction(fraction(parsed.numerator * BIG_HUNDRED, parsed.denominator)),
    "money",
  );
}

/** Converts exact integer halalas back to a two-decimal SAR number. */
export function fromHalalas(value: Halalas): Money {
  if (!Number.isSafeInteger(value)) throw new Error("Halalas must be a safe integer.");
  return value / 100;
}

function rateFraction(value: number, field: string): Fraction {
  const parsed = decimalFraction(value, field);
  if (parsed.numerator < BIG_ZERO || parsed.numerator > parsed.denominator) {
    throw new Error(`${field} must be between 0 and 1.`);
  }
  return parsed;
}

function nonNegativeFraction(value: number, field: string): Fraction {
  const parsed = decimalFraction(value, field);
  if (parsed.numerator < BIG_ZERO) throw new Error(`${field} must be non-negative.`);
  return parsed;
}

function multiplyHalalasByFraction(
  amountHalalas: Halalas,
  multiplier: Fraction,
  field: string,
): Halalas {
  return toSafeInteger(
    roundFraction(fraction(BigInt(amountHalalas) * multiplier.numerator, multiplier.denominator)),
    field,
  );
}

function fractionToNumber(value: Fraction): number {
  return Number(value.numerator) / Number(value.denominator);
}

function prepareCount(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer or null.`);
  }
  return value;
}

function prepareRow(row: SaleRow): PreparedRow {
  if (!row.employeeId.trim()) throw new Error("employeeId is required.");
  return {
    source: row,
    salesHalalas: toHalalas(row.sales),
    profitHalalas: toHalalas(row.profit),
    saleCount: prepareCount(row.saleCount, `saleCount for ${row.employeeId}`),
    refundCount: prepareCount(row.refundCount, `refundCount for ${row.employeeId}`),
  };
}

function compareStableKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Largest-remainder allocation. The rounded total is calculated once and every
 * residual halala is assigned by remainder, then by the stable key.
 */
function allocateFractionQuotas(
  quotas: readonly Fraction[],
  stableKeys: readonly string[],
): Halalas[] {
  if (quotas.length !== stableKeys.length) throw new Error("Quota keys do not match quota items.");
  if (quotas.some((quota) => quota.numerator < BIG_ZERO)) {
    throw new Error("Financial allocation quotas cannot be negative.");
  }

  const exactTotal = quotas.reduce(addFractions, ZERO_FRACTION);
  const roundedTotal = roundFraction(exactTotal);
  const floors = quotas.map((quota) => quota.numerator / quota.denominator);
  const floorTotal = floors.reduce((sum, value) => sum + value, BIG_ZERO);
  let residual = roundedTotal - floorTotal;

  const ranked = quotas
    .map((quota, index) => ({
      index,
      key: stableKeys[index],
      remainderNumerator: quota.numerator % quota.denominator,
      remainderDenominator: quota.denominator,
    }))
    .sort((left, right) => {
      const leftScaled = left.remainderNumerator * right.remainderDenominator;
      const rightScaled = right.remainderNumerator * left.remainderDenominator;
      if (leftScaled !== rightScaled) return leftScaled > rightScaled ? -1 : 1;
      return compareStableKeys(left.key, right.key);
    });

  const allocation = [...floors];
  for (const item of ranked) {
    if (residual <= BIG_ZERO) break;
    allocation[item.index] += BIG_ONE;
    residual -= BIG_ONE;
  }
  if (residual !== BIG_ZERO) throw new Error("Unable to reconcile allocation residuals.");

  return allocation.map((value) => toSafeInteger(value, "allocation"));
}

function validateVat(vat: VatPolicy | undefined): Fraction {
  if (!vat?.enabled) return ZERO_FRACTION;
  return rateFraction(vat.rate, "VAT rate");
}

function settleHalalas(
  baseCommissionHalalas: Halalas,
  adjustments: readonly CommissionAdjustment[],
  vat: VatPolicy | undefined,
): CommissionSettlement {
  if (!Number.isSafeInteger(baseCommissionHalalas) || baseCommissionHalalas < 0) {
    throw new Error("Base commission must be a non-negative integer number of halalas.");
  }
  const adjustmentTotalHalalas = sumHalalas(
    adjustments.map((adjustment) => toHalalas(adjustment.amount)),
    "adjustment total",
  );
  const beforeFloor = sumHalalas(
    [baseCommissionHalalas, adjustmentTotalHalalas],
    "net commission before floor",
  );
  const netCommissionHalalas = Math.max(0, beforeFloor);
  const vatAmountHalalas = multiplyHalalasByFraction(
    netCommissionHalalas,
    validateVat(vat),
    "VAT amount",
  );
  const grossPayableHalalas = sumHalalas(
    [netCommissionHalalas, vatAmountHalalas],
    "gross payable",
  );

  return {
    baseCommission: fromHalalas(baseCommissionHalalas),
    adjustmentTotal: fromHalalas(adjustmentTotalHalalas),
    netCommission: fromHalalas(netCommissionHalalas),
    vatAmount: fromHalalas(vatAmountHalalas),
    grossPayable: fromHalalas(grossPayableHalalas),
    baseCommissionHalalas,
    adjustmentTotalHalalas,
    netCommissionHalalas,
    vatAmountHalalas,
    grossPayableHalalas,
  };
}

/** Applies adjustments, the zero floor and optional VAT to an existing base commission. */
export function applyCommissionSettlement(
  baseCommission: Money,
  adjustments: readonly CommissionAdjustment[] = [],
  vat?: VatPolicy,
): CommissionSettlement {
  return settleHalalas(toHalalas(baseCommission), adjustments, vat);
}

/**
 * Reconciles VAT over a complete set of employee entitlements. The aggregate
 * VAT is rounded once, then residual halalas are assigned deterministically by
 * employee id. Use this for legacy cycles whose items are calculated one by
 * one but settled as one accounting batch.
 */
export function settleEmployeeVat<T extends CommissionSettlement & { employeeId: string }>(
  employees: readonly T[],
  vat: VatPolicy | undefined,
): T[] {
  const vatRate = validateVat(vat);
  const quotas = employees.map((employee) => fraction(
    BigInt(employee.netCommissionHalalas) * vatRate.numerator,
    vatRate.denominator,
  ));
  const allocations = allocateFractionQuotas(quotas, employees.map((employee) => `employee:${employee.employeeId}`));
  return employees.map((employee, index) => {
    const vatAmountHalalas = allocations[index];
    const grossPayableHalalas = sumHalalas(
      [employee.netCommissionHalalas, vatAmountHalalas],
      `gross payable for ${employee.employeeId}`,
    );
    return {
      ...employee,
      vatAmount: fromHalalas(vatAmountHalalas),
      grossPayable: fromHalalas(grossPayableHalalas),
      vatAmountHalalas,
      grossPayableHalalas,
    };
  });
}

function validateTiers(tiers: readonly LegacyTier[]): Array<{
  tier: LegacyTier;
  fromHalalas: Halalas;
  toHalalas: Halalas | null;
  rate: Fraction;
}> {
  if (tiers.length === 0) throw new Error("At least one legacy tier is required.");
  let expectedFrom = 0;
  let openEndedSeen = false;

  return tiers.map((tier, index) => {
    if (openEndedSeen) throw new Error("No tier can follow an open-ended legacy tier.");
    const fromHalalas = toHalalas(tier.from);
    const toHalalasValue = tier.to === null ? null : toHalalas(tier.to);
    if (fromHalalas !== expectedFrom) {
      throw new Error(`Legacy tier ${index + 1} must start where the previous tier ended.`);
    }
    if (toHalalasValue !== null && toHalalasValue <= fromHalalas) {
      throw new Error(`Legacy tier ${index + 1} must have a positive range.`);
    }
    if (toHalalasValue === null) openEndedSeen = true;
    else expectedFrom = toHalalasValue;

    return {
      tier,
      fromHalalas,
      toHalalas: toHalalasValue,
      rate: rateFraction(tier.rate, `legacy tier rate ${index + 1}`),
    };
  });
}

export function computeTierBreakdown(
  eligibleProfit: Money,
  tiers: LegacyTier[],
): { breakdown: TierBreakdown[]; total: Money; totalHalalas: Halalas } {
  let remainingHalalas = Math.max(0, toHalalas(eligibleProfit));
  const validatedTiers = validateTiers(tiers);
  const staged: Array<{
    tier: LegacyTier;
    baseHalalas: Halalas;
    commissionQuota: Fraction;
    stableKey: string;
  }> = [];

  for (let index = 0; index < validatedTiers.length; index += 1) {
    const current = validatedTiers[index];
    const sizeHalalas = current.toHalalas === null
      ? remainingHalalas
      : current.toHalalas - current.fromHalalas;
    const baseHalalas = Math.min(remainingHalalas, sizeHalalas);
    staged.push({
      tier: current.tier,
      baseHalalas,
      commissionQuota: fraction(
        BigInt(baseHalalas) * current.rate.numerator,
        current.rate.denominator,
      ),
      stableKey: String(index).padStart(8, "0"),
    });
    remainingHalalas -= baseHalalas;
    if (remainingHalalas <= 0) break;
  }

  const allocated = allocateFractionQuotas(
    staged.map((item) => item.commissionQuota),
    staged.map((item) => item.stableKey),
  );
  const totalHalalas = sumHalalas(allocated, "legacy commission total");
  const breakdown = staged.map((item, index) => ({
    ...item.tier,
    base: fromHalalas(item.baseHalalas),
    commission: fromHalalas(allocated[index]),
    baseHalalas: item.baseHalalas,
    commissionHalalas: allocated[index],
  }));

  return { breakdown, total: fromHalalas(totalHalalas), totalHalalas };
}

function buildEmployeeCommission(args: {
  row: PreparedRow;
  model: "legacy" | "target";
  eligibleProfitHalalas: Halalas;
  baseCommissionHalalas: Halalas;
  refundAdjustmentHalalas?: Halalas;
  salesShare?: number;
  orderShare?: number;
  weight?: number;
  viaFallback?: boolean;
  tierBreakdown?: TierBreakdown[];
  settlement?: CommissionSettlementOptions;
}): EmployeeCommission {
  const settlement = settleHalalas(
    args.baseCommissionHalalas,
    args.settlement?.adjustments ?? [],
    args.settlement?.vat,
  );
  const refundAdjustmentHalalas = args.refundAdjustmentHalalas ?? 0;
  const companyShareHalalas = sumHalalas(
    [args.row.profitHalalas, -settlement.netCommissionHalalas],
    `company share for ${args.row.source.employeeId}`,
  );

  return {
    employeeId: args.row.source.employeeId,
    model: args.model,
    grossSales: fromHalalas(args.row.salesHalalas),
    grossProfit: fromHalalas(args.row.profitHalalas),
    eligibleProfit: fromHalalas(args.eligibleProfitHalalas),
    refundAdjustment: fromHalalas(refundAdjustmentHalalas),
    companyShare: fromHalalas(companyShareHalalas),
    grossSalesHalalas: args.row.salesHalalas,
    grossProfitHalalas: args.row.profitHalalas,
    eligibleProfitHalalas: args.eligibleProfitHalalas,
    refundAdjustmentHalalas,
    companyShareHalalas,
    salesShare: args.salesShare ?? 0,
    orderShare: args.orderShare ?? 0,
    weight: args.weight ?? 0,
    viaFallback: args.viaFallback ?? false,
    tierBreakdown: args.tierBreakdown ?? [],
    ...settlement,
  };
}

export function calculateLegacyCommission(
  row: SaleRow,
  tiers: LegacyTier[],
  minEligibleProfit: Money,
  refundHandling: "none" | "deduct_refund_profit",
  settlement: CommissionSettlementOptions = {},
): EmployeeCommission {
  const prepared = prepareRow(row);
  const minEligibleProfitHalalas = toHalalas(minEligibleProfit);
  if (minEligibleProfitHalalas < 0) throw new Error("Minimum eligible profit cannot be negative.");

  let eligibleProfitHalalas = row.excluded ? 0 : prepared.profitHalalas;
  let refundAdjustmentHalalas = 0;
  if (
    !row.excluded &&
    refundHandling === "deduct_refund_profit" &&
    prepared.refundCount !== null &&
    prepared.saleCount !== null &&
    prepared.refundCount > 0 &&
    prepared.saleCount > 0
  ) {
    const observedRefundShare = fraction(
      BigInt(prepared.refundCount),
      BigInt(prepared.saleCount + prepared.refundCount),
    );
    const refundShare = observedRefundShare.numerator * BIG_TWO > observedRefundShare.denominator
      ? fraction(BIG_ONE, BIG_TWO)
      : observedRefundShare;
    refundAdjustmentHalalas = multiplyHalalasByFraction(
      Math.max(0, prepared.profitHalalas),
      refundShare,
      "refund adjustment",
    );
    eligibleProfitHalalas = sumHalalas(
      [prepared.profitHalalas, -refundAdjustmentHalalas],
      "eligible profit after refunds",
    );
  }

  eligibleProfitHalalas = Math.max(0, eligibleProfitHalalas);
  if (eligibleProfitHalalas < minEligibleProfitHalalas) eligibleProfitHalalas = 0;
  const tierResult = computeTierBreakdown(fromHalalas(eligibleProfitHalalas), tiers);

  return buildEmployeeCommission({
    row: prepared,
    model: "legacy",
    eligibleProfitHalalas,
    baseCommissionHalalas: tierResult.totalHalalas,
    refundAdjustmentHalalas,
    tierBreakdown: tierResult.breakdown,
    settlement,
  });
}

function levelIsAchieved(
  totalProfitHalalas: Halalas,
  monthlyCostHalalas: Halalas,
  multiplier: Fraction,
): boolean {
  return BigInt(totalProfitHalalas) * multiplier.denominator
    >= BigInt(monthlyCostHalalas) * multiplier.numerator;
}

function makeShare(numerator: number, denominator: number): Fraction {
  if (denominator <= 0 || numerator <= 0) return ZERO_FRACTION;
  return fraction(BigInt(numerator), BigInt(denominator));
}

export function calculateTargetCommissions(
  rows: SaleRow[],
  monthlyCost: Money,
  employeeTargets: Record<string, Money>,
  policy: TargetPolicy,
  options: TargetCalculationOptions = {},
): TargetCommissionResult {
  const preparedRows = rows.map(prepareRow);
  const employeeIds = new Set<string>();
  for (const row of preparedRows) {
    if (employeeIds.has(row.source.employeeId)) {
      throw new Error(`Duplicate employeeId in target calculation: ${row.source.employeeId}`);
    }
    employeeIds.add(row.source.employeeId);
  }

  const monthlyCostHalalas = toHalalas(monthlyCost);
  if (monthlyCostHalalas < 0) throw new Error("Monthly cost cannot be negative.");
  const eligibleRows = preparedRows.filter((row) => !row.source.excluded);
  const companyGrossProfitHalalas = sumHalalas(
    preparedRows.map((row) => row.profitHalalas),
    "company gross profit",
  );
  const totalProfitHalalas = sumHalalas(
    eligibleRows.map((row) => row.profitHalalas),
    "total profit",
  );

  const levelIds = new Set<string>();
  const levels = policy.levels
    .map((level) => {
      if (!level.id.trim()) throw new Error("Target level id is required.");
      if (levelIds.has(level.id)) throw new Error(`Duplicate target level id: ${level.id}`);
      levelIds.add(level.id);
      return {
        level,
        multiplier: nonNegativeFraction(level.costMultiplier, `cost multiplier ${level.id}`),
        rate: rateFraction(level.rate, `target rate ${level.id}`),
      };
    })
    .sort((left, right) => {
      const leftScaled = left.multiplier.numerator * right.multiplier.denominator;
      const rightScaled = right.multiplier.numerator * left.multiplier.denominator;
      if (leftScaled === rightScaled) return compareStableKeys(left.level.id, right.level.id);
      return leftScaled < rightScaled ? -1 : 1;
    });

  let active: (typeof levels)[number] | null = null;
  for (const level of levels) {
    if (levelIsAchieved(totalProfitHalalas, monthlyCostHalalas, level.multiplier)) active = level;
  }

  const surplusHalalas = Math.max(0, totalProfitHalalas - monthlyCostHalalas);
  const salesPoolHalalas = active
    ? multiplyHalalasByFraction(surplusHalalas, active.rate, "sales pool")
    : 0;
  const totalSalesHalalas = sumHalalas(
    eligibleRows.map((row) => Math.max(0, row.salesHalalas)),
    "total sales",
  );
  const totalOrders = eligibleRows.reduce((sum, row) => sum + (row.saleCount ?? 0), 0);
  if (!Number.isSafeInteger(totalOrders)) throw new Error("Total orders exceed the supported range.");
  const hasOrders = totalOrders > 0 && eligibleRows.some((row) => row.saleCount !== null);
  const blend = rateFraction(policy.weightBlend, "weight blend");
  const fallbackRate = rateFraction(policy.individualFallback.rate, "individual fallback rate");

  const allocations = new Map<string, {
    baseCommissionHalalas: Halalas;
    salesShare: Fraction;
    orderShare: Fraction;
    weight: Fraction;
    viaFallback: boolean;
  }>();

  if (active) {
    const quotas = preparedRows.map((row) => {
      if (row.source.excluded) return ZERO_FRACTION;
      const salesShare = makeShare(Math.max(0, row.salesHalalas), totalSalesHalalas);
      const orderShare = hasOrders
        ? makeShare(row.saleCount ?? 0, totalOrders)
        : salesShare;
      const weight = hasOrders
        ? addFractions(
          multiplyFractions(blend, orderShare),
          multiplyFractions(subtractFractions(fraction(BIG_ONE, BIG_ONE), blend), salesShare),
        )
        : salesShare;
      allocations.set(row.source.employeeId, {
        baseCommissionHalalas: 0,
        salesShare,
        orderShare,
        weight,
        viaFallback: false,
      });
      return fraction(
        BigInt(salesPoolHalalas) * weight.numerator,
        weight.denominator,
      );
    });
    const allocated = allocateFractionQuotas(
      quotas,
      preparedRows.map((row) => row.source.employeeId),
    );
    preparedRows.forEach((row, index) => {
      const current = allocations.get(row.source.employeeId) ?? {
        baseCommissionHalalas: 0,
        salesShare: ZERO_FRACTION,
        orderShare: ZERO_FRACTION,
        weight: ZERO_FRACTION,
        viaFallback: false,
      };
      allocations.set(row.source.employeeId, {
        ...current,
        baseCommissionHalalas: allocated[index],
      });
    });
  } else {
    for (const row of preparedRows) {
      let baseCommissionHalalas = 0;
      let viaFallback = false;
      if (!row.source.excluded && policy.individualFallback.enabled) {
        const employeeTargetHalalas = toHalalas(employeeTargets[row.source.employeeId] ?? 0);
        if (employeeTargetHalalas < 0) {
          throw new Error(`Employee target cannot be negative: ${row.source.employeeId}`);
        }
        if (row.profitHalalas > 0 && row.profitHalalas >= employeeTargetHalalas) {
          baseCommissionHalalas = multiplyHalalasByFraction(
            row.profitHalalas,
            fallbackRate,
            `fallback commission for ${row.source.employeeId}`,
          );
          viaFallback = true;
        }
      }
      allocations.set(row.source.employeeId, {
        baseCommissionHalalas,
        salesShare: ZERO_FRACTION,
        orderShare: ZERO_FRACTION,
        weight: ZERO_FRACTION,
        viaFallback,
      });
    }
  }

  let employees = preparedRows.map((row) => {
    const allocation = allocations.get(row.source.employeeId);
    if (!allocation) throw new Error(`Missing employee allocation: ${row.source.employeeId}`);
    return buildEmployeeCommission({
      row,
      model: "target",
      eligibleProfitHalalas: allocation.baseCommissionHalalas,
      baseCommissionHalalas: allocation.baseCommissionHalalas,
      salesShare: fractionToNumber(allocation.salesShare),
      orderShare: fractionToNumber(allocation.orderShare),
      weight: fractionToNumber(allocation.weight),
      viaFallback: allocation.viaFallback,
      settlement: {
        adjustments: options.adjustmentsByEmployee?.[row.source.employeeId] ?? [],
      },
    });
  });

  const departmentEntries = Object.entries(policy.departmentRates);
  const departmentIds = new Set<string>();
  let departments = departmentEntries.map(([departmentId, rates]) => {
    if (!departmentId.trim()) throw new Error("Department id is required.");
    if (departmentIds.has(departmentId)) throw new Error(`Duplicate department id: ${departmentId}`);
    departmentIds.add(departmentId);
    const rateValue = active ? (rates[active.level.id] ?? 0) : 0;
    const rate = rateFraction(rateValue, `department rate ${departmentId}`);
    const baseIncentiveHalalas = active
      ? multiplyHalalasByFraction(surplusHalalas, rate, `department incentive ${departmentId}`)
      : 0;
    const vatAmountHalalas = 0;
    const grossPayableHalalas = baseIncentiveHalalas;
    return {
      departmentId,
      rate: rateValue,
      baseIncentive: fromHalalas(baseIncentiveHalalas),
      vatAmount: fromHalalas(vatAmountHalalas),
      grossPayable: fromHalalas(grossPayableHalalas),
      baseIncentiveHalalas,
      vatAmountHalalas,
      grossPayableHalalas,
    };
  });

  const allocatedSalesPoolHalalas = sumHalalas(
    employees.map((employee) => active ? employee.baseCommissionHalalas : 0),
    "allocated sales pool",
  );
  const employeeBaseCommissionTotalHalalas = sumHalalas(
    employees.map((employee) => employee.baseCommissionHalalas),
    "employee base commission total",
  );
  const employeeAdjustmentTotalHalalas = sumHalalas(
    employees.map((employee) => employee.adjustmentTotalHalalas),
    "employee adjustment total",
  );
  const employeeNetCommissionTotalHalalas = sumHalalas(
    employees.map((employee) => employee.netCommissionHalalas),
    "employee net commission total",
  );
  const departmentIncentiveTotalHalalas = sumHalalas(
    departments.map((department) => department.baseIncentiveHalalas),
    "department incentive total",
  );
  const totalNetIncentivesHalalas = sumHalalas(
    [employeeNetCommissionTotalHalalas, departmentIncentiveTotalHalalas],
    "total net incentives",
  );

  // VAT is calculated from the aggregate exact net, then its residual halalas
  // are distributed deterministically over employee and department items.
  const vatRate = validateVat(options.vat);
  const vatQuotas = [
    ...employees.map((employee) => fraction(
      BigInt(employee.netCommissionHalalas) * vatRate.numerator,
      vatRate.denominator,
    )),
    ...departments.map((department) => fraction(
      BigInt(department.baseIncentiveHalalas) * vatRate.numerator,
      vatRate.denominator,
    )),
  ];
  const vatKeys = [
    ...employees.map((employee) => `employee:${employee.employeeId}`),
    ...departments.map((department) => `department:${department.departmentId}`),
  ];
  const vatAllocations = allocateFractionQuotas(vatQuotas, vatKeys);
  employees = employees.map((employee, index) => {
    const vatAmountHalalas = vatAllocations[index];
    const grossPayableHalalas = sumHalalas(
      [employee.netCommissionHalalas, vatAmountHalalas],
      `gross payable for ${employee.employeeId}`,
    );
    return {
      ...employee,
      vatAmount: fromHalalas(vatAmountHalalas),
      grossPayable: fromHalalas(grossPayableHalalas),
      vatAmountHalalas,
      grossPayableHalalas,
    };
  });
  departments = departments.map((department, index) => {
    const vatAmountHalalas = vatAllocations[employees.length + index];
    const grossPayableHalalas = sumHalalas(
      [department.baseIncentiveHalalas, vatAmountHalalas],
      `department gross payable ${department.departmentId}`,
    );
    return {
      ...department,
      vatAmount: fromHalalas(vatAmountHalalas),
      grossPayable: fromHalalas(grossPayableHalalas),
      vatAmountHalalas,
      grossPayableHalalas,
    };
  });

  const employeeVatTotalHalalas = sumHalalas(
    employees.map((employee) => employee.vatAmountHalalas),
    "employee VAT total",
  );
  const departmentVatTotalHalalas = sumHalalas(
    departments.map((department) => department.vatAmountHalalas),
    "department VAT total",
  );
  const totalVatHalalas = sumHalalas(
    [employeeVatTotalHalalas, departmentVatTotalHalalas],
    "total VAT",
  );
  const expectedVatHalalas = multiplyHalalasByFraction(
    totalNetIncentivesHalalas,
    vatRate,
    "aggregate VAT",
  );
  const totalGrossPayableHalalas = sumHalalas(
    [totalNetIncentivesHalalas, totalVatHalalas],
    "total gross payable",
  );
  const companyRetainedProfitHalalas = sumHalalas(
    [companyGrossProfitHalalas, -totalNetIncentivesHalalas],
    "company retained profit",
  );
  const unallocatedSalesPoolHalalas = sumHalalas(
    [salesPoolHalalas, -allocatedSalesPoolHalalas],
    "unallocated sales pool",
  );
  if (unallocatedSalesPoolHalalas < 0) {
    throw new Error("Allocated employee pool exceeds the calculated sales pool.");
  }

  const departmentIncentives = Object.fromEntries(
    departments.map((department) => [department.departmentId, department.baseIncentive]),
  );

  return {
    totalProfit: fromHalalas(totalProfitHalalas),
    companyGrossProfit: fromHalalas(companyGrossProfitHalalas),
    surplus: fromHalalas(surplusHalalas),
    activeLevel: active?.level ?? null,
    salesPool: fromHalalas(salesPoolHalalas),
    allocatedSalesPool: fromHalalas(allocatedSalesPoolHalalas),
    unallocatedSalesPool: fromHalalas(unallocatedSalesPoolHalalas),
    employeeBaseCommissionTotal: fromHalalas(employeeBaseCommissionTotalHalalas),
    employeeAdjustmentTotal: fromHalalas(employeeAdjustmentTotalHalalas),
    employeeNetCommissionTotal: fromHalalas(employeeNetCommissionTotalHalalas),
    departmentIncentiveTotal: fromHalalas(departmentIncentiveTotalHalalas),
    totalNetIncentives: fromHalalas(totalNetIncentivesHalalas),
    totalVat: fromHalalas(totalVatHalalas),
    totalGrossPayable: fromHalalas(totalGrossPayableHalalas),
    companyRetainedProfit: fromHalalas(companyRetainedProfitHalalas),
    totalProfitHalalas,
    companyGrossProfitHalalas,
    surplusHalalas,
    salesPoolHalalas,
    allocatedSalesPoolHalalas,
    unallocatedSalesPoolHalalas,
    employeeBaseCommissionTotalHalalas,
    employeeAdjustmentTotalHalalas,
    employeeNetCommissionTotalHalalas,
    departmentIncentiveTotalHalalas,
    totalNetIncentivesHalalas,
    totalVatHalalas,
    totalGrossPayableHalalas,
    companyRetainedProfitHalalas,
    departmentIncentives,
    departments,
    employees,
    reconciliation: {
      employeeItemsEqualAllocatedPool: !active
        || employeeBaseCommissionTotalHalalas === allocatedSalesPoolHalalas,
      netSplitEqualsCompanyGrossProfit:
        totalNetIncentivesHalalas + companyRetainedProfitHalalas === companyGrossProfitHalalas,
      vatItemsEqualAggregateVat: totalVatHalalas === expectedVatHalalas,
      grossPayableEqualsNetPlusVat:
        totalNetIncentivesHalalas + totalVatHalalas === totalGrossPayableHalalas,
    },
  };
}
