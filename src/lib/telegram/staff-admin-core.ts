/**
 * «🏢 لوحة الإدارة» — what «تنبيهاتي» shows its managers (the owner, 2026-10-26:
 * «واجهته للإدارة إدارية وليس مثل واجهة الموظفين»): a keyboard of its own, and
 * screens of figures, not conversation lists. Numbers first, short lines, one
 * status dot per section, and «↩️ لوحة الإدارة» on every screen.
 *
 * Pure: the screens are built from facts the server read (staff-admin.ts) — the
 * manager screen's own snapshot, the operations digest, the visa board.
 */

import type { InlineButton } from "./ops-bot";

export const ADMIN_TITLE = "🏢 <b>لوحة الإدارة — ترافليون ون</b>";

/** the administration's keyboard, by what each key opens; the labels are what Telegram sends back */
export const ADMIN_KEYS = {
  day: "🏢 لوحة اليوم",
  waiting: "⏳ المحادثات المنتظرة",
  urgent: "🚨 يحتاج تدخلك",
  decisions: "📋 قرارات الإدارة",
  team: "👥 الفريق",
  performance: "📈 الأداء والأهداف",
  money: "💰 المال والتحصيل",
  broadcast: "📢 إعلان عام",
  decree: "📜 إصدار قرار",
  alert: "🔔 نبّه موظفاً",
  leave: "🏖️ منح إجازة",
  ops: "🧭 العمليات والتأشيرات",
  system: "🔌 النظام",
  toStaff: "👤 واجهة الموظف",
} as const;
export type AdminKey = keyof typeof ADMIN_KEYS;
/** on the employee's keyboard of a manager: back to the administration's */
export const TO_ADMIN = "🏢 واجهة الإدارة";

export const BACK_ADMIN: InlineButton = { text: "↩️ لوحة الإدارة", callback_data: "ad" };

/** `money`: «المال والتحصيل» only for who holds it */
export function adminRows(money: boolean): string[][] {
  const k = ADMIN_KEYS;
  return [
    [k.day, k.waiting],
    [k.urgent, k.decisions],
    [k.team, k.performance],
    money ? [k.money, k.alert] : [k.alert],
    [k.broadcast, k.decree, k.leave],
    [k.ops, k.system],
    [k.toStaff],
  ];
}

export type Face = "admin" | "staff";
/** a manager's last choice; anything else (nothing stored yet) is the administration's */
export const parseFace = (v: string | null | undefined): Face => (v === "staff" ? "staff" : "admin");

export type Status = "green" | "amber" | "red";
const DOT: Record<Status, string> = { green: "🟢", amber: "🟡", red: "🔴" };
export const dot = (s: Status | undefined) => (s ? DOT[s] : "⚪");
const nf = (n: number) => n.toLocaleString("en-US");

/** what the day screen reads of the manager snapshot: each panel's status and its tiles by key */
export type PanelFacts = Record<string, { status: Status; tiles: Record<string, { label: string; value: string; reason: string; status: Status }> }>;
export type OpsFacts = {
  liveCases: number;
  needsAction: number;
  critical: number;
  travelSoon: number;
  travelIncomplete: number;
  unpaid: number;
  urgent: { serial: string; customer: string | null; worst: string }[];
};
export type VisaFacts = {
  open: number;
  byStatus: Record<"new" | "collecting" | "ready" | "submitted" | "approved", number>;
  replyOverdue: number;
  actionDue: number;
  missingDocs: number;
  toDeliver: number;
  unpaid: { files: number; due: Record<string, number> };
};

const v = (p: PanelFacts, panel: string, key: string, fallback = "—") => p[panel]?.tiles[key]?.value ?? fallback;
const r = (p: PanelFacts, panel: string, key: string) => p[panel]?.tiles[key]?.reason ?? "";

function when(nowMs: number): string {
  const d = new Date(nowMs + 3 * 3600_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)} · ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

const OVERALL: Record<Status, string> = { red: "🔴 تحتاج تدخلاً", amber: "🟡 تحت المتابعة", green: "🟢 مستقرة" };

/** «🏢 لوحة اليوم»: the headline of every section, figures only */
export function dayText(input: {
  overall: Status;
  panels: PanelFacts;
  longestWaitMin: number | null;
  urgent: number;
  watch: number;
  ops: OpsFacts | null;
  visas: VisaFacts | null;
  nowMs: number;
  waitText: (min: number) => string;
}): string {
  const { panels: p, ops, visas } = input;
  const st = (k: string) => dot(p[k]?.status);
  const lines = [
    ADMIN_TITLE,
    `${when(input.nowMs)} · الحالة: ${OVERALL[input.overall]}`,
    "",
    `${st("conversations")} <b>المحادثات</b>`,
    `${v(p, "conversations", "today")} اليوم · ${v(p, "conversations", "open")} مفتوحة · ${v(p, "conversations", "closed")} مغلقة`,
    `${v(p, "conversations", "waiting")} بانتظار الرد${input.longestWaitMin !== null ? ` · أقدمها ${input.waitText(input.longestWaitMin)}` : ""} · ${v(p, "conversations", "unassigned")} بلا موظف`,
    `متوسط أول رد: ${v(p, "conversations", "first_reply")}`,
    "",
    `${st("sales")} <b>المبيعات</b>`,
    `${v(p, "sales", "files")} ملف اليوم · ${v(p, "sales", "issued")} عرض صدر · ${v(p, "sales", "sent")} أُرسل · ${v(p, "sales", "confirmed")} تأكد`,
    "",
    `${st("operations")} <b>العمليات</b>`,
    ops
      ? `${nf(ops.liveCases)} ملف جارٍ · ${nf(ops.needsAction)} يحتاج إجراء · ${v(p, "operations", "travel")} سفر اليوم أو غداً · ${v(p, "operations", "payment")} دفعة مستحقة`
      : `${v(p, "operations", "live")} ملف جارٍ · ${v(p, "operations", "travel")} سفر اليوم أو غداً · ${v(p, "operations", "payment")} دفعة مستحقة`,
    "",
    `${visas ? dot(visas.replyOverdue || visas.actionDue ? "amber" : "green") : "⚪"} <b>التأشيرات</b>`,
    visas
      ? `${nf(visas.open)} مفتوح · ${nf(visas.byStatus.new)} جديد · ${nf(visas.byStatus.submitted)} بانتظار الرد · ${nf(visas.replyOverdue + visas.actionDue)} متأخر · ${nf(visas.unpaid.files)} غير مسدد`
      : "تعذّرت قراءة ملفات التأشيرات الآن.",
    "",
    `${st("team")} <b>الفريق</b>`,
    `${v(p, "team", "teletel")} متصل · أول رد للفريق ${v(p, "team", "team_reply")}`,
    "",
    `${st("system")} <b>النظام</b>`,
    `الربط الخارجي: ${v(p, "system", "integrations")} · آخر نسخة: ${r(p, "system", "backup") || v(p, "system", "backup")}`,
    "",
    input.urgent ? `🚨 <b>${input.urgent}</b> أمر يحتاج تدخلك · ${input.watch} تحت المتابعة` : `لا شيء يحتاج تدخلك الآن · ${input.watch} تحت المتابعة`,
  ];
  return lines.join("\n");
}

export const DAY_BUTTONS: InlineButton[][] = [
  [
    { text: "⏳ المحادثات المنتظرة", callback_data: "aw:all:0" },
    { text: "🚨 يحتاج تدخلك", callback_data: "si" },
  ],
  [
    { text: "👥 الفريق", callback_data: "at" },
    { text: "🧭 العمليات والتأشيرات", callback_data: "ao" },
  ],
  [
    { text: "🔌 النظام", callback_data: "as" },
    { text: "🔄 تحديث", callback_data: "ad" },
  ],
];

export type MemberRow = {
  id: string;
  name: string;
  presence: "online" | "busy" | "offline" | null;
  open: number;
  waiting: number;
  oldestMin: number | null;
  /** today's first-reply average in minutes, as the manager screen reads it */
  firstReplyMin: number | null;
  resolved: number;
};
const PRESENCE: Record<NonNullable<MemberRow["presence"]>, string> = { online: "🟢", busy: "🟡", offline: "⚪" };

/** a first-reply average: «أقل من دقيقة» rather than «0 د» */
export const minutesWord = (min: number) => (min < 1 ? "أقل من دقيقة" : `${Math.round(min)} د`);

/** «👥 الفريق» for the administration: each colleague in one line, the most waited-on first; `idle` more have nothing open and are away */
export function teamText(rows: MemberRow[], waitText: (min: number) => string, idle = 0): string {
  const online = rows.filter((x) => x.presence === "online" || x.presence === "busy").length;
  return [
    `👥 <b>الفريق الآن</b> — ${online} متصل`,
    `${nf(rows.reduce((t, x) => t + x.open, 0))} مفتوحة · ${nf(rows.reduce((t, x) => t + x.waiting, 0))} منتظرة · ${nf(rows.reduce((t, x) => t + x.resolved, 0))} أُغلقت اليوم`,
    "",
    ...rows.map(
      (x) =>
        `${x.presence ? PRESENCE[x.presence] : "⚪"} <b>${x.name}</b> — ${x.open} مفتوحة · ${x.waiting} منتظرة${x.oldestMin !== null ? ` (أقدمها ${waitText(x.oldestMin)})` : ""}${x.firstReplyMin !== null ? ` · أول رد اليوم ${minutesWord(x.firstReplyMin)}` : ""}`,
    ),
    ...(idle ? [`و${idle} غير متصلين ولا محادثات مفتوحة معهم.`] : []),
    "",
    "🟢 متصل · 🟡 مشغول · ⚪ غير متصل. اضغط الاسم لتفتح لوحته.",
  ].join("\n");
}

/** «💰 المال والتحصيل»: figures the administration already sees in the system — selling side only, never a cost */
export function moneyText(p: PanelFacts, ops: OpsFacts | null, visas: VisaFacts | null): string {
  const due = visas ? Object.entries(visas.unpaid.due).filter(([, n]) => n > 0) : [];
  return [
    "💰 <b>المال والتحصيل</b>",
    "",
    ops ? `${nf(ops.unpaid)} ملف مؤكد لم يُسدَّد بالكامل` : "تعذّرت قراءة ملفات العمليات الآن.",
    `${v(p, "operations", "payment")} دفعة مستحقة اليوم أو غداً · ${v(p, "operations", "deadline")} مهلة إلغاء مجاني تنتهي`,
    `${v(p, "sales", "confirmed")} حجز تأكد اليوم`,
    visas
      ? `التأشيرات: ${nf(visas.unpaid.files)} ملف غير مسدد${due.length ? ` — المستحق ${due.map(([c, n]) => `${nf(Math.round(n))} ${c}`).join(" · ")}` : ""}`
      : null,
    "",
    `إنفاق الإعلانات اليوم: ${v(p, "ads", "spend")} · تكلفة المحادثة ${v(p, "ads", "cost_per_conversation")}`,
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
}

/** «🧭 العمليات والتأشيرات»: the two boards' counters, and the five files that need a hand first */
export function opsVisaText(ops: OpsFacts | null, visas: VisaFacts | null, escape: (s: string) => string): string {
  const lines = ["🧭 <b>العمليات والتأشيرات</b>", "", "<b>العمليات</b>"];
  if (ops) {
    lines.push(`${nf(ops.liveCases)} ملف جارٍ · ${nf(ops.needsAction)} يحتاج إجراء (${nf(ops.critical)} عاجل)`);
    lines.push(`${nf(ops.travelSoon)} يسافر خلال 7 أيام · ${nf(ops.travelIncomplete)} منها حجوزاته ناقصة`);
    lines.push(`${nf(ops.unpaid)} لم يُسدَّد بالكامل`);
    if (ops.urgent.length)
      lines.push(
        "",
        "يبدأ بها:",
        ...ops.urgent.map((c) => `• <code>${escape(c.serial)}</code> ${escape(c.customer ?? "—")}${c.worst ? ` — ${escape(c.worst)}` : ""}`),
      );
  } else lines.push("تعذّرت قراءة ملفات العمليات الآن.");
  lines.push("", "<b>التأشيرات</b>");
  if (visas) {
    const s = visas.byStatus;
    lines.push(`${nf(visas.open)} مفتوح: ${nf(s.new)} جديد · ${nf(s.collecting)} جمع مستندات · ${nf(s.ready)} جاهز للتقديم · ${nf(s.submitted)} بانتظار الرد`);
    lines.push(`${nf(visas.replyOverdue)} تأخر ردّه · ${nf(visas.actionDue)} إجراء مستحق · ${nf(visas.missingDocs)} مستندات ناقصة`);
    lines.push(`${nf(s.approved)} صدرت · ${nf(visas.toDeliver)} بانتظار التسليم · ${nf(visas.unpaid.files)} غير مسدد`);
  } else lines.push("تعذّرت قراءة ملفات التأشيرات الآن.");
  return lines.join("\n");
}

/** «🔌 النظام»: the external links and the backup, in words — never a variable's name */
export function systemText(p: PanelFacts): string {
  const sys = p.system?.tiles ?? {};
  const bad = Object.entries(sys).filter(([, t]) => t.status !== "green");
  return [
    `${dot(p.system?.status)} <b>النظام</b>`,
    "",
    `الربط الخارجي: ${v(p, "system", "integrations")}${r(p, "system", "integrations") ? ` — ${r(p, "system", "integrations")}` : ""}`,
    `النسخة الاحتياطية: ${v(p, "system", "backup")}${r(p, "system", "backup") ? ` — ${r(p, "system", "backup")}` : ""}`,
    `بيانات الإعلانات: ${v(p, "system", "ads_feed")}`,
    ...(bad.length ? ["", "<b>ما يحتاج انتباهاً:</b>", ...bad.map(([, t]) => `${dot(t.status)} ${t.label}: ${t.value} — ${t.reason}`)] : ["", "كل شيء يعمل."]),
  ].join("\n");
}
