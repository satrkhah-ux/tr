import { normalizeDigits, parseCsv } from "@/lib/ready-offers/parse";

/**
 * The company's conversations sheet («جمع البيانات»), one row per WhatsApp
 * conversation. Columns are found by their header, not their position — the
 * sheet is edited by hand and a column may move.
 */
const HEADERS = {
  phone: "رقم الهاتف",
  inquiry: "استفسار العميل",
  destination: "الدوله",
  received_by: "الموظف المستلم",
  sent_status: "هل تم ارسال طلب العميل",
  assigned_to: "اسناد المحادثه الى شخص اخر",
  done_text: "ماتم انهاءه مع العميل",
  status: "حاله المحادثه",
  next_action: "الاجراء البعدي",
  result: "النتيجة",
} as const;

export type SheetField = keyof typeof HEADERS;
export type SheetLead = Record<SheetField, string> & { key: string };

/** «لم يتم الاسناد» is the sheet's «nobody» */
const NOBODY = new Set(["لم يتم الاسناد", "لا يوجد", "-"]);

/** One phone, one spelling: digits only, 05… and 5… become 9665… (Saudi), 00 dropped. */
export function normalizePhone(raw: string): string {
  let d = normalizeDigits(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = `966${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `966${d}`;
  return d;
}

export function parseLeadsSheet(csv: string): SheetLead[] {
  const rows = parseCsv(csv);
  const header = (rows[0] ?? []).map((h) => h.trim());
  const at = Object.fromEntries(Object.entries(HEADERS).map(([k, h]) => [k, header.indexOf(h)])) as Record<SheetField, number>;
  if (at.phone < 0) return [];
  const out: SheetLead[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const cell = (f: SheetField) => (at[f] >= 0 ? (row[at[f]] ?? "").trim() : "");
    const phone = normalizePhone(cell("phone"));
    if (phone.length < 7) continue;
    const lead = Object.fromEntries(Object.keys(HEADERS).map((f) => [f, cell(f as SheetField)])) as Record<SheetField, string>;
    lead.phone = phone;
    if (NOBODY.has(lead.assigned_to)) lead.assigned_to = "";
    // the sheet has no row id: the conversation is who, about what, where, taken by whom
    const key = [phone, lead.inquiry, lead.destination, lead.received_by].join("|");
    // ponytail: two identical rows (same client, same question, same day) are one conversation
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...lead, key });
  }
  return out;
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
  const n = name.trim();
  if (!n) return null;
  const exact = employees.filter((e) => e.arabic_name.trim() === n);
  if (exact.length === 1) return exact[0].id;
  const starts = employees.filter((e) => e.arabic_name.trim().startsWith(`${n} `));
  return starts.length === 1 ? starts[0].id : null;
}
