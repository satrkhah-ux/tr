/**
 * Arabic labels + formatters for the offer document. The document is a fixed
 * Arabic-RTL client artifact (like offer-image.tsx), so its wording is not routed
 * through the app's language toggle — it is always Arabic.
 */
import type { BoardType, ClimateLevel, FlightLegOrder } from "@/lib/types";

/** The company block printed on the cover. */
export const COMPANY = {
  nameAr: "ترافليون للسفر والسياحة",
  address: "المدينة المنورة - حي الاسكان - شارع عبدالسلام ابن حفص",
  phone: "0569222111",
  whatsapp: "0569222111",
  website: "https://www.traveliun.com.sa",
  email: "info@traveliun.com",
} as const;

export const AR = {
  brand: "ترافليون للسفر والسياحة",
  brandLatin: "Traveliun",
  contact: "المدينة المنورة · اتصال وواتساب 0569222111",
  // ---- cover ----
  coverLabel: "تفاصيل البرنامج السياحي",
  // «عرض جورجيا» — the owner's form (2026-10-13): no «رحلة»
  offerTitleFor: (destination: string) => `عرض ${destination}`,
  callLabel: "إتصال",
  whatsappLabel: "واتساب",
  webLabel: "الويب",
  emailLabel: "البريد الإلكتروني",
  customerInfo: "معلومات العميل",
  offerInfo: "معلومات العرض",
  offerDate: "تاريخ العرض",
  contactField: "التواصل",
  quickSummary: "ملخص سريع",
  tripLength: "مدة السفر",
  programStart: "بداية البرنامج",
  programEnd: "نهاية البرنامج",
  employeeFooter: (name: string) => `الموظف المختص: ${name}`,
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
  daysNights: (d: number, n: number) => `${n} ليالي - ${d} أيام`,
  tripSummary: "مسار الرحلة",
  nights: "ليالٍ",
  nightsCount: (n: number) => (n === 1 ? "ليلة واحدة" : n === 2 ? "ليلتان" : n <= 10 ? `${n} ليالٍ` : `${n} ليلة`),
  flights: "الطيران",
  flightsIntl: "الطيران الدولي",
  flightPlanned: "حجز مبدئي — تُثبَّت الرحلة عند إصدار التذاكر",
  flightsDomestic: "الطيران الداخلي",
  flightsAndVisas: "الطيران والتأشيرات",
  flightLeg: "الاتجاه",
  airline: "شركة الطيران",
  flightNo: "رقم الرحلة",
  route: "المسار",
  flightDate: "التاريخ",
  flightTime: "الإقلاع / الوصول",
  cabin: "الدرجة",
  baggage: "الأمتعة",
  flightPriceNote:
    "أسعار الطيران تقديرية وقابلة للتغيّر حتى إصدار التذكرة، وتُثبَّت لحظة الحجز حسب توفّر المقاعد.",
  flightsIntlNote: "يعرض هذا القسم فقط عند وجود بيانات طيران في النظام.",
  domesticFlightAfterStay: "يوجد طيران داخلي إلى المدينة التالية - التفاصيل في صفحة الطيران الداخلي.",
  accommodation: "الإقامة والفنادق",
  /** two hotels on the same dates in one city (ق5). */
  splitStay: (n: number) => (n === 2 ? "إقامة موزّعة على فندقين" : `إقامة موزّعة على ${n} فنادق`),
  accommodationNote: "يتم تمديد القسم تلقائياً عند تجاوز خمسة فنادق أو مدن.",
  accommodationNoIntlNote: "لا يحتوي هذا العرض على طيران دولي، لذلك تبدأ الصفحة الثانية بالإقامة والفنادق.",
  roomsCount: "عدد الغرف",
  room: (n: number) => `الغرفة ${n}`,
  hotel: "الفندق",
  roomType: "نوع الغرفة",
  board: "نظام الإقامة",
  rooms: "عدد الغرف",
  checkIn: "الدخول",
  checkOut: "الخروج",
  cancellation: "سياسة الإلغاء",
  payAtHotel: "يُدفع في الفندق مباشرة",
  facilities: "أمور ترفيهية ومرافق",
  transport: "التنقلات",
  tours: "التنقلات والجولات والطقس",
  toursWeatherYes: "تظهر بيانات الطقس حسب المدينة والتاريخ.",
  toursWeatherNo: "بيانات الطقس غير مرفقة في هذا العرض.",
  colDate: "التاريخ",
  colService: "الخدمة",
  colCount: "العدد",
  colDetails: "التفاصيل",
  colItem: "البند",
  colNotes: "ملاحظات",
  services: "الخدمات",
  servicesAndPrice: "الخدمات ونطاق البرنامج والتكلفة",
  /** The quick-summary panel moved to the cover, so the note no longer promises it. */
  servicesAndPriceNote: "ما يشمله البرنامج وما لا يشمله، مع الإجمالي.",
  /** the same section when the file is issued with no price on it. */
  servicesOnly: "الخدمات ونطاق البرنامج",
  includes: "يشمل العرض",
  excludes: "لا يشمل العرض",
  includesCard: "البرنامج يشمل",
  excludesCard: "البرنامج لا يشمل",
  visas: "التأشيرات",
  visaCount: "العدد",
  price: "سعر البكج",
  total: "الإجمالي",
  perPerson: "للفرد الواحد تقريبًا",
  paymentTerms:
    "طرق الدفع: يُدفع 50% مقدمًا لتأكيد الحجز والباقي قبل السفر بأسبوع. الأسعار قابلة للتغيير حتى تأكيد الحجز وبحسب توفر الفنادق والطيران وقت التثبيت.",
  terms: "الشروط والأحكام",
  termsContract: "عقد إتفاقية بيع (الشروط والأحكام)",
  climate: "الطقس والملابس المناسبة",
  climateHigh: "العظمى",
  climateLow: "الصغرى",
  rain: "الأمطار",
  humidity: "الرطوبة",
  itinerary: "البرنامج اليومي",
  weather: "الطقس",
  weatherNote:
    "بيانات الطقس مرجعية: «توقّع» للأيام القريبة، و«معدّل مناخي» لمتوسط الأعوام السابقة في التاريخ نفسه — وقد تختلف عن الحالة الفعلية يوم السفر.",
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
  transport: "تنقلات",
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

/** «الثلاثاء 10 نوفمبر 2026» — the day as a traveller says it; Latin digits like the rest of the page. */
const DAY_MONTH = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** «11 نوفمبر 2026» — the short form, for a narrow box. */
const DAY_MONTH_SHORT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export function fmtShortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : DAY_MONTH_SHORT.format(date);
}

export function fmtDayMonth(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : DAY_MONTH.format(date);
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
