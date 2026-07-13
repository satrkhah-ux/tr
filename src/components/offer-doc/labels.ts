/**
 * Arabic labels + formatters for the offer document. The document is a fixed
 * Arabic-RTL client artifact (like offer-image.tsx), so its wording is not routed
 * through the app's language toggle — it is always Arabic.
 */
import type { BoardType, ClimateLevel, FlightLegOrder } from "@/lib/types";

export const AR = {
  brand: "ترافليون للسفر والسياحة",
  brandLatin: "Traveliun",
  contact: "المدينة المنورة · اتصال وواتساب 0569222111",
  serial: "رقم العرض",
  issueDate: "تاريخ الإصدار",
  validityDate: "صالح حتى",
  destination: "وجهة الرحلة",
  customer: "اسم العميل",
  phone: "الجوال",
  travelers: "المسافرون",
  arrival: "الوصول",
  departure: "المغادرة",
  duration: "المدة",
  employee: "موظف المبيعات",
  adults: "بالغ",
  children: "طفل",
  infants: "رضيع",
  daysNights: (d: number, n: number) => `${d} أيام / ${n} ليالٍ`,
  tripSummary: "مسار الرحلة",
  nights: "ليالٍ",
  flights: "الطيران",
  flightLeg: "الاتجاه",
  airline: "شركة الطيران",
  flightNo: "رقم الرحلة",
  route: "المسار",
  flightDate: "التاريخ",
  flightTime: "الإقلاع / الوصول",
  cabin: "الدرجة",
  baggage: "الأمتعة",
  accommodation: "الإقامة والفنادق",
  hotel: "الفندق",
  roomType: "نوع الغرفة",
  board: "نظام الإقامة",
  rooms: "عدد الغرف",
  checkIn: "الدخول",
  checkOut: "الخروج",
  cancellation: "سياسة الإلغاء",
  payAtHotel: "يُدفع في الفندق مباشرة",
  facilities: "أمور ترفيهية ومرافق",
  transport: "المواصلات والتنقلات",
  services: "الخدمات",
  includes: "يشمل العرض",
  excludes: "لا يشمل العرض",
  visas: "التأشيرات",
  visaCount: "العدد",
  price: "سعر البكج",
  perPerson: "للفرد الواحد تقريبًا",
  paymentTerms:
    "طرق الدفع: يُدفع 50% مقدمًا لتأكيد الحجز والباقي قبل السفر بأسبوع. الأسعار قابلة للتغيير حتى تأكيد الحجز وبحسب توفر الفنادق والطيران وقت التثبيت.",
  terms: "الشروط والأحكام",
  climate: "الطقس والملابس المناسبة",
  climateHigh: "العظمى",
  climateLow: "الصغرى",
  rain: "الأمطار",
  humidity: "الرطوبة",
  // internal-only
  internalTitle: "التسعير الداخلي (خاص بالموظفين)",
  internalNote: "🔒 هذه الصفحة داخلية — أسعار الشراء والربح لا تظهر في نسخة العميل إطلاقًا.",
  item: "البند",
  buy: "الشراء",
  sell: "البيع",
  profit: "الربح",
  totalBuy: "إجمالي الشراء",
  totalSell: "إجمالي البيع",
  totalProfit: "إجمالي الربح",
  margin: "الهامش",
} as const;

/** Facility code → Arabic label ("أمور ترفيهية"). Unknown codes fall back to the code. */
export const FACILITY_AR: Record<string, string> = {
  pool: "مسبح",
  spa: "سبا",
  gym: "نادٍ رياضي",
  kids_club: "نادي أطفال",
  beach: "شاطئ",
  wifi: "واي-فاي",
  parking: "موقف سيارات",
  restaurant: "مطعم",
};

export const BOARD_AR: Record<BoardType, string> = {
  RO: "غرفة فقط",
  BB: "شامل الإفطار",
  HB: "نصف إقامة",
  FB: "إقامة كاملة",
  AI: "شامل كليًا",
};

export const LEG_AR: Record<FlightLegOrder, string> = {
  outbound: "ذهاب",
  inbound: "عودة",
  internal: "داخلي",
};

export const CLIMATE_LEVEL_AR: Record<ClimateLevel, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "مرتفعة",
};

export const ITEM_TYPE_AR: Record<string, string> = {
  hotel: "فندق",
  flight: "طيران",
  visa: "تأشيرة",
  service: "خدمة",
  transport: "مواصلات",
  other: "أخرى",
};

export function fmtNum(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

export function stars(count: number | null): string {
  if (!count || count < 1) return "";
  return "★".repeat(Math.min(Math.round(count), 5));
}

/** "2026-06-01T14:30" or "2026-06-01" → "2026-06-01 14:30" (LTR-isolated by caller). */
export function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

export function fmtDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}
