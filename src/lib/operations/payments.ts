/**
 * «الدفعات» in arithmetic only — what is paid, what is left, what is due when,
 * and the amount in words a receipt prints. Pure and clock-injected (`today` is
 * a parameter), so every rule here is tested without a database.
 */

import type { PaymentKind, PaymentMethod } from "@/lib/data/operations";

export const DEPOSIT_SHARE = 0.5;
export const BALANCE_DAYS_BEFORE_TRAVEL = 14;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The calendar day in Riyadh — the office's "today", whatever the server's zone. */
export function riyadhDate(at: Date | string | number = new Date()): string {
  return new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Net money in: a refund is stored positive and subtracted here, in one place. */
export function paidTotal(payments: { amount: number; kind: string }[]): number {
  return round2(payments.reduce((sum, p) => sum + (p.kind === "refund" ? -p.amount : p.amount), 0));
}

/** What the client still owes; null when the case has no total to owe against. */
export function remainingBalance(total: number | null, paid: number): number | null {
  return total == null ? null : round2(total - paid);
}

export type Installment = { due_date: string | null; amount: number };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The house terms when nobody set a schedule: half at confirmation, the rest
 * fourteen days before travel. A trip booked inside that fortnight owes the
 * rest at confirmation too, not on a date that has already gone. No travel
 * date yet → the rest has no due date, and so can never be «late».
 */
export function defaultSchedule(input: { total: number | null; confirmed_on: string; travel_start: string | null }): Installment[] {
  if (input.total == null || !(input.total > 0)) return [];
  const deposit = round2(input.total * DEPOSIT_SHARE);
  const before = input.travel_start ? addDays(input.travel_start, -BALANCE_DAYS_BEFORE_TRAVEL) : null;
  const balanceDue = before == null ? null : before > input.confirmed_on ? before : input.confirmed_on;
  return [
    { due_date: input.confirmed_on, amount: deposit },
    { due_date: balanceDue, amount: round2(input.total - deposit) },
  ].filter((row) => row.amount > 0);
}

export type InstallmentState = "paid" | "partial" | "overdue" | "due";

/**
 * Payments are applied to installments in due-date order — money is not
 * earmarked to a line, so the earliest debt is the one it settles. Due TODAY is
 * not late; due yesterday and not covered is.
 */
export function installmentStates<T extends Installment>(
  schedule: T[],
  paid: number,
  today: string,
): (T & { covered: number; state: InstallmentState })[] {
  const sorted = [...schedule].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  let left = paid;
  return sorted.map((row) => {
    const covered = round2(Math.min(Math.max(left, 0), row.amount));
    left = round2(left - row.amount);
    const state: InstallmentState =
      covered >= row.amount ? "paid" : row.due_date != null && row.due_date < today ? "overdue" : covered > 0 ? "partial" : "due";
    return { ...row, covered, state };
  });
}

// ---------------------------------------------------------------- receipt ----

export const PAYMENT_METHODS: PaymentMethod[] = ["transfer", "cash", "pos", "link"];
export const PAYMENT_KINDS: PaymentKind[] = ["deposit", "installment", "final", "refund"];

/** How the client paid, as the receipt prints it (always Arabic, like every client document). */
export const METHOD_AR: Record<PaymentMethod, string> = {
  cash: "نقداً",
  transfer: "تحويل بنكي",
  pos: "مدى",
  link: "رابط دفع",
};

export const KIND_AR: Record<PaymentKind, string> = {
  deposit: "عربون",
  installment: "قسط",
  final: "دفعة أخيرة",
  refund: "استرجاع",
};

/**
 * Everything a «سند قبض» prints. Built field by field from the payment row —
 * there is no field for the internal note, the proof path or who recorded it,
 * so they cannot reach the client by accident.
 */
export type ReceiptDTO = {
  receipt_no: string;
  serial: string;
  destination: string | null;
  customer_name: string | null;
  amount: number;
  currency: string;
  kind: Exclude<PaymentKind, "refund">;
  method: PaymentMethod | null;
  reference: string | null;
  paid_at: string;
};

// ------------------------------------------------------- amount in words ----

const ONES_M = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة"];
const ONES_F = ["", "واحدة", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع", "عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
const SCALES = [
  { one: "ألف", two: "ألفان", few: "آلاف", many: "ألفاً" },
  { one: "مليون", two: "مليونان", few: "ملايين", many: "مليوناً" },
  { one: "مليار", two: "ملياران", few: "مليارات", many: "ملياراً" },
];

/** Arabic counts agree in reverse gender: a riyal (m.) takes «ثلاثة», a halala (f.) «ثلاث». */
function below100(n: number, feminine: boolean): string {
  const ones = feminine ? ONES_F : ONES_M;
  if (n <= 10) return ones[n];
  if (n === 11) return feminine ? "إحدى عشرة" : "أحد عشر";
  if (n === 12) return feminine ? "اثنتا عشرة" : "اثنا عشر";
  if (n < 20) return `${ones[n - 10]} ${feminine ? "عشرة" : "عشر"}`;
  const unit = n % 10;
  const tens = TENS[Math.floor(n / 10)];
  if (unit === 0) return tens;
  return `${unit === 1 ? (feminine ? "إحدى" : "واحد") : ones[unit]} و${tens}`;
}

function below1000(n: number, feminine: boolean): string {
  return [HUNDREDS[Math.floor(n / 100)], below100(n % 100, feminine)].filter(Boolean).join(" و");
}

/** A dual right before its noun drops the nun: «ألفا ريال», «مائتا ألف». */
const construct = (words: string) => words.replace(/(مائت|ألف|مليون|مليار)ان$/, "$1ا");

/** The noun after a count follows its last two digits: 3–10 plural, 11–99 accusative, else singular. */
function nounFor(n: number, forms: { one: string; few: string; many: string }): string {
  const r = n % 100;
  return r >= 3 && r <= 10 ? forms.few : r >= 11 ? forms.many : forms.one;
}

function integerWords(n: number, feminine: boolean): string {
  const parts: string[] = [];
  for (let i = SCALES.length; i >= 1; i--) {
    const group = Math.floor(n / 1000 ** i) % 1000;
    if (group === 0) continue;
    const scale = SCALES[i - 1];
    parts.push(group === 1 ? scale.one : group === 2 ? scale.two : `${construct(below1000(group, false))} ${nounFor(group, scale)}`);
  }
  const units = n % 1000;
  if (units > 0) parts.push(below1000(units, feminine));
  return parts.join(" و");
}

function riyalsWords(n: number): string {
  if (n === 1) return "ريال سعودي واحد";
  if (n === 2) return "ريالان سعوديان";
  const noun = nounFor(n, { one: "ريال سعودي", few: "ريالات سعودية", many: "ريالاً سعودياً" });
  return `${construct(integerWords(n, false))} ${noun}`;
}

function halalasWords(n: number): string {
  if (n === 1) return "هللة واحدة";
  if (n === 2) return "هللتان";
  return `${below100(n, true)} ${n <= 10 ? "هللات" : "هللة"}`;
}

/**
 * «عشرة آلاف وستمائة وخمسة وثلاثون ريالاً سعودياً» — the amount a receipt
 * writes out so a figure cannot be altered after it is signed.
 */
export function amountInArabicWords(amount: number, currency = "SAR"): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  if (whole >= 1000 ** (SCALES.length + 1)) return String(amount);
  if (currency !== "SAR") {
    // ponytail: words for the number only, the code for the unit — add a currency's own nouns when one is actually billed in
    const words = whole ? integerWords(whole, false) : "صفر";
    return fraction ? `${words} ${currency} و${fraction}/100` : `${words} ${currency}`;
  }
  if (!whole && !fraction) return "صفر ريال سعودي";
  return [whole ? riyalsWords(whole) : "", fraction ? halalasWords(fraction) : ""].filter(Boolean).join(" و");
}
