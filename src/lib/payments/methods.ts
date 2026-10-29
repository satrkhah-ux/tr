/**
 * «وسائل الدفع ورسومها» — the ONE place that says how a client may pay and
 * what each way adds to the price (the owner, 2026-10-29). Pure: the price
 * calculator, the operations payment step, the offer's price update (session
 * F) and the payment-methods line of the PDF (session G) all read it, so a
 * fee changed by the administration moves every screen at once.
 *
 * The percentages are the administration's (app_settings «payment_fees»,
 * lib/data/app-settings.ts getPaymentFees) — never hard-coded where they are
 * read. Visa and a MyFatoorah invoice link start at 2.5% (the owner's figure);
 * Tabby and Tamara start UNSET until the owner's calculation file arrives, and
 * an unset method says so instead of quoting a price.
 */

export type PayMethod = "tabby" | "tamara" | "pos" | "card" | "link" | "cash" | "transfer";

/** The order a client is offered them in (the owner's list: تابي، تمارا، شبكة، فيزا، كاش، تحويل + ماي فاتورة). */
export const PAY_METHODS: readonly PayMethod[] = ["tabby", "tamara", "pos", "card", "link", "cash", "transfer"];

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

/** A method's charge: a share of the price plus a fixed amount in SAR. null = the administration has not set it. */
export type MethodFee = { pct: number; fixed: number } | null;
export type PaymentFees = Record<PayMethod, MethodFee>;

export const DEFAULT_FEES: PaymentFees = {
  tabby: null,
  tamara: null,
  pos: { pct: 0, fixed: 0 },
  card: { pct: 2.5, fixed: 0 },
  link: { pct: 2.5, fixed: 0 },
  cash: { pct: 0, fixed: 0 },
  transfer: { pct: 0, fixed: 0 },
};

export const isPayMethod = (v: unknown): v is PayMethod => typeof v === "string" && (PAY_METHODS as readonly string[]).includes(v);

/** A sane fee or null: a share 0–30%, a fixed 0–1000 SAR. Anything else is not trusted. */
function cleanFee(v: unknown): MethodFee {
  if (!v || typeof v !== "object") return null;
  const pct = Number((v as { pct?: unknown }).pct);
  const fixed = Number((v as { fixed?: unknown }).fixed ?? 0);
  if (!Number.isFinite(pct) || pct < 0 || pct > 30) return null;
  if (!Number.isFinite(fixed) || fixed < 0 || fixed > 1000) return null;
  return { pct: Math.round(pct * 100) / 100, fixed: Math.round(fixed * 100) / 100 };
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
 * the fixed charge ADDED to the price, rounded UP to the whole riyal — a price
 * is quoted to the client in riyals and the agency never absorbs the halalas.
 * ponytail: added, not grossed up (base / (1 − p)) — the owner's «يُحسب عليه 2.5%»
 * read literally; switch here if his calculation file says otherwise.
 */
export function quoteMethod(base: number, method: PayMethod, fees: PaymentFees): MethodQuote {
  const fee = fees[method];
  if (!fee) return { method, unset: true };
  if (!Number.isFinite(base) || base <= 0) return { method, unset: false, fee: 0, total: 0 };
  const total = Math.ceil(base * (1 + fee.pct / 100) + fee.fixed - 1e-9);
  return { method, unset: false, fee: total - Math.ceil(base - 1e-9), total };
}

/** Every method, in the order a client is offered them. */
export function quoteAll(base: number, fees: PaymentFees): MethodQuote[] {
  return PAY_METHODS.map((m) => quoteMethod(base, m, fees));
}

/**
 * The money methods a recorded payment may carry (operation_payments.method,
 * migration 20261029140000) — every PayMethod: a payment that came through
 * Tabby is recorded as Tabby, so the report can tell the fee it cost.
 */
export type RecordedMethod = PayMethod;
