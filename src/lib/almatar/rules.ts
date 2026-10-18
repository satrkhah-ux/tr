/**
 * «المطار» — the price list's rules, pure (no database, no server-only): the
 * booking form, the server actions and the tests read the same answers.
 *
 * Source: لائحة أسعار المواصلات — تطبيق المطار (2026-10-15, valid through 2027-12),
 * imported by migration 0100. Prices are what Almatar pays us, SAR, net, with
 * our profit inside (the owner, 2026-10-18).
 */
import { fromZonedTime } from "date-fns-tz";

export const VEHICLES = [
  { id: "small", label: "سيارة صغيرة" },
  { id: "medium", label: "سيارة متوسطة" },
  { id: "van10", label: "فان 10 مقاعد" },
] as const;
export type Vehicle = (typeof VEHICLES)[number]["id"];
export const vehicleLabel = (v: string) => VEHICLES.find((x) => x.id === v)?.label ?? v;

export const KIND_LABEL: Record<string, string> = {
  arrival: "استقبال",
  departure: "توديع",
  tour_city: "جولة داخل المدينة",
  tour_out: "جولة خارج المدينة",
  intercity: "نقلة برية",
  hotel_transfer: "نقل بين فندقين",
};

/** A request's line, by what it is — each filters the list to its own kinds. */
export const LINE_KINDS = {
  arrival: { label: "استقبال", kinds: ["arrival"] },
  departure: { label: "توديع", kinds: ["departure"] },
  tour: { label: "جولة", kinds: ["tour_city", "tour_out"] },
  transfer: { label: "تنقّل", kinds: ["intercity", "hotel_transfer"] },
} as const;
export type LineKind = keyof typeof LINE_KINDS;

/** What Almatar books (0101): one request, its lines laid out from the kind, more added by hand. */
export const REQUEST_KINDS: { id: string; label: string; lines: LineKind[] }[] = [
  { id: "arrival", label: "استقبال", lines: ["arrival"] },
  { id: "departure", label: "توديع", lines: ["departure"] },
  { id: "both", label: "استقبال وتوديع", lines: ["arrival", "departure"] },
  { id: "tours", label: "جولات", lines: ["tour"] },
  { id: "transfers", label: "تنقلات", lines: ["transfer"] },
  { id: "program", label: "برنامج من – إلى", lines: ["arrival", "tour", "departure"] },
];
export const MAX_LINES = 20;

/**
 * A request's booking number (the owner, 2026-10-18): ALMATAR + the day in
 * Riyadh (yymmdd) + four letters, e.g. ALMATAR261018FGRE. `bytes` are random
 * (4 of them) — passed in so the shape is testable.
 */
export function requestRefFor(now: Date, bytes: ArrayLike<number>): string {
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }).replace(/-/g, "").slice(2);
  const letters = Array.from({ length: 4 }, (_, i) => String.fromCharCode(65 + (bytes[i] % 26))).join("");
  return `ALMATAR${day}${letters}`;
}
export const REQUEST_REF = /^ALMATAR\d{6}[A-Z]{4}$/;

/** A program's lines fall between its first and last day. */
export function outsideProgram(from: string, to: string, date: string): boolean {
  return Boolean(from && to && date && (date < from || date > to));
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار تأكيد ترافليون",
  confirmed: "مؤكد",
  rejected: "مرفوض",
  cancelled: "ملغى",
};

/** The list's twelve terms, as sent. */
export const TERMS = [
  "الأسعار شاملة الضرائب الحكومية ورسوم الخدمة المحلية في كل وجهة.",
  "الأسعار المذكورة بالريال السعودي.",
  "الأسعار صافية (Net) وغير خاضعة للعمولات أو الرسوم الإضافية.",
  "جميع الخدمات تعمل بنظام الحجز المسبق، مع تأكيد الحجز قبل 24 ساعة على الأقل.",
  "الأسعار غير قابلة للنشر على المنصات العامة أو الرقمية باسم ترافليون، وتعتمد فقط عبر قنوات الاتصال الرسمية المباشرة بين ترافليون وتطبيق المطار.",
  "التعديلات أو الإلغاءات خلال أقل من 12 ساعة من وقت الخدمة تخضع لرسوم إلغاء بنسبة 100%.",
  "جميع المركبات مؤمنة ومرخصة حسب اشتراطات الجهات التنظيمية في كل دولة.",
  "خدمة الاستقبال والتوديع تشمل الانتظار المجاني لمدة 60 دقيقة من وقت الوصول، بعدها تُحتسب رسوم إضافية حسب الوجهة.",
  "ترافليون أو مزود الخدمة المحلي غير مسؤول عن التأخيرات الناتجة عن ظروف خارجة عن الإرادة مثل الطقس أو الازدحام أو إغلاق الطرق.",
  "الأسعار لا تشمل رسوم التصاريح أو رسوم المواقف الإضافية أو البوابات السياحية.",
  "يحق لترافليون تعديل الأسعار أو الشروط في أي وقت بإشعار خطي مسبق قبل 24 ساعة.",
  "الأسعار غير صالحة للحجوزات الجماعية (8 وحدات أو أكثر) إلا باتفاق منفصل.",
];

export const MIN_LEAD_HOURS = 24;
export const FULL_FEE_HOURS = 12;
/** term 12: eight vehicles or more is a group booking. */
export const MAX_UNITS = 7;

export type ServicePrices = { price_small: number; price_medium: number; price_van10: number; tz: string; valid_through: string };

export function unitPrice(s: ServicePrices, v: Vehicle): number {
  return Number(v === "small" ? s.price_small : v === "medium" ? s.price_medium : s.price_van10);
}

/** The local wall-clock time at the destination as an instant. */
export function serviceInstant(date: string, time: string, tz: string): Date {
  return fromZonedTime(`${date}T${time.slice(0, 5)}:00`, tz);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Our profit inside a price Almatar pays, at our margin. */
export const profitOf = (total: number, marginPct: number) => round2((total * marginPct) / 100);

export type BookingInput = {
  vehicle: string;
  units: number;
  date: string;
  time: string;
  passengers: number;
  lead_name: string;
};

/** Why a booking cannot be taken, or null. `now` is passed in so tests are fixed. */
export function bookingProblem(s: ServicePrices, input: BookingInput, now: Date): string | null {
  if (!VEHICLES.some((v) => v.id === input.vehicle)) return "اختر فئة المركبة.";
  if (!Number.isInteger(input.units) || input.units < 1) return "عدد المركبات غير صحيح.";
  if (input.units > MAX_UNITS) return "الحجز الجماعي (8 وحدات أو أكثر) غير متاح إلا باتفاق منفصل — تواصل مع ترافليون.";
  if (!Number.isInteger(input.passengers) || input.passengers < 1) return "عدد الركاب غير صحيح.";
  if (input.vehicle === "van10" && input.passengers > input.units * 10) return "الركاب أكثر من مقاعد الفانات المختارة.";
  if (!input.lead_name.trim()) return "اكتب اسم المسافر الرئيسي.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}/.test(input.time)) return "حدد تاريخ الخدمة ووقتها.";
  if (input.date > s.valid_through) return "الأسعار سارية حتى ديسمبر 2027 — التاريخ بعدها غير متاح.";
  const at = serviceInstant(input.date, input.time, s.tz);
  if (Number.isNaN(at.getTime())) return "حدد تاريخ الخدمة ووقتها.";
  if (at.getTime() - now.getTime() < MIN_LEAD_HOURS * 3_600_000) return "الحجز قبل 24 ساعة على الأقل من وقت الخدمة (بتوقيت الوجهة).";
  return null;
}

/** term 6: the cancellation fee, in percent, for a cancellation made `now`. */
export function cancelFeePct(serviceAt: Date, now: Date): 0 | 100 {
  return serviceAt.getTime() - now.getTime() < FULL_FEE_HOURS * 3_600_000 ? 100 : 0;
}

/**
 * A login typed as a bare name («almatar») is that name at our partners
 * domain — Supabase Auth signs in by email. An address is used as typed.
 */
export const LOGIN_DOMAIN = "partners.traveliun.com";
export function loginEmail(typed: string): string {
  const t = typed.trim().toLowerCase();
  return t.includes("@") ? t : `${t}@${LOGIN_DOMAIN}`;
}

/** A password an employee types for a new login — one rule for every temporary password. */
export { passwordProblem } from "@/lib/auth/password-rule";
