import { fold, riyadhDay } from "./sheet";
import { NOTHING, resolvePlace } from "./places";
import type { Place } from "./auto";

/**
 * «التقرير» — the follow-up staff's daily requests report, written by the system
 * from the conversations it already classified (the owner, 2026-10-29): the same
 * text the staff pasted to management by hand, the day's, the week's or the
 * month's, by employee, by department, or every request.
 *
 * No new classification: a request is what «العملاء» says it is (leads/auto.ts
 * classifyInquiry, written to client_leads.inquiry), counted on the Riyadh day it
 * opened and on each day the client came back — the rule of «حصر الطلبات
 * اليومية». The buckets below only give the existing kinds the report's words;
 * «الاستفسارات» has no kind of its own in the system (an inquiry is «طلب غير
 * واضح» — sheet.ts), so a request lands there only when the reviewer moves it.
 * Pure: the pane builds it in the browser; nothing here reads or writes data.
 */

export const BUCKETS = [
  { key: "package", icon: "🌍", label: "البكجات السياحية", kind: "بكج" },
  { key: "flight", icon: "✈️", label: "حجوزات الطيران", kind: "طيران" },
  { key: "visa", icon: "🛂", label: "التأشيرات", kind: "تأشيرات" },
  { key: "inquiry", icon: "📞", label: "الاستفسارات", kind: null },
  { key: "hotel", icon: "🏨", label: "طلبات الفنادق", kind: "فنادق" },
  { key: "transport", icon: "🚘", label: "مواصلات", kind: "مواصلات" },
  { key: "other", icon: "🔸", label: "طلبات اخرى", kind: "رخص دولية" },
  { key: "incomplete", icon: "🟣", label: "الطلبات غير المكتملة", kind: "طلب غير واضح" },
] as const;
export type BucketKey = (typeof BUCKETS)[number]["key"];
const BUCKET = new Map<BucketKey, (typeof BUCKETS)[number]>(BUCKETS.map((b) => [b.key, b]));
const BY_KIND = new Map<string, BucketKey>(BUCKETS.flatMap((b) => (b.kind ? [[b.kind, b.key] as const] : [])));

/** the existing kind of a conversation → its bucket; a kind the report does not know is «غير مكتمل», never invented */
export function bucketOf(inquiry: string | null | undefined): BucketKey {
  return BY_KIND.get((inquiry ?? "").trim()) ?? "incomplete";
}

/** One request on one day. */
export type ReportRequest = {
  /** the conversation (client_leads.id) — a client back on another day is another request with the same id */
  id: string;
  day: string;
  bucket: BucketKey;
  /** the system's own kind of the conversation (client_leads.inquiry) — what a request moved by hand was before */
  kind: string | null;
  /** the destination's country, when the request names one */
  country: string | null;
  city: string | null;
  /**
   * where the request is when it names no destination: a Saudi place («مكة», «جدة» — a hotel there, a transfer) or the words the
   * client wrote — never counted as a destination, only said on the lines of hotels, transport and the others
   */
  place: string | null;
  /** who received it — «الموظف المستلم» */
  employee: string | null;
  /** whom the conversation is with now — «لمن أُسند» on the lines of hotels, transport and the others */
  assignee: string | null;
  /** typed by the reviewer: the reason of an incomplete request, the description of another one */
  note: string | null;
};

/** What the reviewer corrected by hand — never written to the system. */
export type Edit = Partial<Pick<ReportRequest, "bucket" | "country" | "city" | "place" | "employee" | "note">>;

/**
 * Corrections are keyed two ways: what is true of the conversation (who received it, where it goes) by its id; what is
 * true of one visit (the department it counted in that day, the note) by `id|day` — a client back on another day is
 * another request, and what was reported for the first day stays as it was.
 */
export const visitKey = (r: Pick<ReportRequest, "id" | "day">) => `${r.id}|${r.day}`;

/** The facts of a conversation the report reads (a subset of leads.ts Lead). */
export type LeadFacts = {
  id: string;
  created_at: string;
  last_visit_at: string | null;
  inquiry: string | null;
  destination: string | null;
  file: { destination: string | null } | null;
  received_by: string | null;
  received_by_name: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  murad_receipt?: { firstResponder?: boolean } | null;
};

/** the Riyadh days a conversation counts on: the day it opened and the day the client came back (LeadsBoard visitsOf) */
export function visitDays(l: Pick<LeadFacts, "created_at" | "last_visit_at">): string[] {
  return [...new Set([riyadhDay(l.created_at), ...(l.last_visit_at ? [riyadhDay(l.last_visit_at)] : [])])];
}

/** «الموظف المستلم» as «العملاء» shows it: Murad when it answered first, else the first receiver */
export function receiverOf(l: LeadFacts, nameOf: Map<string, string>): string | null {
  return l.murad_receipt?.firstResponder ? "مُراد" : (nameOf.get(l.received_by ?? "") ?? l.received_by_name ?? null);
}

/** Every request of the conversations, one per day it counts on, with the destination as «العملاء» resolves it. */
export function requestsFrom(leads: LeadFacts[], nameOf: Map<string, string>, places: Place[]): ReportRequest[] {
  return leads.flatMap((l) => {
    const text = (l.file?.destination || l.destination || "").trim();
    const place = resolvePlace(text, places);
    const bucket = bucketOf(l.inquiry);
    const employee = receiverOf(l, nameOf);
    const assignee = nameOf.get(l.assigned_to ?? "") ?? l.assigned_to_name?.trim() ?? null;
    return visitDays(l).map((day) => ({
      id: l.id,
      day,
      bucket,
      kind: l.inquiry?.trim() || null,
      country: place.kind === "destination" ? place.country : null,
      city: place.kind === "destination" ? place.city : null,
      // the system's own «nothing said» («لم يحدد طلب», «-») is no place
      place: place.kind === "origin" ? place.place : place.kind === "none" && !NOTHING.test(text) ? text.slice(0, 40) || null : null,
      employee,
      assignee,
      note: null,
    }));
  });
}

export function applyEdits(requests: ReportRequest[], edits: Record<string, Edit>): ReportRequest[] {
  return requests.map((r) => {
    const conversation = edits[r.id];
    const visit = edits[visitKey(r)];
    if (!conversation && !visit) return r;
    const next = { ...r, ...conversation, ...visit };
    // a corrected receiver is the one the lines name for «لمن أُسند» too
    if (conversation && "employee" in conversation) next.assignee = conversation.employee ?? null;
    return next;
  });
}

// ---------------------------------------------------------------------------- period ----

export type PeriodKind = "day" | "week" | "month";
export type Period = { kind: PeriodKind; from: string; to: string };

export const shiftDay = (day: string, by: number): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

/** The day, the week (from Sunday, as «حصر الطلبات اليومية») or the month holding `anchor` — ending today when it is still running. */
export function periodOf(kind: PeriodKind, requested: string, today: string): Period {
  // never a day that has not come
  const anchor = requested > today ? today : requested;
  if (kind === "day") return { kind, from: anchor, to: anchor };
  if (kind === "week") {
    const from = shiftDay(anchor, -new Date(`${anchor}T12:00:00Z`).getUTCDay());
    return { kind, from, to: [shiftDay(from, 6), today].sort()[0] };
  }
  const from = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${from}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = shiftDay(next.toISOString().slice(0, 10), -1);
  return { kind, from, to: [last, today].sort()[0] };
}

/** the period before/after, as the pane's ‹ › move it */
export function movePeriod(p: Period, by: 1 | -1, today: string): Period {
  if (p.kind === "day") return periodOf("day", shiftDay(p.from, by), today);
  if (p.kind === "week") return periodOf("week", shiftDay(p.from, 7 * by), today);
  const d = new Date(`${p.from}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return periodOf("month", d.toISOString().slice(0, 10), today);
}

const WEEKDAYS = ["الاحد", "الاثنين", "الثلاثاء", "الاربعاء", "الخميس", "الجمعة", "السبت"];
// written as the staff write them, without the hamzas (the owner's own report: «اكتوبر»)
const MONTHS = ["يناير", "فبراير", "مارس", "ابريل", "مايو", "يونيو", "يوليو", "اغسطس", "سبتمبر", "اكتوبر", "نوفمبر", "ديسمبر"];

/** «الاثنين / 26 اكتوبر 2026» */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} / ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const shortDay = (day: string) => dayLabel(day).replace(" / ", " ");

// --------------------------------------------------------------------------- the report ----

export type Count = { name: string; count: number };
export type Line = { text: string; employee: string | null };
export type Report = {
  period: Period;
  total: number;
  counts: Record<BucketKey, number>;
  requests: ReportRequest[];
  /** the packages by who received them, each with the destinations it was asked for */
  packagesByEmployee: { name: string; count: number; destinations: string[] }[];
  packagesByDestination: Count[];
  /** the days of a week or a month */
  byDay: Count[];
  /** the departments (the buckets) and the employees, most first */
  topBuckets: Count[];
  topEmployees: Count[];
};

const NONE_EMPLOYEE = "غير مسند";
const NONE_DESTINATION = "غير محددة";
export const employeeName = (r: Pick<ReportRequest, "employee">) => r.employee?.trim() || NONE_EMPLOYEE;
/** where a request is: its city when it names one, else its country, else the place the client wrote */
export const placeOf = (r: Pick<ReportRequest, "country" | "city"> & { place?: string | null }) => r.city?.trim() || r.country?.trim() || r.place?.trim() || null;
/** whom a request is with: who it was given to, else who received it */
export const holderOf = (r: Pick<ReportRequest, "employee" | "assignee">) => r.assignee?.trim() || employeeName(r);
/**
 * what a line says about a request: the reviewer's note; for a package its destination only (a Saudi place is not one);
 * for the others their own kind — «رخص دولية» — or, moved there by hand, the kind they were; then where
 */
export const describe = (r: Pick<ReportRequest, "bucket" | "note" | "country" | "city" | "place" | "kind">): string | null => {
  if (r.note?.trim()) return r.note.trim();
  if (r.bucket === "package") return r.city?.trim() || r.country?.trim() || null;
  if (r.bucket === "other") return [r.kind === "رخص دولية" || !r.kind ? "رخص دولية" : r.kind, placeOf(r)].filter(Boolean).join(" ");
  return placeOf(r);
};

const tally = (names: string[]): Count[] => {
  const m = new Map<string, { name: string; count: number }>();
  for (const n of names) {
    const k = fold(n);
    const g = m.get(k) ?? { name: n, count: 0 };
    g.count += 1;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"));
};

export function buildReport(all: ReportRequest[], period: Period): Report {
  const requests = all.filter((r) => r.day >= period.from && r.day <= period.to).sort((a, b) => a.day.localeCompare(b.day));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, requests.filter((r) => r.bucket === b.key).length])) as Record<BucketKey, number>;
  const packages = requests.filter((r) => r.bucket === "package");
  const byEmployee = new Map<string, { name: string; count: number; destinations: string[] }>();
  for (const r of packages) {
    const name = employeeName(r);
    const g = byEmployee.get(fold(name)) ?? { name, count: 0, destinations: [] };
    g.count += 1;
    g.destinations.push(r.country?.trim() || NONE_DESTINATION);
    byEmployee.set(fold(name), g);
  }
  return {
    period,
    total: requests.length,
    counts,
    requests,
    packagesByEmployee: [...byEmployee.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar")),
    packagesByDestination: tally(packages.map((r) => r.country?.trim() || NONE_DESTINATION)),
    byDay: tally(requests.map((r) => r.day)).sort((a, b) => a.name.localeCompare(b.name)),
    topBuckets: BUCKETS.map((b) => ({ name: `${b.icon} ${b.label}`, count: counts[b.key] })).filter((b) => b.count > 0).sort((a, b) => b.count - a.count),
    topEmployees: tally(requests.map(employeeName)),
  };
}

// ------------------------------------------------------------------------------ text ----

const RULES = ["═════════════════", "══════════════════", "═══════════════════", "══════════════════"] as const;
const TITLE: Record<PeriodKind, string> = { day: "تقرير الطلبات اليومي", week: "تقرير الطلبات الأسبوعي", month: "تقرير الطلبات الشهري" };

function header(r: Report): string[] {
  const { kind, from, to } = r.period;
  const when = kind === "day" ? `🗓️ ${dayLabel(from)}` : `🗓️ من ${shortDay(from)} الى ${shortDay(to)}`;
  return [`📊 ${TITLE[kind]}`, when, RULES[0]];
}

const sub = (text: string, employee: string | null) => `_ ${text}${employee ? ` : ${employee}` : ""}`;

/** One employee's follow-up figures over the period — session C's «إشراف المتابعة» (followups/supervision), read, never recomputed. */
export type SupervisionLine = { name: string; due: number; done: number; overdue: number; compliance: number };
/** what the follow-up figures cover: the lines, the span they were read over, and whether the caller sees everyone's */
export type SupervisionFigures = { lines: SupervisionLine[]; days: number; all: boolean };

/** «متابعة الموظفين» — the lines the report adds when the follow-up figures are asked for. */
export function supervisionBlock(lines: SupervisionLine[], span?: string, partial = false): string[] {
  // the window is the supervision's own rolling one (its last N×24 hours), said as it is; and whose it covers
  const out = [`📋 متابعة الموظفين${span ? ` — ${span}` : ""}${partial ? " (حسب نطاق صلاحيتك)" : ""}`];
  if (lines.length === 0) out.push(partial ? "لا حالات ظاهرة لك" : "لا حالات متابعة في هذه الفترة");
  for (const l of lines) out.push(`🔹 ${l.name} : المستحق ${l.due} _ المنجز ${l.done} _ المتأخر ${l.overdue} _ الالتزام ${l.compliance}%`);
  out.push(RULES[3]);
  return out;
}

/**
 * The report as the staff paste it to management (WhatsApp / Telegram — plain text and symbols): the summary, the packages by
 * employee and by destination, hotels, transport, the others and the incomplete ones. A week or a month adds its days
 * and the departments and employees that received most; the follow-up figures follow when they are passed.
 */
export function reportText(r: Report, supervision?: SupervisionFigures | null): string {
  const c = r.counts;
  const by = (key: BucketKey) => r.requests.filter((x) => x.bucket === key);
  const out: string[] = [...header(r)];
  out.push("🔹ملخص الطلبات", `🔹إجمالي الطلبات : ${r.total}`);
  for (const key of ["package", "flight", "visa", "inquiry"] as const) out.push(`${BUCKET.get(key)!.icon} ${BUCKET.get(key)!.label} : ${c[key]}`);
  out.push(RULES[1]);

  out.push("👨🏻‍💼 البكجات المستلمة حسب الموظف");
  if (r.packagesByEmployee.length === 0) out.push("لا بكجات");
  for (const e of r.packagesByEmployee) out.push(`🔹 ${e.name} : العدد ${e.count}${e.destinations.map((d) => ` _ ${d}`).join("")}`);
  out.push(RULES[2]);

  out.push("📈 توزيع البكجات حسب الوجهة");
  if (r.packagesByDestination.length === 0) out.push("لا بكجات");
  for (const d of r.packagesByDestination) out.push(`${d.name} : ${d.count}`);
  out.push(RULES[3]);

  const hotels = by("hotel");
  out.push(`🏨 طلبات الفنادق : ${c.hotel}`);
  for (const h of hotels) out.push(sub(describe(h) ?? "فندق", holderOf(h)));
  const transport = by("transport");
  out.push(`🚘 مواصلات : ${c.transport}`);
  for (const t of transport) out.push(`${describe(t) ?? "مواصلات"} : ${holderOf(t)}`);
  out.push(RULES[3]);

  out.push(`🔸 طلبات اخرى : ${c.other}`);
  for (const o of by("other")) out.push(sub(describe(o) ?? "طلب آخر", holderOf(o)));
  out.push(RULES[3]);

  out.push(`🟣 الطلبات غير المكتملة : ${c.incomplete}`);
  for (const i of by("incomplete")) out.push(`_ طلب غير واضح${i.note?.trim() ? ` : ${i.note.trim()}` : ""}`);
  out.push(RULES[3]);

  if (r.period.kind !== "day") {
    out.push("📅 الطلبات حسب اليوم");
    for (const d of r.byDay) out.push(`${shortDay(d.name)} : ${d.count}`);
    out.push(RULES[3], "🏆 أكثر الأقسام طلباً");
    for (const b of r.topBuckets.slice(0, 5)) out.push(`${b.name} : ${b.count}`);
    out.push(RULES[3], "🏆 أكثر الموظفين استلاماً");
    for (const e of r.topEmployees.slice(0, 5)) out.push(`🔹 ${e.name} : ${e.count}`);
    out.push(RULES[3]);
  }
  if (supervision) out.push(...supervisionBlock(supervision.lines, supervision.days === 1 ? "آخر 24 ساعة" : `آخر ${supervision.days} أيام`, !supervision.all));
  return out.join("\n");
}

/** «حسب الموظف»: for each employee, what they received, by department. */
export function employeesText(r: Report): string {
  const out: string[] = [...header(r)];
  const people = tally(r.requests.map(employeeName));
  if (people.length === 0) out.push("لا طلبات", RULES[1]);
  for (const p of people) {
    const mine = r.requests.filter((x) => fold(employeeName(x)) === fold(p.name));
    out.push(`👨🏻‍💼 ${p.name} : ${p.count}`);
    for (const b of BUCKETS) {
      const of = mine.filter((x) => x.bucket === b.key);
      if (of.length === 0) continue;
      out.push(`${b.icon} ${b.label} : ${of.length}${b.key === "incomplete" ? "" : of.map((x) => ` _ ${describe(x) ?? "—"}`).join("")}`);
    }
    out.push(RULES[1]);
  }
  return out.join("\n");
}

/** «حسب القسم»: for each department, every request with its destination and who received it. */
export function departmentsText(r: Report): string {
  const out: string[] = [...header(r)];
  for (const b of BUCKETS) {
    const of = r.requests.filter((x) => x.bucket === b.key);
    out.push(`${b.icon} ${b.label} : ${of.length}`);
    for (const x of of) out.push(`🔹 ${describe(x) ?? (b.key === "incomplete" ? "طلب غير واضح" : "—")} : ${b.key === "package" || b.key === "incomplete" ? employeeName(x) : holderOf(x)}${r.period.kind === "day" ? "" : ` _ ${shortDay(x.day)}`}`);
    out.push(RULES[1]);
  }
  return out.join("\n");
}

/** «كل الطلبات»: one line each, oldest first. */
export function allRequestsText(r: Report): string {
  const out: string[] = [...header(r), `🔹 إجمالي الطلبات : ${r.total}`, RULES[1]];
  for (const x of r.requests) {
    const b = BUCKET.get(x.bucket)!;
    out.push(`${b.icon} ${shortDay(x.day)} _ ${b.label} _ ${describe(x) ?? "—"} _ ${employeeName(x)}`);
  }
  return out.join("\n");
}

/** The rows of the export — a spreadsheet's header first. */
export function exportRows(r: Report): string[][] {
  return [
    ["اليوم", "القسم", "الوجهة", "المدينة", "المكان", "الموظف المستلم", "لمن أُسند", "ملاحظة"],
    ...r.requests.map((x) => [x.day, BUCKET.get(x.bucket)!.label, x.country ?? "", x.city ?? "", x.place ?? "", employeeName(x), holderOf(x), x.note ?? ""]),
  ];
}

export const bucketLabel = (key: BucketKey) => BUCKET.get(key)!.label;

/**
 * The conversations to read the reason of next: the ones not read yet, and — after all of those — the ones Teletel could not
 * answer last time (a conversation with no Teletel thread must not hold the queue back, nor be forgotten).
 */
export function readQueue(ids: string[], tried: string[], failed: string[]): string[] {
  const unread = [...new Set(ids)].filter((id) => !tried.includes(id));
  return [...unread.filter((id) => !failed.includes(id)), ...unread.filter((id) => failed.includes(id))];
}
