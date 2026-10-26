/**
 * «⏳ المحادثات المنتظرة» — the administration's view of every client waiting
 * for a reply (the owner, 2026-10-26: «المحادثات التي بانتظار الرد لدى الإدارة
 * يجب أن يطلع على المحادثات عبر البوت، وكذلك عند من المحادثة، ويمكن أن يرسل
 * تنبيه للموظف»). The oldest first, red and amber by the manager screen's own
 * limits, fifteen to a page; a conversation opens read-only; a nudge goes to the
 * employee (or, with nobody on it, to the sales team online) — never to the client.
 *
 * Pure: the rows, the limits and the clock are parameters.
 */

import type { InlineButton } from "./ops-bot";
import { BACK_ADMIN } from "./staff-admin-core";

export const WAIT_PAGE = 15;
/** one nudge per employee per conversation in this window */
export const NUDGE_EVERY_MIN = 15;

export type WaitFilter = { kind: "all" } | { kind: "red" } | { kind: "none" } | { kind: "emp"; id: string };
export type WaitRow = {
  id: number;
  name: string;
  minutes: number;
  /** the Teletel agent holding it, null when nobody does */
  agentId: number | null;
  /** the colleague behind that agent; null when the agent is no employee of ours (a shared account) */
  employeeId: string | null;
  /** who holds it, as the manager knows them: the colleague's name, else Teletel's name for the agent */
  holder: string | null;
};
export type Limits = { waitAmberMin: number; waitRedMin: number };
export type Tone = "red" | "amber" | "plain";

export const toneOf = (minutes: number, t: Limits): Tone => (minutes >= t.waitRedMin ? "red" : minutes >= t.waitAmberMin ? "amber" : "plain");
const DOT: Record<Tone, string> = { red: "🔴", amber: "🟠", plain: "⚪" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «aw:all:0» · «aw:red:2» · «aw:none:0» · «aw:e:<employee>:1» — anything else is not ours */
export function parseWaitData(data: string): { filter: WaitFilter; page: number } | null {
  const p = data.split(":");
  if (p[0] !== "aw") return null;
  const page = Number(p[p.length - 1]);
  if (!Number.isInteger(page) || page < 0 || page > 999) return null;
  if (p.length === 3 && (p[1] === "all" || p[1] === "red" || p[1] === "none")) return { filter: { kind: p[1] }, page };
  if (p.length === 4 && p[1] === "e" && UUID.test(p[2])) return { filter: { kind: "emp", id: p[2] }, page };
  return null;
}
export const waitData = (f: WaitFilter, page: number) => (f.kind === "emp" ? `aw:e:${f.id}:${page}` : `aw:${f.kind}:${page}`);

/** the filter's rows, the longest wait first */
export function pickWaiting(rows: WaitRow[], f: WaitFilter, t: Limits): WaitRow[] {
  const keep = (r: WaitRow) =>
    f.kind === "red" ? toneOf(r.minutes, t) === "red" : f.kind === "none" ? r.agentId === null : f.kind === "emp" ? r.employeeId === f.id : true;
  return rows.filter(keep).sort((a, b) => b.minutes - a.minutes || a.id - b.id);
}

export function filterLabel(f: WaitFilter, employeeName: string | null): string {
  return f.kind === "red" ? "الأحمر فقط" : f.kind === "none" ? "بلا موظف" : f.kind === "emp" ? `لدى ${employeeName ?? "موظف"}` : "الكل";
}

export function waitListView(input: {
  rows: WaitRow[];
  all: number;
  filter: WaitFilter;
  label: string;
  page: number;
  t: Limits;
  waitText: (min: number) => string;
  escape: (s: string) => string;
}): { text: string; buttons: InlineButton[][] } {
  const { rows, filter, t, waitText, escape } = input;
  const pages = Math.max(1, Math.ceil(rows.length / WAIT_PAGE));
  const page = Math.min(input.page, pages - 1);
  const shown = rows.slice(page * WAIT_PAGE, page * WAIT_PAGE + WAIT_PAGE);
  const red = rows.filter((r) => toneOf(r.minutes, t) === "red").length;
  const text = [
    `⏳ <b>المحادثات المنتظرة</b> — ${rows.length}${filter.kind === "all" ? "" : ` من ${input.all}`}`,
    `${red} 🔴 فوق ${t.waitRedMin} د · 🟠 فوق ${t.waitAmberMin} د · الأقدم أولاً`,
    `العرض: ${escape(input.label)}`,
    "",
    ...(shown.length
      ? shown.map(
          (r, i) =>
            `${page * WAIT_PAGE + i + 1}. ${DOT[toneOf(r.minutes, t)]} <b>${escape(r.name)}</b> — منذ ${waitText(r.minutes)} — عند: ${r.holder ? escape(r.holder) : "بلا موظف"}`,
        )
      : ["لا محادثة تنتظر الرد هنا الآن ✅"]),
    ...(pages > 1 ? ["", `صفحة ${page + 1} من ${pages}`] : []),
    "",
    "اضغط رقم المحادثة لتقرأها وتنبّه من عنده.",
  ].join("\n");
  const open = shown.map((r, i) => ({ text: `${page * WAIT_PAGE + i + 1}. ${r.name.slice(0, 14)}`, callback_data: `av:${r.id}` }));
  const buttons: InlineButton[][] = [
    ...Array.from({ length: Math.ceil(open.length / 3) }, (_, i) => open.slice(i * 3, i * 3 + 3)),
    [
      { text: filter.kind === "all" ? "• الكل" : "الكل", callback_data: waitData({ kind: "all" }, 0) },
      { text: filter.kind === "red" ? "• 🔴 الأحمر" : "🔴 الأحمر", callback_data: waitData({ kind: "red" }, 0) },
      { text: filter.kind === "none" ? "• بلا موظف" : "بلا موظف", callback_data: waitData({ kind: "none" }, 0) },
      { text: filter.kind === "emp" ? "• 👤 لدى موظف" : "👤 لدى موظف", callback_data: "awp" },
    ],
    ...(pages > 1
      ? [
          [
            ...(page > 0 ? [{ text: "▶️ السابق", callback_data: waitData(filter, page - 1) }] : []),
            ...(page < pages - 1 ? [{ text: "التالي ◀️", callback_data: waitData(filter, page + 1) }] : []),
          ],
        ]
      : []),
    [{ text: "🔄 تحديث", callback_data: waitData(filter, page) }, BACK_ADMIN],
  ];
  return { text, buttons };
}

/** a message as the manager reads it: the client, a colleague, Murad — and a private note, marked as one */
export type ManagerLine = { id: number; at: number; text: string; fromClient: boolean; sender: string | null; isPrivate: boolean };

export function managerThreadText(
  client: string,
  lines: ManagerLine[],
  muradIds: Set<number>,
  when: (atSec: number) => string,
  escape: (s: string) => string,
): string {
  if (!lines.length) return "— لا رسائل —";
  return lines
    .map((m) => {
      const who = m.isPrivate
        ? `📝 <b>ملاحظة داخلية — ${escape(m.sender?.trim() || "الفريق")}</b>`
        : m.fromClient
          ? `👤 <b>العميل — ${escape(client)}</b>`
          : muradIds.has(m.id)
            ? "🤖 <b>مُراد (رد آلي)</b>"
            : `🟢 <b>${escape(m.sender?.trim() || "ترافليون")}</b>`;
      return `${who} · ${when(m.at)}\n${escape(m.text.slice(0, 400))}`;
    })
    .join("\n┈┈┈┈┈┈┈┈\n");
}

/**
 * What reaches the employee: the client's NAME and the wait — nothing of the
 * conversation itself, so no internal note can travel anywhere from here.
 */
export const nudgeContent = (client: string, minutes: number, waitText: (min: number) => string) =>
  `العميل ${client} ينتظر ردّك منذ ${waitText(minutes)} — افتحها من «⏳ بانتظار ردي».`;
export const teamNudgeContent = (client: string, minutes: number, waitText: (min: number) => string) =>
  `عميل ينتظر الرد بلا موظف منذ ${waitText(minutes)}: ${client}. من يتسلّمه يفتحه من تيلي تيل.`;

/** minutes since the last nudge about this conversation to this person, when still inside the window; null = may nudge */
export function nudgedRecently(lastAtMs: number | null, nowMs: number): number | null {
  if (lastAtMs === null) return null;
  const ago = Math.max(0, Math.floor((nowMs - lastAtMs) / 60_000));
  return ago < NUDGE_EVERY_MIN ? ago : null;
}
export const nudgedText = (ago: number) => `نُبِّه قبل ${ago < 1 ? "أقل من دقيقة" : `${ago} دقيقة`} — يمكن التنبيه مرة كل ${NUDGE_EVERY_MIN} دقيقة.`;
