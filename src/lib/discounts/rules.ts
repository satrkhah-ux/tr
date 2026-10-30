/**
 * «قسم الخصومات» — the pure half: the discount's words, a coupon's state, the code a client reads out.
 * Pure — the pages, the actions and the tests read it.
 */

export type DiscountKind = "amount" | "percent";
export type Audience = "all" | "older" | "booked" | "never_booked";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  all: "كل العملاء في النظام",
  older: "من مضى على أول تواصله أكثر من (أيام)",
  booked: "من حجز معنا سابقاً",
  never_booked: "من تواصل ولم يحجز",
};

/** «300 ريال» / «10%» */
export function discountLabel(kind: DiscountKind, value: number): string {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return kind === "percent" ? `${n}%` : `${n} ريال`;
}

/** The scope in the client's words. */
export function scopeLabel(appliesTo: string): string {
  return appliesTo === "package" ? "على أي طلب باقة سياحية" : "على أي طلب";
}

export type CouponState = "valid" | "used" | "expired";

export function couponState(c: { redeemed_at: string | null; expires_at: string }, now = new Date()): CouponState {
  if (c.redeemed_at) return "used";
  return new Date(c.expires_at).getTime() <= now.getTime() ? "expired" : "valid";
}

// no 0/O, 1/I/L: read out over the phone without a mistake
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** «TRV-7K3M9Q» from random bytes — 31^6 ≈ 887 million, and the database keeps it unique. */
export function couponCode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `TRV-${s}`;
}

/** A scanned QR or a typed code → what to look up: the page's token, or the code. */
export function readScan(raw: string): { token: string } | { code: string } | null {
  const text = raw.trim();
  const url = text.match(/\/coupon\/([A-Za-z0-9_-]{20,64})/);
  if (url) return { token: url[1] };
  const code = text.toUpperCase().replace(/\s+/g, "");
  if (/^TRV-?[2-9A-HJKMNP-Z]{6}$/.test(code)) return { code: code.includes("-") ? code : `TRV-${code.slice(3)}` };
  return null;
}

/** The same mobile however it was typed: its last nine digits. */
export const lastNine = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-9);

/** «05•••••123» on the public page: the link gets forwarded. */
export function maskPhone(phone: string): string {
  const all = phone.replace(/\D/g, "");
  const d = all.length >= 9 && all.slice(-9).startsWith("5") ? `0${all.slice(-9)}` : all;
  return d.length < 6 ? "•••" : `${d.slice(0, 2)}${"•".repeat(Math.max(3, d.length - 5))}${d.slice(-3)}`;
}

/** «الخميس 30 نوفمبر 2026» */
export function arabicDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });
}

// a WhatsApp display name is often a phrase, a shop or a dot — never print those as «باسم …»
const NOT_A_NAME = /الله|سبحان|الحمد|استغفر|اللهم|ماشاء|حساب|مكتب|شركة|مؤسسة|متجر|عميل|تجرب|شخص|sales|shop|store|company|test|official|travel|سياح|سفر/i;

/** The client's name as the coupon prints it, or null («عميلنا العزيز»): letters only, two at least, and a person's. */
export function cleanName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  if ((name.match(/\p{L}/gu) ?? []).length < 3 || NOT_A_NAME.test(name)) return null;
  return name.split(" ").slice(0, 3).join(" ").slice(0, 40);
}
