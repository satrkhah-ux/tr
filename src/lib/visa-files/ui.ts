import { findLookupCountry } from "@/lib/offer/draft-types";
import {
  VISA_SERVICE_KEYS,
  VISA_SERVICE_LABEL,
  VISA_STATUSES,
  VISA_STATUS_LABEL,
  actionDue,
  dueAmount,
  paymentState,
  replyOverdue,
  type PaymentState,
  type TeletelPull,
  type VisaActionResult,
  type VisaDoc,
  type VisaDocKind,
  type VisaFile,
  type VisaFilter,
  type VisaRow,
  type VisaService,
  type VisaStatus,
  type VisaTraveler,
} from "./types";
import type { NewVisaFile, VisaFilePatch } from "@/lib/data/visa-files";

/**
 * What the visa screens decide without the server: which button a file offers, how the board's filter maps to
 * VisaFilter, what a Teletel pull fills in, the shape of each section's draft. Pure, so the screens stay thin and
 * every rule is tested without rendering (src/components/traveliun/visa-files).
 */

/** The management account works the whole department; a visas.work holder works what the server hands him. */
export const isVisaManager = (can: (permission: "visas.manage" | "dashboard.admin" | "developer.access") => boolean) =>
  can("visas.manage") || can("dashboard.admin") || can("developer.access");

// ---------- status ----------

/** The steps offered from each status: on by one, back where it was closed too early, or off the board. The server decides in the end. */
export const NEXT_STATUS: Record<VisaStatus, readonly VisaStatus[]> = {
  new: ["collecting", "cancelled"],
  collecting: ["ready", "cancelled"],
  ready: ["submitted", "collecting", "cancelled"],
  submitted: ["approved", "rejected", "ready", "cancelled"],
  approved: ["delivered"],
  rejected: ["collecting"],
  delivered: [],
  cancelled: ["collecting"],
};
/** The two answers the embassy gives are told to the client, so they ask «هل أنت متأكد؟» first. */
export const CONFIRM_STATUS: readonly VisaStatus[] = ["approved", "rejected", "cancelled"];

const STEP_VERB: Record<VisaStatus, string> = {
  new: "إعادة فتح الملف",
  collecting: "بدء جمع المستندات",
  ready: "جاهز للتقديم",
  submitted: "تم التقديم للسفارة",
  approved: "صدرت التأشيرة",
  rejected: "رُفضت التأشيرة",
  delivered: "سُلِّمت للعميل",
  cancelled: "إلغاء الملف",
};
/** A button's words: «رجوع إلى …» when the step goes back, the verb when it goes on. */
export function stepLabel(from: VisaStatus, to: VisaStatus): string {
  const back = to !== "cancelled" && VISA_STATUSES.indexOf(to) < VISA_STATUSES.indexOf(from);
  return back ? `رجوع إلى «${VISA_STATUS_LABEL[to]}»` : STEP_VERB[to];
}

// ---------- the board's filter ----------

export type BoardFilterState = {
  status: VisaStatus | "open" | "all";
  focus: NonNullable<VisaFilter["focus"]> | null;
  country: string;
  /** "" — anyone, "none" — unassigned, or an employee id */
  assignedTo: string;
  search: string;
  limit: number;
};
export const BOARD_PAGE = 100;
export const defaultBoardFilter = (): BoardFilterState => ({ status: "open", focus: null, country: "", assignedTo: "", search: "", limit: BOARD_PAGE });

/** What goes to getVisaBoard — nothing is filtered on the client, so a visas.work holder sees exactly what the server gives him. */
export function toVisaFilter(s: BoardFilterState): VisaFilter {
  const f: VisaFilter = { status: s.status, limit: s.limit };
  if (s.focus) f.focus = s.focus;
  if (s.country) f.country = s.country;
  if (s.assignedTo) f.assignedTo = s.assignedTo;
  if (s.search.trim()) f.search = s.search.trim();
  return f;
}
/** A status counter: that status, no attention filter. */
export const pickStatus = (s: BoardFilterState, status: BoardFilterState["status"]): BoardFilterState => ({ ...s, status, focus: null, limit: BOARD_PAGE });
/** An attention counter: the files it counts. «صدرت ولم تُسلَّم» is by definition not an open file. */
export const pickFocus = (s: BoardFilterState, focus: BoardFilterState["focus"]): BoardFilterState => {
  // pressed again, a counter lets go and the board is back on the open files
  const off = s.focus === focus;
  return { ...s, focus: off ? null : focus, status: !off && focus === "toDeliver" ? "all" : "open", limit: BOARD_PAGE };
};
/** nothing narrowed — a longer page is still the default view */
export const isDefaultFilter = (s: BoardFilterState) => JSON.stringify({ ...s, limit: BOARD_PAGE }) === JSON.stringify(defaultBoardFilter());

export const FOCUS_LABEL: Record<NonNullable<VisaFilter["focus"]>, string> = {
  missingDocs: "ناقصة مستندات",
  replyOverdue: "تأخر الرد",
  actionDue: "متابعة مستحقة اليوم",
  toDeliver: "صدرت ولم تُسلَّم",
  unpaid: "لم يسدد العميل",
};

/** the board's rows grew by a page: another page is worth asking for when this one came back full */
export const hasMore = (rows: number, limit: number) => rows >= limit;

// ---------- one row ----------

export type RowFlags = { replyLate: boolean; actionDue: boolean; payment: PaymentState; due: number };
export function rowFlags(r: VisaRow, now: number): RowFlags {
  return {
    // a submitted file has no answer yet by definition (VisaRow carries no repliedAt)
    replyLate: replyOverdue({ status: r.status, expectedReplyAt: r.expectedReplyAt, repliedAt: null }, now),
    actionDue: actionDue(r, now),
    payment: paymentState(r),
    due: dueAmount(r),
  };
}

// ---------- words and numbers ----------

export const money = (amount: number, currency: string) => `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
/** «1,200 SAR · 300 USD» — what is owed per currency; «—» when nothing is */
export function dueText(due: Record<string, number>): string {
  const parts = Object.entries(due).filter(([, v]) => v > 0).map(([c, v]) => money(v, c));
  return parts.length ? parts.join(" · ") : "—";
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const zone = (s: string) => (isDay(s) ? "UTC" : "Asia/Riyadh");
/** «26 أكتوبر 2026» — a plain date as it is, a moment in Riyadh's day */
export function fmtDate(at: string | null | undefined): string {
  if (!at || Number.isNaN(Date.parse(at))) return "—";
  return new Date(at).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { timeZone: zone(at), day: "numeric", month: "long", year: "numeric" });
}
export function fmtDateTime(at: string | null | undefined): string {
  if (!at || Number.isNaN(Date.parse(at))) return "—";
  return new Date(at).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" });
}
const riyadhDay = (t: number) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const dayWord = (n: number) => (n === 1 ? "يوم" : n === 2 ? "يومان" : n <= 10 ? `${n} أيام` : `${n} يوماً`);
/** «اليوم» / «غداً» / «بعد 3 أيام» / «تأخر يومان» — by Riyadh's calendar days */
export function relativeDay(at: string | null | undefined, now: number): string {
  if (!at || Number.isNaN(Date.parse(at))) return "";
  const target = isDay(at) ? Date.parse(at) : Date.parse(riyadhDay(Date.parse(at)));
  const days = Math.round((target - Date.parse(riyadhDay(now))) / 86_400_000);
  if (days === 0) return "اليوم";
  if (days === 1) return "غداً";
  if (days > 1) return `بعد ${dayWord(days)}`;
  return days === -1 ? "تأخر يوم" : `تأخر ${dayWord(-days)}`;
}

/** value of an <input type="date"> from a stored date or moment */
export const toDateInput = (at: string | null | undefined) => (!at || Number.isNaN(Date.parse(at)) ? "" : isDay(at) ? at : riyadhDay(Date.parse(at)));
/** value of an <input type="datetime-local"> in Riyadh's clock (UTC+3, no daylight saving) */
export const toLocalInput = (at: string | null | undefined) => (!at || Number.isNaN(Date.parse(at)) ? "" : new Date(Date.parse(at) + 3 * 3600_000).toISOString().slice(0, 16));
export const fromLocalInput = (local: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00+03:00` : null);

/** "" → null, a number → itself, anything else → NaN (the caller says what is wrong) */
export const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
export const numText = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "" : String(n));

// ---------- errors ----------

const ARABIC = /[؀-ۿ]/;
/** a server answer or a thrown error as a line the employee can read */
export function friendlyError(error: string): string {
  if (ARABIC.test(error)) return error;
  if (/not implemented/i.test(error)) return "هذه الخدمة لم تُفعَّل على الخادم بعد.";
  return error.trim() && error.length < 40 ? `تعذّر تنفيذ العملية (${error}).` : "تعذّر تنفيذ العملية. حاول مرة أخرى.";
}
/** every action, as an answer: a throw (offline, a deploy in between, a body not written yet) becomes {ok:false} with a readable error */
export async function settle<T extends object>(run: () => Promise<VisaActionResult<T>>): Promise<VisaActionResult<T>> {
  try {
    const r = await run();
    return r.ok ? r : { ok: false, error: friendlyError(r.error) };
  } catch (e) {
    return { ok: false, error: friendlyError(e instanceof Error ? e.message : "") };
  }
}

// ---------- services ----------

/** a service as it is typed: the price stays text until it is saved */
export type ServiceDraft = { key: string; label: string; price: string; done: boolean };
export const servicesToDraft = (list: VisaService[]): ServiceDraft[] => list.map((s) => ({ key: s.key, label: s.label, price: numText(s.price), done: s.done }));
export function draftToServices(list: ServiceDraft[]): VisaService[] {
  return list.map((s) => ({ key: s.key, label: s.label.trim(), price: numOrNull(s.price), done: s.done })).filter((s) => s.label);
}
/** tick or untick one of the standard services */
export function toggleService(list: ServiceDraft[], key: (typeof VISA_SERVICE_KEYS)[number]): ServiceDraft[] {
  return list.some((s) => s.key === key) ? list.filter((s) => s.key !== key) : [...list, { key, label: VISA_SERVICE_LABEL[key], price: "", done: false }];
}
/** the employee's own line */
export function addCustomService(list: ServiceDraft[], label: string): ServiceDraft[] {
  const text = label.trim();
  if (!text) return list;
  let n = list.length + 1;
  while (list.some((s) => s.key === `custom-${n}`)) n++;
  return [...list, { key: `custom-${n}`, label: text, price: "", done: false }];
}
/** a typed price that is not a number (empty is fine) */
export const badPrice = (list: ServiceDraft[]) => list.some((s) => s.price.trim() !== "" && !(Number(s.price.replace(/,/g, "")) >= 0));

// ---------- the new file ----------

export type NewFileForm = {
  clientName: string;
  clientPhone: string;
  nationality: string;
  country: string;
  countryId: string | null;
  visaCatalogId: string | null;
  visaType: string;
  applicants: string;
  appliedAt: string;
  services: ServiceDraft[];
  feeService: string;
  feeEmbassy: string;
  currency: string;
  assignedTo: string;
  note: string;
  conversationId: number | null;
  contactId: number | null;
  leadId: string | null;
};
export const emptyNewFile = (): NewFileForm => ({
  clientName: "", clientPhone: "", nationality: "", country: "", countryId: null, visaCatalogId: null, visaType: "", applicants: "1", appliedAt: "",
  services: [], feeService: "", feeEmbassy: "", currency: "SAR", assignedTo: "", note: "", conversationId: null, contactId: null, leadId: null,
});

/**
 * «اسحب من تليتيل»: the client and the conversation always follow the pull; what Murad's intake learned fills the
 * fields the employee has not typed yet, never over his own words.
 */
export function applyPull(form: NewFileForm, pull: TeletelPull): NewFileForm {
  const intake = pull.intake;
  return {
    ...form,
    clientName: pull.clientName.trim() || form.clientName,
    clientPhone: pull.clientPhone ?? form.clientPhone,
    conversationId: pull.conversationId,
    contactId: pull.contactId,
    leadId: pull.leadId,
    country: form.country.trim() ? form.country : (intake?.country ?? ""),
    nationality: form.nationality.trim() ? form.nationality : (intake?.nationality ?? ""),
    applicants: form.applicants === "1" && intake?.applicants && intake.applicants > 0 ? String(intake.applicants) : form.applicants,
  };
}
/** the pull is let go: the form keeps what was typed, loses the link */
export const unlinkPull = (form: NewFileForm): NewFileForm => ({ ...form, conversationId: null, contactId: null, leadId: null });

/** the catalogue row picked for the country: its type and its price (a starting point, editable) */
export function applyCatalogRow(form: NewFileForm, row: { id: string; visaType: string | null; sellPrice: number | null; sellCurrency: string | null } | null): NewFileForm {
  if (!row) return { ...form, visaCatalogId: null };
  return {
    ...form,
    visaCatalogId: row.id,
    visaType: row.visaType ?? form.visaType,
    feeService: row.sellPrice !== null && row.sellPrice > 0 ? String(row.sellPrice) : form.feeService,
    currency: row.sellCurrency || form.currency,
  };
}
/** the country as the countries table spells it (the same fold the offer screens use), with its id */
export function resolveCountry(countries: { id: string; name: string }[], typed: string): { id: string | null; name: string } {
  const hit = typed.trim() ? findLookupCountry(countries, typed.trim()) : undefined;
  return hit ? { id: hit.id, name: hit.name } : { id: null, name: typed };
}

export type FormErrors = Partial<Record<"clientName" | "country" | "applicants" | "fees" | "services" | "appliedAt", string>>;
export function buildNewFile(form: NewFileForm): { ok: true; input: NewVisaFile } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const applicants = Number(form.applicants);
  const feeService = numOrNull(form.feeService) ?? 0;
  const feeEmbassy = numOrNull(form.feeEmbassy) ?? 0;
  if (!form.clientName.trim()) errors.clientName = "اكتب اسم العميل.";
  if (!form.country.trim()) errors.country = "اختر الدولة.";
  if (!Number.isInteger(applicants) || applicants < 1) errors.applicants = "عدد المتقدمين رقم صحيح من 1 فأكثر.";
  if (!(feeService >= 0) || !(feeEmbassy >= 0)) errors.fees = "الرسوم أرقام لا تقل عن صفر.";
  if (badPrice(form.services)) errors.services = "سعر الخدمة رقم لا يقل عن صفر.";
  if (form.appliedAt && Number.isNaN(Date.parse(form.appliedAt))) errors.appliedAt = "تاريخ التقديم غير صحيح.";
  if (Object.keys(errors).length) return { ok: false, errors };
  // the file has no nationality column (the contract), so it travels in the note until the travellers are entered
  const note = [form.nationality.trim() && `الجنسية: ${form.nationality.trim()}`, form.note.trim()].filter(Boolean).join("\n");
  return {
    ok: true,
    input: {
      country: form.country.trim(),
      countryId: form.countryId,
      visaCatalogId: form.visaCatalogId,
      visaType: form.visaType.trim() || null,
      applicants,
      clientName: form.clientName.trim(),
      clientPhone: form.clientPhone.trim() || null,
      conversationId: form.conversationId,
      contactId: form.contactId,
      leadId: form.leadId,
      assignedTo: form.assignedTo || null,
      appliedAt: form.appliedAt || null,
      services: draftToServices(form.services),
      feeService,
      feeEmbassy,
      currency: form.currency,
      note: note || null,
    },
  };
}

// ---------- documents ----------

export type DocState = "received" | "missing" | "optional";
export const docState = (d: Pick<VisaDoc, "required" | "receivedAt">): DocState => (d.receivedAt ? "received" : d.required ? "missing" : "optional");
/** the missing ones first — that is what the employee came to chase — then the optional, then the received, each in file order */
export function sortedDocs(docs: VisaDoc[]): VisaDoc[] {
  const rank: Record<DocState, number> = { missing: 0, optional: 1, received: 2 };
  return docs.map((d, i) => ({ d, i })).sort((a, b) => rank[docState(a.d)] - rank[docState(b.d)] || a.i - b.i).map((x) => x.d);
}
export function docTotals(docs: VisaDoc[]) {
  const required = docs.filter((d) => d.required);
  return { required: required.length, received: required.filter((d) => d.receivedAt).length, missing: required.filter((d) => !d.receivedAt).length };
}
/** where a Teletel attachment can go: a document still waiting for its file, or a new document of some kind */
export type ImportTarget = { value: string; label: string };
export function importTargets(docs: VisaDoc[], kindLabel: Record<VisaDocKind, string>, kinds: readonly VisaDocKind[]): ImportTarget[] {
  const waiting = docs.filter((d) => !d.receivedAt).map((d) => ({ value: `doc:${d.id}`, label: `${d.label || kindLabel[d.kind]} (ينتظر ملفاً)` }));
  return [...waiting, ...kinds.map((k) => ({ value: `new:${k}`, label: `مستند جديد: ${kindLabel[k]}` }))];
}

// ---------- travellers ----------

export const blankTraveler = (id: string): VisaTraveler => ({ id, fullName: "", passportNo: null, nationality: null, birthDate: null, passportExpiry: null, result: null, visaNo: null, note: null });
/** what the passport reader found, put into the traveller the employee chose (or a new one) — only what it found, never blanking a field */
export function mergeRead(list: VisaTraveler[], targetId: string | "new", read: Partial<VisaTraveler>, newId: string): VisaTraveler[] {
  const found = Object.fromEntries(Object.entries(read).filter(([k, v]) => k !== "id" && v !== null && v !== undefined && v !== "")) as Partial<VisaTraveler>;
  if (targetId === "new") return [...list, { ...blankTraveler(newId), ...found }];
  return list.map((t) => (t.id === targetId ? { ...t, ...found } : t));
}

/** Teletel's last_activity_at arrives in seconds (Chatwoot) — milliseconds too, should that ever change */
export const epochMs = (n: number) => (n < 1e12 ? n * 1000 : n);

// ---------- the file page's sections: each is a draft of strings, a check, and the patch it sends ----------

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export type DetailsDraft = { clientName: string; clientPhone: string; country: string; visaType: string; applicants: string; note: string };
export const detailsOf = (f: VisaFile): DetailsDraft => ({
  clientName: f.clientName, clientPhone: f.clientPhone ?? "", country: f.country, visaType: f.visaType ?? "", applicants: String(f.applicants), note: f.note ?? "",
});
export function detailsPatch(d: DetailsDraft): Checked<VisaFilePatch> {
  const applicants = Number(d.applicants);
  if (!d.clientName.trim()) return { ok: false, error: "اكتب اسم العميل." };
  if (!d.country.trim()) return { ok: false, error: "اكتب الدولة." };
  if (!Number.isInteger(applicants) || applicants < 1) return { ok: false, error: "عدد المتقدمين رقم صحيح من 1 فأكثر." };
  return { ok: true, value: { clientName: d.clientName.trim(), clientPhone: d.clientPhone.trim() || null, country: d.country.trim(), visaType: d.visaType.trim() || null, applicants, note: d.note.trim() || null } };
}

export type DatesDraft = { appliedAt: string; appointmentAt: string; expectedReplyAt: string; repliedAt: string };
export const datesOf = (f: VisaFile): DatesDraft => ({
  appliedAt: toDateInput(f.appliedAt), appointmentAt: toLocalInput(f.appointmentAt), expectedReplyAt: toDateInput(f.expectedReplyAt), repliedAt: toDateInput(f.repliedAt),
});
export function datesPatch(d: DatesDraft): Checked<VisaFilePatch> {
  // a reply cannot be expected, or have come, before the application went in
  if (d.appliedAt && d.expectedReplyAt && d.expectedReplyAt < d.appliedAt) return { ok: false, error: "موعد الرد المتوقع لا يسبق تاريخ التقديم." };
  if (d.appliedAt && d.repliedAt && d.repliedAt < d.appliedAt) return { ok: false, error: "تاريخ الرد لا يسبق تاريخ التقديم." };
  return { ok: true, value: { appliedAt: d.appliedAt || null, appointmentAt: fromLocalInput(d.appointmentAt), expectedReplyAt: d.expectedReplyAt || null, repliedAt: d.repliedAt || null } };
}

export type FollowDraft = { nextAction: string; nextActionAt: string };
export const followOf = (f: VisaFile): FollowDraft => ({ nextAction: f.nextAction ?? "", nextActionAt: toDateInput(f.nextActionAt) });
export const followPatch = (d: FollowDraft): Checked<VisaFilePatch> => ({ ok: true, value: { nextAction: d.nextAction.trim() || null, nextActionAt: d.nextActionAt || null } });

export type MoneyDraft = { feeService: string; feeEmbassy: string; currency: string };
export const moneyOf = (f: VisaFile): MoneyDraft => ({ feeService: numText(f.feeService), feeEmbassy: numText(f.feeEmbassy), currency: f.currency });
export function moneyPatch(d: MoneyDraft): Checked<VisaFilePatch> {
  const feeService = numOrNull(d.feeService) ?? 0;
  const feeEmbassy = numOrNull(d.feeEmbassy) ?? 0;
  if (!(feeService >= 0) || !(feeEmbassy >= 0)) return { ok: false, error: "الرسوم أرقام لا تقل عن صفر." };
  return { ok: true, value: { feeService, feeEmbassy, currency: d.currency } };
}

export type PaymentDraft = { amount: string; method: string; note: string; paidAt: string };
export function paymentInput(d: PaymentDraft): Checked<{ amount: number; method: string | null; note: string | null; paidAt: string }> {
  const amount = numOrNull(d.amount);
  if (amount === null || !(amount > 0)) return { ok: false, error: "اكتب مبلغ الدفعة (أكبر من صفر)." };
  if (!d.paidAt) return { ok: false, error: "اختر تاريخ الدفعة." };
  return { ok: true, value: { amount, method: d.method || null, note: d.note.trim() || null, paidAt: d.paidAt } };
}

export function travelersPatch(list: VisaTraveler[]): Checked<VisaFilePatch> {
  const bad = list.findIndex((t) => !t.fullName.trim());
  if (bad >= 0) return { ok: false, error: `اكتب اسم المسافر رقم ${bad + 1}.` };
  const text = (s: string | null) => (s && s.trim() ? s.trim() : null);
  return { ok: true, value: { travelers: list.map((t) => ({ ...t, fullName: t.fullName.trim(), passportNo: text(t.passportNo), nationality: text(t.nationality), visaNo: text(t.visaNo), note: text(t.note), birthDate: t.birthDate || null, passportExpiry: t.passportExpiry || null })) } };
}

/** who did it: a name when the id is a colleague we know, nothing for a bare uuid */
export function whoText(by: string | null, people: { id: string; name: string }[]): string {
  if (!by) return "";
  const known = people.find((p) => p.id === by)?.name;
  return known ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(by) ? "" : by);
}
