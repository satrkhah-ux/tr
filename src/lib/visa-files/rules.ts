import { splitNumbered } from "@/lib/data/numbered-lines";
import { withoutPrices } from "@/lib/murad/price-visibility";
import { isCalendarDate } from "@/lib/operations/travelers";
import { riyadhDate } from "@/lib/operations/payments";
import {
  VISA_DOC_LABEL, VISA_SERVICE_KEYS, VISA_SERVICE_LABEL, VISA_STATUS_LABEL,
  type VisaDoc, type VisaDocKind, type VisaFile, type VisaService, type VisaStatus,
} from "./types";

/**
 * The visa files' rules, without I/O (the actions in data/visa-files.ts only fetch and store).
 * Everything the owner may later want to change — the transitions, the date anchors, the document guesses,
 * the upload gate — is one table or one function here, each with a test.
 */

const uuid = () => globalThis.crypto.randomUUID();
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Search/compare form of an Arabic or Latin text: no marks, one alef, one ya, one ha. */
export const fold = (s: string) =>
  s.toLowerCase().replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

// ---------- the serial «VF-26-0001» ----------

const SERIAL = /^VF-(\d{2})-(\d{4,})$/;
export const isSerial = (s: string) => SERIAL.test(s);
export const formatSerial = (year2: number, n: number) => `VF-${String(year2 % 100).padStart(2, "0")}-${String(n).padStart(4, "0")}`;
/** the two-digit year of the office (Riyadh) */
export const serialYear = (at: Date | number = new Date()) => Number(riyadhDate(at).slice(2, 4));
/**
 * The serial after `latest` (the highest serial of that year, or null): the table's unique constraint is the
 * real guard, the caller retries when two files are opened in the same instant.
 * ponytail: ordering by text is right up to VF-yy-9999 — ten thousand files a year is not this department.
 */
export function nextSerial(year2: number, latest: string | null): string {
  const m = latest ? SERIAL.exec(latest) : null;
  return formatSerial(year2, m && Number(m[1]) === year2 % 100 ? Number(m[2]) + 1 : 1);
}

// ---------- dates ----------

type Anchor = "start" | "noon" | "end";
const ANCHOR: Record<Anchor, string> = { start: "00:00:00", noon: "12:00:00", end: "23:59:59" };

/**
 * A day «YYYY-MM-DD» becomes a moment in Riyadh's day; a full timestamp is kept as given; anything else is null.
 * The anchor is the meaning of a bare day: an action is due from the START of its day, a reply is overdue only
 * after its day has ENDED (types.ts replyOverdue compares the instant), and a day somebody did something is
 * noon, which reads as the same calendar day in any zone.
 */
export function parseInstant(value: string, anchor: Anchor): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (!isCalendarDate(v) || v < "2000-01-01" || v > "2100-12-31") return null;
    return new Date(`${v}T${ANCHOR[anchor]}+03:00`).toISOString();
  }
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 11, 31)) return null;
  return new Date(ms).toISOString();
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** the expected reply is not set → application day + the country's processing days */
export const DEFAULT_PROCESSING_DAYS = 15;
export function parseProcessingDays(raw: string | null | undefined): Record<string, number> {
  try {
    const obj = JSON.parse(raw ?? "{}") as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 365).map(([k, v]) => [fold(k), v as number]));
  } catch {
    return {};
  }
}
export const processingDays = (map: Record<string, number>, country: string) => map[fold(country)] ?? DEFAULT_PROCESSING_DAYS;
export const expectedReplyFor = (appliedAt: string, days: number) => parseInstant(addDays(riyadhDate(appliedAt), days), "end") as string;

// ---------- status moves ----------

/**
 * Where a file may go from each status. Within the open statuses it may step back (a document turned out to be
 * missing); `delivered` only after `approved`; a rejected or cancelled file reopens as «جمع المستندات».
 */
export const TRANSITIONS: Record<VisaStatus, readonly VisaStatus[]> = {
  new: ["collecting", "ready", "submitted", "cancelled"],
  collecting: ["ready", "submitted", "cancelled"],
  ready: ["collecting", "submitted", "cancelled"],
  submitted: ["collecting", "ready", "approved", "rejected", "cancelled"],
  approved: ["delivered", "submitted", "cancelled"],
  rejected: ["collecting", "cancelled"],
  delivered: [],
  cancelled: ["collecting"],
};
export const nextStatuses = (from: VisaStatus) => TRANSITIONS[from];

type StatusDates = Pick<VisaFile, "appliedAt" | "expectedReplyAt" | "repliedAt">;
export type StatusPlan = { ok: true; patch: Partial<StatusDates> } | { ok: false; error: string };

/**
 * What a status move changes besides the status. Submitted: the application day (kept when the file already has
 * one, else today) and the expected reply (kept, else the country's processing days); approved/rejected: the day
 * the embassy answered; going back from an answer or from a rejection clears what the answer set.
 */
export function planStatus(file: Pick<VisaFile, "status" | "country"> & StatusDates, to: VisaStatus, ctx: { now?: Date; processingDays?: Record<string, number> } = {}): StatusPlan {
  const now = ctx.now ?? new Date();
  if (file.status === to) return { ok: false, error: "الملف في هذه الحالة بالفعل." };
  if (!TRANSITIONS[file.status].includes(to)) return { ok: false, error: `لا يمكن نقل الملف من «${VISA_STATUS_LABEL[file.status]}» إلى «${VISA_STATUS_LABEL[to]}».` };
  const patch: Partial<StatusDates> = {};
  if (file.status === "rejected") Object.assign(patch, { appliedAt: null, expectedReplyAt: null, repliedAt: null });
  else if (file.status === "approved" && to === "submitted") patch.repliedAt = null;
  if (to === "submitted") {
    const applied = file.appliedAt ?? (parseInstant(riyadhDate(now), "noon") as string);
    patch.appliedAt = applied;
    patch.expectedReplyAt = file.expectedReplyAt && file.status !== "rejected" ? file.expectedReplyAt : expectedReplyFor(applied, processingDays(ctx.processingDays ?? {}, file.country));
  }
  if (to === "approved" || to === "rejected") patch.repliedAt = now.toISOString();
  return { ok: true, patch };
}

// ---------- documents: «ماذا أرفق» ----------

/** Ordered: the first pattern that matches names the kind («صورة الجواز» is a passport, not a photo). */
const KIND_GUESS: [VisaDocKind, RegExp][] = [
  ["passport", /جواز|باسبور|passport/i],
  ["photo", /صور[ةه]?\s*(?:شخصي|ملون|حديث|بخلف|بيضاء)|صورتان|صورتين|صور شخصي|photo|\d\s*[x×*]\s*\d/i],
  ["hotel", /فندق|فنادق|حجز\s*(?:ال)?سكن|hotel/i],
  ["flight", /طيران|تذكر[ةه]|تذاكر|رحل[ةه] جوي|flight|ticket/i],
  ["insurance", /تأمين|تامين|insurance/i],
  ["bank_statement", /كشف\s*(?:ال)?حساب|حساب\s*بنك|بنك|رصيد|bank/i],
  ["employment_letter", /خطاب\s*(?:من\s*)?(?:جه[ةه]\s*)?(?:ال)?عمل|تعريف\s*(?:ب)?(?:ال)?(?:راتب|عمل)|عقد\s*عمل|رخص[ةه]\s*تجاري|سجل\s*تجاري|مباشر[ةه]|employment|salary/i],
  ["invitation", /دعو[ةه]|invitation/i],
  ["form", /استمار[ةه]|نموذج|طلب\s*(?:ال)?تأشير|\bform\b|application/i],
  ["receipt", /إيصال|ايصال|سداد|receipt/i],
  ["residence", /إقام[ةه]|اقام[ةه]|هوي[ةه]|تأشير[ةه]\s*زيار|residence|iqama/i],
];
export const guessDocKind = (line: string): VisaDocKind => KIND_GUESS.find(([, re]) => re.test(line))?.[0] ?? "other";

/** the documents each traveller brings himself; the rest (a booking, a form) belong to the file */
export const PER_TRAVELER: readonly VisaDocKind[] = ["passport", "photo", "residence"];

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** «1- الجواز 2- صورة…» → the lines of the list, numbers stripped, headings dropped (a catalogue's requirements text). */
export function requirementLines(text: string | null | undefined): string[] {
  return splitNumbered((text ?? "").trim())
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[\d٠-٩]+\s*[-–).]|[-•*▪●])\s*/, "").trim())
    .filter((l) => l.length >= 3 && !/[:：]$/.test(l))
    .slice(0, 40);
}

/**
 * The expected documents of a new file: one per requirement line (fee and price lines are not documents),
 * the personal ones once per traveller; the passport is always there, and a catalogue with no list gives the
 * two every application needs.
 */
export function expectedDocs(lines: string[], travelerIds: string[], newId: () => string = uuid): VisaDoc[] {
  const seen = new Set<string>();
  const wanted: { kind: VisaDocKind; label: string }[] = [];
  for (const raw of lines) {
    const line = withoutPrices(raw).trim();
    if (!line || seen.has(fold(line))) continue;
    seen.add(fold(line));
    wanted.push({ kind: guessDocKind(line), label: cut(line, 120) });
  }
  if (!wanted.some((w) => w.kind === "passport")) wanted.unshift({ kind: "passport", label: VISA_DOC_LABEL.passport });
  if (wanted.length === 1) wanted.push({ kind: "photo", label: VISA_DOC_LABEL.photo });
  const doc = (kind: VisaDocKind, label: string, travelerId: string | null): VisaDoc => ({
    id: newId(), kind, label, travelerId, path: null, fileName: null, required: true, receivedAt: null, submittedAt: null, fromMessageId: null,
  });
  return wanted.flatMap((w) =>
    PER_TRAVELER.includes(w.kind) && travelerIds.length > 0
      ? travelerIds.map((tid, i) => doc(w.kind, travelerIds.length > 1 ? cut(`${w.label} — مسافر ${i + 1}`, 120) : w.label, tid))
      : [doc(w.kind, w.label, null)],
  );
}

export const DEFAULT_SERVICE_KEYS: readonly (typeof VISA_SERVICE_KEYS)[number][] = ["documents_review", "form_filling", "submission", "tracking", "delivery"];
export const defaultServices = (): VisaService[] => DEFAULT_SERVICE_KEYS.map((key) => ({ key, label: VISA_SERVICE_LABEL[key], price: null, done: false }));

// ---------- uploads ----------

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
/** the browser's "I don't know" — then only the bytes decide */
const GENERIC_MIME = ["", "application/octet-stream", "binary/octet-stream"];
export type UploadProblem = "empty" | "too_large" | "type";
export const UPLOAD_MESSAGE: Record<UploadProblem, string> = {
  empty: "الملف فارغ.",
  too_large: "حجم الملف أكبر من 10 ميجابايت.",
  type: "صور (JPG أو PNG أو WEBP أو HEIC) أو ملف PDF فقط.",
};

/** What the first bytes say the file is, or null when it is none of the allowed kinds (a declared type is only a claim). */
export function sniffMime(b: Uint8Array): (typeof ALLOWED_MIME)[number] | null {
  const at = (i: number, ...s: number[]) => s.every((v, k) => b[i + k] === v);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(4, 0x66, 0x74, 0x79, 0x70) && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(String.fromCharCode(b[8], b[9], b[10], b[11]))) return "image/heic";
  return null;
}

/** The gate for any file entering a visa file (a browser upload or a Teletel attachment): size, declared type, real type. */
export function checkUpload(f: { size: number; declaredType: string; head: Uint8Array }): { ok: true; mime: (typeof ALLOWED_MIME)[number] } | { ok: false; problem: UploadProblem } {
  if (f.size <= 0) return { ok: false, problem: "empty" };
  if (f.size > MAX_DOC_BYTES) return { ok: false, problem: "too_large" };
  const declared = f.declaredType.split(";")[0].trim().toLowerCase();
  const declaredOk = GENERIC_MIME.includes(declared) || (ALLOWED_MIME as readonly string[]).includes(declared) || declared === "image/jpg" || declared === "image/heif";
  const mime = sniffMime(f.head);
  return declaredOk && mime ? { ok: true, mime } : { ok: false, problem: "type" };
}
export const extFor = (mime: string) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" })[mime] ?? "bin";
/** the name shown for a document: no path, no control characters, short */
export const cleanFileName = (name: string) => cut(name.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim(), 120) || "مستند";

/** where a document lives in the private «visas» bucket — a random leaf, never the person's name (the passports convention) */
export const docPath = (fileId: string, docId: string, mime: string, leaf: string = uuid()) => `visa-files/${fileId}/${docId}/${leaf}.${extFor(mime)}`;

// ---------- cleaning what a person typed ----------

export type Fields = Partial<Pick<VisaFile,
  "country" | "countryId" | "visaCatalogId" | "visaType" | "applicants" | "clientName" | "clientPhone" | "assignedTo" | "appliedAt" | "appointmentAt" | "expectedReplyAt" | "repliedAt" |
  "feeService" | "feeEmbassy" | "currency" | "nextAction" | "nextActionAt" | "note">>;
type Raw = { [K in keyof Fields]?: unknown };
export type Clean = { ok: true; set: Fields } | { ok: false; error: string };

/** a typed text: trimmed, "" and null → null, too long or not text → "bad" */
export const cleanText = (v: unknown, max: number): string | null | "bad" => {
  if (v === null) return null;
  if (typeof v !== "string") return "bad";
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  return t.length > max ? "bad" : t === "" ? null : t;
};
const money = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000_000 ? Math.round(v * 100) / 100 : null);

/** the anchor for each date field (see parseInstant) */
const DATE_FIELDS: [keyof Fields, Anchor, string][] = [
  ["appliedAt", "noon", "تاريخ التقديم"], ["appointmentAt", "noon", "موعد السفارة"], ["expectedReplyAt", "end", "موعد الرد المتوقع"], ["repliedAt", "noon", "تاريخ الرد"], ["nextActionAt", "start", "موعد الإجراء القادم"],
];

/**
 * The fields of a new file or a patch, checked and put in their stored form. Only the keys that are present are
 * returned (undefined = untouched, null/"" = cleared where the field may be empty); the first bad field is named.
 */
export function cleanFields(input: Raw): Clean {
  const set: Record<string, unknown> = {};
  const bad = (what: string) => ({ ok: false as const, error: `${what} غير صالح.` });
  for (const [key, max, label, required] of [["country", 80, "الدولة", true], ["visaType", 80, "نوع التأشيرة", false], ["clientName", 120, "اسم العميل", true], ["nextAction", 300, "الإجراء القادم", false], ["note", 2000, "الملاحظة", false]] as const) {
    if (input[key] === undefined) continue;
    const t = cleanText(input[key], max);
    if (t === "bad" || (required && t === null)) return bad(label);
    set[key] = t;
  }
  if (input.clientPhone !== undefined) {
    const t = cleanText(input.clientPhone, 30);
    if (t === "bad" || (t !== null && !/^[+\d\s()\-]{6,30}$/.test(t))) return bad("رقم الجوال");
    set.clientPhone = t;
  }
  if (input.applicants !== undefined) {
    if (typeof input.applicants !== "number" || !Number.isInteger(input.applicants) || input.applicants < 1 || input.applicants > 50) return bad("عدد المتقدمين");
    set.applicants = input.applicants;
  }
  for (const key of ["countryId", "visaCatalogId", "assignedTo"] as const) {
    if (input[key] === undefined) continue;
    if (input[key] !== null && !isUuid(input[key])) return bad("المعرّف");
    set[key] = input[key];
  }
  for (const [key, label] of [["feeService", "رسوم الخدمة"], ["feeEmbassy", "رسوم السفارة"]] as const) {
    if (input[key] === undefined) continue;
    const m = money(input[key]);
    if (m === null) return bad(label);
    set[key] = m;
  }
  if (input.currency !== undefined) {
    if (typeof input.currency !== "string" || !/^[A-Za-z]{3}$/.test(input.currency.trim())) return bad("العملة");
    set.currency = input.currency.trim().toUpperCase();
  }
  for (const [key, anchor, label] of DATE_FIELDS) {
    const v = input[key];
    if (v === undefined) continue;
    if (v === null || v === "") {
      set[key] = null;
      continue;
    }
    const at = typeof v === "string" ? parseInstant(v, anchor) : null;
    if (!at) return bad(label);
    set[key] = at;
  }
  return { ok: true, set: set as Fields };
}

export function cleanServices(input: unknown): { ok: true; services: VisaService[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length > 30) return { ok: false, error: "قائمة الخدمات غير صالحة." };
  const out: VisaService[] = [];
  for (const raw of input as Partial<VisaService>[]) {
    const key = cleanText(raw?.key, 40);
    const label = cleanText(raw?.label, 80);
    const price = raw?.price === null || raw?.price === undefined ? null : money(raw.price);
    if (key === "bad" || key === null || label === "bad" || label === null || (raw?.price != null && price === null) || typeof raw?.done !== "boolean") return { ok: false, error: "إحدى الخدمات غير صالحة." };
    out.push({ key, label, price, done: raw.done });
  }
  return { ok: true, services: out };
}

/** The timeline line for an edit: which fields changed, with the value where it is short and not private. */
const LABEL: Partial<Record<keyof Fields, string>> = {
  country: "الدولة", visaType: "نوع التأشيرة", applicants: "عدد المتقدمين", clientName: "اسم العميل", clientPhone: "رقم الجوال", appliedAt: "تاريخ التقديم", appointmentAt: "موعد السفارة",
  expectedReplyAt: "موعد الرد المتوقع", repliedAt: "تاريخ الرد", feeService: "رسوم الخدمة", feeEmbassy: "رسوم السفارة", currency: "العملة", nextAction: "الإجراء القادم", nextActionAt: "موعد الإجراء", note: "الملاحظة", visaCatalogId: "نوع التأشيرة في القائمة", countryId: "الدولة",
};
const DAY: (keyof Fields)[] = ["appliedAt", "appointmentAt", "expectedReplyAt", "repliedAt", "nextActionAt"];
const VALUE: (keyof Fields)[] = ["country", "visaType", "applicants", "feeService", "feeEmbassy", "currency", "nextAction"];
/** The fields of `set` that really differ from the file (a date compares as a moment, not as text). */
export function diffFields(before: Partial<Record<keyof Fields, unknown>>, set: Fields): Fields {
  const same = (key: keyof Fields, a: unknown, b: unknown) => (DAY.includes(key) && typeof a === "string" && typeof b === "string" ? Date.parse(a) === Date.parse(b) : (a ?? null) === (b ?? null));
  return Object.fromEntries(Object.entries(set).filter(([k, v]) => !same(k as keyof Fields, before[k as keyof Fields], v))) as Fields;
}
export function describeChange(changed: Fields): string | null {
  const parts: string[] = [];
  for (const key of Object.keys(changed) as (keyof Fields)[]) {
    if (!LABEL[key]) continue;
    const v = changed[key];
    const shown = DAY.includes(key) ? (typeof v === "string" ? riyadhDate(v) : "—") : VALUE.includes(key) ? (v === null || v === undefined ? "—" : cut(String(v), 60)) : null;
    parts.push(shown === null ? LABEL[key]! : `${LABEL[key]}: ${shown}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export const money2 = (n: number) => Math.round(n * 100) / 100;
