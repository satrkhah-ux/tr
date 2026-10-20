import { normalizeDigits, parseCsv } from "@/lib/ready-offers/parse";

/**
 * The company's conversations sheet («جمع البيانات»), one row per WhatsApp
 * conversation. Columns are found by their header, not their position — the
 * sheet is edited by hand and a column may move — and a header is compared
 * without its spaces, hamzas or tā' marbūṭa («الدوله» = «الدولة»).
 */
export const HEADERS = {
  phone: "رقم الهاتف",
  inquiry: "استفسار العميل",
  destination: "الدولة",
  received_by: "الموظف المستلم",
  delay: "تأخير المحادثة",
  sent_status: "هل تم إرسال طلب العميل",
  assigned_to: "إسناد المحادثة إلى شخص آخر",
  done_text: "ما تم إنهاؤه مع العميل",
  status: "حالة المحادثة",
  next_action: "الإجراء البعدي",
  contact_owner: "مسؤول التواصل",
  result: "النتيجة",
} as const;

export type SheetField = keyof typeof HEADERS;
export type SheetLead = Record<SheetField, string> & { key: string };

/** the daily classification, in the sheet's own colours («اجماليات المحادثات») */
export const INQUIRIES = [
  { label: "غير مصنف", color: "#e7eeec", ink: "#3b6058" },
  { label: "بكج", color: "#ffff00", ink: "#4a4300" },
  { label: "تأشيرات", color: "#6d9eeb", ink: "#0b2f6b" },
  { label: "طيران", color: "#ff00ff", ink: "#4d004d" },
  { label: "يستفسر", color: "#cc0000", ink: "#ffffff" },
  { label: "مواصلات", color: "#00ffff", ink: "#004d4d" },
  { label: "فنادق", color: "#f6b26b", ink: "#5a3000" },
  { label: "طلب غير واضح", color: "#a64d79", ink: "#ffffff" },
  { label: "طلب", color: "#00ff00", ink: "#0a4a00" },
] as const;

/** one spelling for comparing Arabic: no spaces, hamzas or tā' marbūṭa, no tatweel */
export function fold(s: string): string {
  return s.replace(/\s+/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ـ/g, "");
}

const INQUIRY_ALIASES: Record<string, string> = {
  [fold("باكدج")]: "بكج",
  [fold("بكدج")]: "بكج",
  [fold("باكج")]: "بكج",
  [fold("بكج")]: "بكج",
  [fold("باقة")]: "بكج",
  [fold("تاشيرة")]: "تأشيرات",
  [fold("فيزا")]: "تأشيرات",
  [fold("فندق")]: "فنادق",
  [fold("استفسار")]: "يستفسر",
};

/** the sheet's wording → the classification's («باكدج» → «بكج», «تاشيرات» → «تأشيرات») */
export function normalizeInquiry(raw: string): string {
  const f = fold(raw);
  if (!f) return "";
  return INQUIRY_ALIASES[f] ?? INQUIRIES.find((i) => fold(i.label) === f)?.label ?? raw.trim();
}

/** «لم يتم الاسناد» is the sheet's «nobody» */
const NOBODY = new Set(["لم يتم الاسناد", "لا يوجد", "-"].map(fold));

/** One phone, one spelling: digits only, 05… and 5… become 9665… (Saudi), 00 dropped. */
export function normalizePhone(raw: string): string {
  let d = normalizeDigits(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = `966${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `966${d}`;
  return d;
}

/** the sheet has no row id: a conversation is who, about what, where, taken by whom — as the cells read */
export function sheetKey(cells: Pick<SheetLead, "phone" | "inquiry" | "destination" | "received_by">): string {
  return [normalizePhone(cells.phone), cells.inquiry.trim(), cells.destination.trim(), cells.received_by.trim()].join("|");
}

export function parseLeadsSheet(csv: string): SheetLead[] {
  const rows = parseCsv(csv);
  const header = (rows[0] ?? []).map(fold);
  const at = Object.fromEntries(Object.entries(HEADERS).map(([k, h]) => [k, header.indexOf(fold(h))])) as Record<SheetField, number>;
  if (at.phone < 0) return [];
  const out: SheetLead[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const cell = (f: SheetField) => (at[f] >= 0 ? (row[at[f]] ?? "").trim() : "");
    if (normalizePhone(cell("phone")).length < 7) continue;
    const lead = Object.fromEntries(Object.keys(HEADERS).map((f) => [f, cell(f as SheetField)])) as Record<SheetField, string>;
    const key = sheetKey(lead);
    // ponytail: two identical rows (same client, same question, same receiver) are one conversation
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...lead, key });
  }
  return out;
}

/** «لم يتم الاسناد» and the like → nobody */
export function sheetPerson(raw: string): string {
  return NOBODY.has(fold(raw)) ? "" : raw.trim();
}

/** «مغلق» → closed; anything else (مفتوح, empty) → open */
export function sheetStatus(raw: string): "open" | "closed" {
  return raw.includes("مغلق") ? "closed" : "open";
}

/**
 * An employee for a name the sheet wrote by hand («محمد الحبيب», «رشا»): the
 * one whose Arabic name is it, or starts with it. Ambiguous or unknown → null,
 * and the sheet's wording is kept beside it.
 */
export function matchEmployee(name: string, employees: { id: string; arabic_name: string }[]): string | null {
  // compared folded: «احمد القدسي» is «أحمد القدسي», a trailing space is nothing
  const n = fold(name);
  if (!n) return null;
  const exact = employees.filter((e) => fold(e.arabic_name) === n);
  if (exact.length === 1) return exact[0].id;
  const words = name.trim().split(/\s+/).length;
  const starts = employees.filter((e) => fold(e.arabic_name.trim().split(/\s+/).slice(0, words).join(" ")) === n);
  return starts.length === 1 ? starts[0].id : null;
}

/** the calendar day in Riyadh (YYYY-MM-DD) — the company's day, whatever the server's clock */
export function riyadhDay(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
