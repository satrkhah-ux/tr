/**
 * «وسائل الدفع ورسومها» — the ONE place that says how a client may pay and
 * what each way adds to the price (the owner, 2026-10-29). Pure: the price
 * calculator, the operations payment step, the offer's price update (session
 * F) and the payment-methods line of the PDF (session G) all read it, so a
 * fee changed by the administration moves every screen at once.
 *
 * The rates are the administration's (app_settings «payment_fees»,
 * lib/data/app-settings.ts getPaymentFees) — never hard-coded where they are
 * read. Their defaults are the owner's: Tabby and Tamara 8.766% (his
 * calculation sheet), Visa and a MyFatoorah link 2.5% — all ADDED on top of
 * the price, kept to 2 decimals as the sheet does (15,510 → 1,359.61 → 16,869.61).
 *
 * Method ids are stored strings (operation_payments.method, terms of the PDF):
 * never rename one — pos is «مدى/شبكة», card «فيزا», link «ماي فاتورة».
 */

export type PayMethod = "tabby" | "tamara" | "pos" | "card" | "link" | "cash" | "transfer";

/** The order a client is offered them in (the owner's list: تابي، تمارا، شبكة، فيزا، كاش، تحويل + ماي فاتورة). */
export const PAY_METHODS: readonly PayMethod[] = ["tabby", "tamara", "pos", "card", "link", "cash", "transfer"];

/** The name sessions F and G build on (the coordinator's seam, 2026-10-29) — the same list. */
export const PAYMENT_METHODS = PAY_METHODS;

/** As every client-facing paper prints it (always Arabic, like the receipt). */
export const PAY_METHOD_AR: Record<PayMethod, string> = {
  tabby: "تابي",
  tamara: "تمارا",
  pos: "شبكة (مدى)",
  card: "فيزا / ماستركارد",
  link: "رابط فاتورة (ماي فاتورة)",
  cash: "كاش",
  transfer: "تحويل بنكي",
};

/**
 * The short name a sentence names a method by — what G matches inside a
 * country's «تقسيط المبلغ» line (lib/offer/payment-methods.ts withMethodFees).
 */
export const PAYMENT_METHOD_LIST: readonly { id: PayMethod; name: string }[] = [
  { id: "tabby", name: "تابي" },
  { id: "tamara", name: "تمارا" },
  { id: "pos", name: "مدى" },
  { id: "card", name: "فيزا" },
  { id: "link", name: "ماي فاتورة" },
  { id: "cash", name: "كاش" },
  { id: "transfer", name: "تحويل" },
];

/** A method's charge: a share of the price plus a fixed amount in SAR. null = «غير محددة» (the administration unset it). */
export type MethodFee = { pct: number; fixed: number } | null;
export type PaymentFees = Record<PayMethod, MethodFee>;

export const DEFAULT_FEES: PaymentFees = {
  tabby: { pct: 8.766, fixed: 0 },
  tamara: { pct: 8.766, fixed: 0 },
  pos: { pct: 0, fixed: 0 },
  card: { pct: 2.5, fixed: 0 },
  link: { pct: 2.5, fixed: 0 },
  cash: { pct: 0, fixed: 0 },
  transfer: { pct: 0, fixed: 0 },
};

/** What a recorded payment may carry (operation_payments.method) — every PayMethod; kept for callers of 3b90d17. */
export type RecordedMethod = PayMethod;

export const isPayMethod = (v: unknown): v is PayMethod => typeof v === "string" && (PAY_METHODS as readonly string[]).includes(v);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A sane fee or null: a share 0–30% (to 3 decimals — 8.766), a fixed 0–1000 SAR. Anything else is not trusted. */
function cleanFee(v: unknown): MethodFee {
  if (!v || typeof v !== "object") return null;
  const pct = Number((v as { pct?: unknown }).pct);
  const fixed = Number((v as { fixed?: unknown }).fixed ?? 0);
  if (!Number.isFinite(pct) || pct < 0 || pct > 30) return null;
  if (!Number.isFinite(fixed) || fixed < 0 || fixed > 1000) return null;
  return { pct: Math.round(pct * 1000) / 1000, fixed: round2(fixed) };
}

/**
 * The stored JSON over the defaults: a method the administration set takes its
 * value, an explicit `null` UNSETS it, anything unreadable keeps the default.
 */
export function parseFees(raw: string | null | undefined): PaymentFees {
  const fees: PaymentFees = { ...DEFAULT_FEES };
  if (!raw) return fees;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fees;
  }
  if (!parsed || typeof parsed !== "object") return fees;
  for (const m of PAY_METHODS) {
    if (!(m in parsed)) continue;
    const v = (parsed as Record<string, unknown>)[m];
    fees[m] = v === null ? null : (cleanFee(v) ?? fees[m]);
  }
  return fees;
}

export type MethodQuote =
  | { method: PayMethod; unset: false; fee: number; total: number }
  | { method: PayMethod; unset: true };

/**
 * What the client pays by `method` for a trip priced `base` SAR: the share and
 * the fixed charge ADDED on top (the owner's sheet: price × 8.766% added, not
 * deducted), to 2 decimals as the sheet keeps them.
 */
export function quoteMethod(base: number, method: PayMethod, fees: PaymentFees): MethodQuote {
  const fee = fees[method];
  if (!fee) return { method, unset: true };
  if (!Number.isFinite(base) || base <= 0) return { method, unset: false, fee: 0, total: 0 };
  const charge = round2((base * fee.pct) / 100 + fee.fixed);
  return { method, unset: false, fee: charge, total: round2(base + charge) };
}

/** Every method, in the order a client is offered them. */
export function quoteAll(base: number, fees: PaymentFees): MethodQuote[] {
  return PAY_METHODS.map((m) => quoteMethod(base, m, fees));
}

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/**
 * One method's charge as F (the price update) and G (the PDF) print it: `fee`
 * and `total` in SAR (staff screens only) and `note`, the client-facing line —
 * the TOTAL alone («16,869.61 ريال»). BINDING (the owner, 2026-10-29): Tabby,
 * Tamara and MyFatoorah forbid telling the client the fee or its share, so no
 * client text ever carries «رسوم», a fee amount or a %. null for an unknown or
 * unset method — print the line as it is, never a guessed price. `fees` is
 * getPaymentFees(), never a constant.
 */
export function paymentFee(method: string, amount: number, fees: PaymentFees): { fee: number; total: number; note: string } | null {
  if (!isPayMethod(method)) return null;
  const q = quoteMethod(amount, method, fees);
  if (q.unset || !(amount > 0)) return null;
  return { fee: q.fee, total: q.total, note: `${money(q.total)} ريال` };
}

/** G's `fee` callback (withMethodFees(lines, total, PAYMENT_METHOD_LIST, methodFeeFn(fees))), the fees bound once. */
export const methodFeeFn = (fees: PaymentFees) => (methodId: string, amount: number) => paymentFee(methodId, amount, fees);

// ------------------------------------------------ Tabby / Tamara settlement --

/** The two that pay us out later, on a fixed weekday (the owner, 2026-10-29). */
export const BNPL_METHODS: readonly PayMethod[] = ["tabby", "tamara"];
export const isBnpl = (m: string | null | undefined): boolean => Boolean(m && (BNPL_METHODS as readonly string[]).includes(m));

/**
 * Their payout rule, the administration's (app_settings «bnpl_settlement»):
 * the weekday they pay (0 = Sunday … 3 = Wednesday) and how many WEEKS after
 * the first such day the money actually lands.
 */
export type SettlementRule = { weekday: number; lagWeeks: number };
export const DEFAULT_SETTLEMENT: SettlementRule = { weekday: 3, lagWeeks: 1 };

export function parseSettlement(raw: string | null | undefined): SettlementRule {
  try {
    const v = JSON.parse(raw ?? "") as Partial<SettlementRule>;
    const weekday = Number(v.weekday);
    const lagWeeks = Number(v.lagWeeks);
    return {
      weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : DEFAULT_SETTLEMENT.weekday,
      lagWeeks: Number.isInteger(lagWeeks) && lagWeeks >= 0 && lagWeeks <= 8 ? lagWeeks : DEFAULT_SETTLEMENT.lagWeeks,
    };
  } catch {
    return { ...DEFAULT_SETTLEMENT };
  }
}

/**
 * When a Tabby/Tamara payment made on `paidOn` (YYYY-MM-DD) should reach us:
 * the first payout weekday ON or after that day, then `lagWeeks` more weeks.
 * The owner's «سدد يوم الاثنين ليس الأربعاء يسدد بل الأربعاء الأخرى»: Monday →
 * not this Wednesday but the next one (lag 1); paid on a Wednesday → the next
 * Wednesday. null for a date that is not one.
 */
export function expectedSettlement(paidOn: string, rule: SettlementRule = DEFAULT_SETTLEMENT): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return null;
  const d = new Date(`${paidOn}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const ahead = (rule.weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + ahead + 7 * rule.lagWeeks);
  return d.toISOString().slice(0, 10);
}

/** The seller's reminder on that day (the owner's words): «يفترض وصول مبلغ <client> من تابي — راجع المالية». */
export function settlementReminder(client: string, method: string): string {
  const via = isPayMethod(method) ? PAY_METHOD_AR[method] : "تابي/تمارا";
  return `يفترض وصول مبلغ ${client.trim() || "العميل"} من ${via} — راجع المالية`;
}
