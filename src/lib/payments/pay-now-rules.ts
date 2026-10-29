import type { PayMethod } from "./methods";

/**
 * «ادفع الآن» (the owner, 2026-10-29) — what the public page /pay/<serial> charges, and when it says no.
 * Pure, so the money decisions are tested apart from the database and the gateway (pay-now.ts).
 */

/** The gateway /pay/<serial> sends the client to: MyFatoorah, or Tamara (`?m=tamara`). */
export type PayVia = "myfatoorah" | "tamara";

/** The ways that are a MyFatoorah payment: the button shows on the client's PDF and page for these only. */
export const PAY_NOW_METHODS: readonly PayMethod[] = ["link", "card"];
export const showsPayNow = (method: PayMethod | null | undefined): boolean => Boolean(method && PAY_NOW_METHODS.includes(method));

/**
 * The client's button, from the ONE way the offer was issued with: MyFatoorah for link/card, Tamara for tamara,
 * none for the rest (Tabby has no integration; cash/transfer/POS are paid at the office).
 */
export const payButtonFor = (method: PayMethod | null | undefined): PayVia | null => (showsPayNow(method) ? "myfatoorah" : method === "tamara" ? "tamara" : null);

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

export type PayRefusal = "missing" | "partner" | "cancelled" | "expired" | "paid" | "currency" | "badAmount" | "method" | "noPhone";

export const REFUSAL_AR: Record<PayRefusal, string> = {
  missing: "هذا الرابط غير صحيح أو أن العرض لم يُصدر بعد.",
  partner: "السداد لهذا الملف يتم عبر الجهة التي حجزت لك. تواصل معها مباشرة.",
  cancelled: "هذا الملف ملغى، فلا يمكن السداد عليه.",
  expired: "انتهت صلاحية هذا العرض. تواصل مع موظف المبيعات ليرسل لك نسخة محدّثة.",
  paid: "تم سداد هذا الملف بالكامل. شكراً لك.",
  currency: "هذا العرض بغير الريال. تواصل مع موظف المبيعات لإتمام السداد.",
  badAmount: "رابط السداد هذا غير صالح أو انتهت مدته. اطلب من موظف المبيعات رابطاً جديداً.",
  method: "طريقة السداد المختارة لهذا العرض مختلفة. تواصل مع موظف المبيعات.",
  noPhone: "لا يوجد رقم جوال على هذا الملف. تواصل مع موظف المبيعات لإتمام السداد.",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The amount to charge: the signed custom amount when the link carries one (it may not exceed what is still
 * owed), else what is still owed on the current total. `signed` undefined = no token on the link; null = a
 * token that did not verify (edited, another file's, out of date).
 */
export function payDecision(
  file: PayFile | null,
  signed: number | null | undefined,
  today: string,
  via: PayVia = "myfatoorah",
): { ok: true; amount: number } | { ok: false; why: PayRefusal } {
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
  if (payButtonFor(file.method) !== via) return { ok: false, why: "method" };
  if (file.status !== "confirmed" && file.validUntil && file.validUntil < today) return { ok: false, why: "expired" };
  return { ok: true, amount: owed };
}

export type OpenLink = { invoice_id: string; url: string; amount: number; mock: boolean; created_at: string };

/**
 * A link is reused while young and for the very same amount; anything else gets a fresh one. A MyFatoorah invoice
 * keeps a day; a Tamara checkout session lives far shorter, so one is reused within half an hour only.
 */
export const REUSE_MS = 24 * 3_600_000;
export const TAMARA_REUSE_MS = 30 * 60_000;
export function reusableLink(links: OpenLink[], amount: number, mock: boolean, now = Date.now(), maxAge = REUSE_MS): OpenLink | null {
  return (
    links
      .filter((l) => l.mock === mock && Math.abs(l.amount - amount) < 0.005 && now - Date.parse(l.created_at) < maxAge)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
  );
}

/** Tamara's instalment limits for SA/SAR (GET /checkout/payment-types), read tolerantly: the widest min…max on offer. */
export type TamaraLimits = { min: number; max: number };
export function parseTamaraLimits(json: unknown): TamaraLimits | null {
  const list = Array.isArray(json) ? json : [];
  const pairs = list
    .map((t) => t as { min_limit?: { amount?: unknown }; max_limit?: { amount?: unknown } })
    .map((t) => [Number(t.min_limit?.amount), Number(t.max_limit?.amount)] as const)
    .filter(([min, max]) => Number.isFinite(min) && Number.isFinite(max) && max > 0);
  return pairs.length ? { min: Math.min(...pairs.map((p) => p[0])), max: Math.max(...pairs.map((p) => p[1])) } : null;
}
export const withinTamara = (amount: number, limits: TamaraLimits | null): boolean => !limits || (amount >= limits.min && amount <= limits.max);
