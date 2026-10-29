import type { PayMethod } from "./methods";

/**
 * «ادفع الآن» (the owner, 2026-10-29) — what the public page /pay/<serial> charges, and when it says no.
 * Pure, so the money decisions are tested apart from the database and the gateway (pay-now.ts).
 */

/** The ways that are a MyFatoorah payment: the button shows on the client's PDF and page for these only. */
export const PAY_NOW_METHODS: readonly PayMethod[] = ["link", "card"];
export const showsPayNow = (method: PayMethod | null | undefined): boolean => Boolean(method && PAY_NOW_METHODS.includes(method));

export type PayFile = {
  status: string | null;
  partner: boolean;
  /** the last day the offer's prices hold (offers.valid_until) */
  validUntil: string | null;
  /** the LATEST published client version's total — never a stale amount — or the case's agreed price (caseTotal) */
  total: number | null;
  currency: string;
  method: PayMethod | null;
  /** what the client paid already: the case's payments less refunds, plus links paid before the case */
  paid: number;
};

export type PayRefusal = "missing" | "partner" | "cancelled" | "expired" | "paid" | "currency" | "badAmount" | "method";

export const REFUSAL_AR: Record<PayRefusal, string> = {
  missing: "هذا الرابط غير صحيح أو أن العرض لم يُصدر بعد.",
  partner: "السداد لهذا الملف يتم عبر الجهة التي حجزت لك. تواصل معها مباشرة.",
  cancelled: "هذا الملف ملغى، فلا يمكن السداد عليه.",
  expired: "انتهت صلاحية هذا العرض. تواصل مع موظف المبيعات ليرسل لك نسخة محدّثة.",
  paid: "تم سداد هذا الملف بالكامل. شكراً لك.",
  currency: "هذا العرض بغير الريال. تواصل مع موظف المبيعات لإتمام السداد.",
  badAmount: "رابط السداد هذا غير صالح أو انتهت مدته. اطلب من موظف المبيعات رابطاً جديداً.",
  method: "طريقة السداد لهذا العرض ليست بالبطاقة. تواصل مع موظف المبيعات.",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The amount to charge: the signed custom amount when the link carries one (it may not exceed what is still
 * owed), else what is still owed on the current total. `signed` undefined = no token on the link; null = a
 * token that did not verify (edited, another file's, out of date).
 */
export function payDecision(file: PayFile | null, signed: number | null | undefined, today: string): { ok: true; amount: number } | { ok: false; why: PayRefusal } {
  if (!file || file.total == null || !(file.total > 0)) return { ok: false, why: "missing" };
  if (file.partner) return { ok: false, why: "partner" };
  if (file.status === "cancelled") return { ok: false, why: "cancelled" };
  // the MyFatoorah account charges riyals; a quote in another currency is settled with the seller
  if (file.currency !== "SAR") return { ok: false, why: "currency" };
  const owed = round2(file.total - file.paid);
  if (owed <= 0) return { ok: false, why: "paid" };
  if (signed === null) return { ok: false, why: "badAmount" };
  if (signed !== undefined) return signed > 0 && signed <= owed + 0.005 ? { ok: true, amount: round2(signed) } : { ok: false, why: "badAmount" };
  // the bare link is the PDF's button: the client's own way, and prices that still hold (a confirmed file's price is fixed)
  if (!showsPayNow(file.method)) return { ok: false, why: "method" };
  if (file.status !== "confirmed" && file.validUntil && file.validUntil < today) return { ok: false, why: "expired" };
  return { ok: true, amount: owed };
}

export type OpenLink = { invoice_id: string; url: string; amount: number; mock: boolean; created_at: string };

/** A MyFatoorah invoice is reused while young and for the very same amount; anything else gets a fresh one. */
export const REUSE_MS = 24 * 3_600_000;
export function reusableLink(links: OpenLink[], amount: number, mock: boolean, now = Date.now()): OpenLink | null {
  return (
    links
      .filter((l) => l.mock === mock && Math.abs(l.amount - amount) < 0.005 && now - Date.parse(l.created_at) < REUSE_MS)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
  );
}
