import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { agentSummaries, listOpenConversations, type AgentSummary, type OpenConversation } from "@/lib/providers/teletel";
import { escapeHtml, staffCall, staffSend, type StaffMember } from "./staff-bot";
import { myNumbers, openFor, riyadhDayStart, secondsText, systemCounts, waitText, type MyNumbers } from "./staff-numbers";
import { teamAverages, type Team } from "./staff-report";
import { rememberThread, replyButtons } from "./staff-replies";
import type { InlineButton } from "./ops-bot";

/**
 * «🖥️ شاشتي» (the user, 2026-10-22: «يكون البوت كشاشة موظف يراقب اداءه
 * بالكامل»): the employee's own screen inside Telegram.
 *
 *   - the screen: one pinned message with now, today and all-time, and a light
 *     🟢🟡🔴. The minute job edits it every five minutes, so it is always current
 *     at the top of the chat;
 *   - the lists: every open conversation (paged), and the never-answered ones;
 *   - the week: the last seven days against the seven before, and the team mean;
 *   - the reminders: a client waiting 15 minutes, then 60, during working hours,
 *     once per wait.
 * Only ever the employee's own numbers. The team appears only as a mean.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const DAY = 86400;

export type ScreenView = { text: string; buttons: InlineButton[][] };

const nowMinutes = (since: number, nowSec: number) => Math.max(0, Math.floor((nowSec - since) / 60));

/** 🟢 nobody waits · 🟡 someone waits under half an hour · 🔴 a wait of 30 minutes or more, or a client never answered. */
export function light(n: Pick<MyNumbers, "waiting" | "neverAnswered" | "oldestWaitMin">): { icon: string; words: string } {
  if (n.neverAnswered > 0 || (n.oldestWaitMin ?? 0) >= 30) return { icon: "🔴", words: "عملاء ينتظرونك — ابدأ بالأقدم" };
  if (n.waiting > 0) return { icon: "🟡", words: "ردّ على من ينتظرك قريباً" };
  return { icon: "🟢", words: "ممتاز — لا أحد ينتظرك" };
}

/** Faster than the team (time) — a mark beside the number, not a score. */
const pace = (mine: number | null | undefined, team: number | null) => (mine && team ? (mine <= team ? " 🟢" : mine > team * 1.5 ? " 🔴" : " 🟡") : "");

export function dashboardText(name: string, n: MyNumbers, team: Team, extra: { issued: number; botReplies: number }, nowMs: number): string {
  const r = n.today.report;
  const status = light(n);
  const at = new Date(nowMs).toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });
  return [
    `🖥️ <b>شاشتي</b> — ${escapeHtml(name)}`,
    `${status.icon} ${status.words}`,
    "",
    "<b>━━ الآن ━━</b>",
    `📂 مفتوحة لك: <b>${n.open}</b>`,
    `⏳ بانتظار ردك: <b>${n.waiting}</b>${n.oldestWaitMin != null ? ` · الأقدم منذ ${waitText(n.oldestWaitMin)}` : ""}`,
    `🆕 لم يُرد عليها أبداً: <b>${n.neverAnswered}</b>`,
    "",
    "<b>━━ اليوم ━━</b>",
    `📥 تحويلات وصلتك: <b>${n.today.assigned}</b>`,
    `💬 محادثات: <b>${r?.conversations ?? 0}</b> · ✅ أغلقت: <b>${r?.resolved ?? 0}</b>`,
    `⚡ أول رد: <b>${secondsText(r?.firstResponseSec)}</b>${pace(r?.firstResponseSec, team.firstResponseSec)} (الفريق ${secondsText(team.firstResponseSec)})`,
    `↩️ الرد: <b>${secondsText(r?.replySec)}</b>${pace(r?.replySec, team.replySec)} (الفريق ${secondsText(team.replySec)})`,
    `📄 ملفات أصدرتها: <b>${extra.issued}</b>${extra.botReplies ? ` · ردود من البوت: <b>${extra.botReplies}</b>` : ""}`,
    "",
    "<b>━━ الإجمالي ━━</b>",
    `🗂️ كل محادثاتك: <b>${n.total ?? "—"}</b> · مغلقة: <b>${n.closed ?? "—"}</b>`,
    "",
    `<i>يتحدّث تلقائياً كل ٥ دقائق · آخر تحديث ${at}</i>`,
  ].join("\n");
}

export const SCREEN_BUTTONS: InlineButton[][] = [
  [{ text: "⏳ بانتظار ردي", callback_data: "w" }, { text: "🆕 بلا رد", callback_data: "u" }],
  [{ text: "📂 محادثاتي المفتوحة", callback_data: "o:0" }, { text: "🔄 تحديث", callback_data: "s" }],
  [{ text: "📈 أدائي اليوم", callback_data: "d" }, { text: "📅 أدائي الأسبوع", callback_data: "wk" }],
];

/** The screen's text for one employee. `summaries` is today's report when the caller read it for everyone. */
export async function screenView(me: StaffMember, nowMs = Date.now(), summaries?: Map<number, AgentSummary> | null): Promise<ScreenView | null> {
  if (!me.agentId) return null;
  const since = riyadhDayStart(nowMs);
  const all = summaries === undefined ? await agentSummaries(since, Math.floor(nowMs / 1000)) : summaries;
  const [n, extra] = await Promise.all([myNumbers(me.agentId, nowMs, all), systemCounts(me.id, since)]);
  return n ? { text: dashboardText(me.name, n, teamAverages(all), extra, nowMs), buttons: SCREEN_BUTTONS } : null;
}

/** «🖥️ شاشتي» from the keyboard: a fresh screen, pinned silently. The previous one is removed, and the minute job keeps the new one current. */
export async function openScreen(me: StaffMember, chatId: number, fallback: ScreenView): Promise<void> {
  const view = (await screenView(me)) ?? fallback;
  const sent = await staffSend(chatId, view.text, view.buttons);
  if (!sent.ok || !me.agentId) return;
  const { data } = await db().from("staff_bot_screens").select("message_id").eq("employee_id", me.id).maybeSingle();
  const previous = (data as { message_id: number } | null)?.message_id;
  if (previous) await staffCall("deleteMessage", { chat_id: chatId, message_id: previous });
  await staffCall("pinChatMessage", { chat_id: chatId, message_id: sent.messageId, disable_notification: true });
  await db().from("staff_bot_screens").upsert({ employee_id: me.id, chat_id: chatId, message_id: sent.messageId, updated_at: new Date().toISOString() });
}

/** The minute job, every fifth minute: each pinned screen edited in place. A screen the employee deleted is forgotten. */
export async function refreshScreens(nowMs = Date.now()): Promise<{ refreshed: number } | null> {
  if (Math.floor(nowMs / 60_000) % 5 !== 0) return null;
  const { data } = await db().from("staff_bot_screens").select("employee_id, chat_id, message_id, employees(arabic_name, status, teletel_agent_id)");
  type Row = { employee_id: string; chat_id: number; message_id: number; employees: { arabic_name: string; status: string | null; teletel_agent_id: number | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.employees && (r.employees.status ?? "Active") === "Active" && r.employees.teletel_agent_id);
  if (!rows.length) return { refreshed: 0 };
  const summaries = await agentSummaries(riyadhDayStart(nowMs), Math.floor(nowMs / 1000));
  let refreshed = 0;
  for (const r of rows) {
    const me = { id: r.employee_id, name: r.employees?.arabic_name ?? "", chatId: Number(r.chat_id), agentId: r.employees?.teletel_agent_id ?? null };
    const view = await screenView(me, nowMs, summaries);
    if (!view) continue;
    const edit = await staffCall("editMessageText", {
      chat_id: r.chat_id,
      message_id: r.message_id,
      text: view.text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: view.buttons },
    });
    if (edit.ok) refreshed += 1;
    else if (/not found|can't be edited/i.test(edit.description ?? "")) await db().from("staff_bot_screens").delete().eq("employee_id", r.employee_id);
  }
  return { refreshed };
}

const PAGE = 8;

function rowLabel(c: OpenConversation, nowSec: number): string {
  const name = c.name.slice(0, 26);
  if (!c.firstReplyAt) return `🆕 ${name} — منذ ${waitText(nowMinutes(c.createdAt, nowSec))}`;
  if (c.waitingSince > 0) return `⏳ ${name} — ينتظرك ${waitText(nowMinutes(c.waitingSince, nowSec))}`;
  return `✓ ${name}`;
}

/** «📂 محادثاتي المفتوحة», eight a page, waiting ones first. */
export async function openList(me: StaffMember, page: number): Promise<ScreenView | null> {
  if (!me.agentId) return null;
  const open = await openFor(me.agentId);
  if (!open) return null;
  const pages = Math.max(1, Math.ceil(open.length / PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const nowSec = Date.now() / 1000;
  const nav: InlineButton[] = [];
  if (p > 0) nav.push({ text: "◀️ السابق", callback_data: `o:${p - 1}` });
  if (p < pages - 1) nav.push({ text: "التالي ▶️", callback_data: `o:${p + 1}` });
  return {
    text: open.length
      ? `📂 <b>محادثاتك المفتوحة</b> — ${open.length}\nصفحة ${p + 1} من ${pages} · ⏳ ينتظرك · 🆕 لم يُرد عليها · ✓ رددت\nاضغط على العميل لترى آخر رسائله وترد.`
      : "📂 لا محادثات مفتوحة لك الآن.",
    buttons: [
      ...open.slice(p * PAGE, p * PAGE + PAGE).map((c) => [{ text: rowLabel(c, nowSec), callback_data: `c:${c.id}` }]),
      ...(nav.length ? [nav] : []),
      [{ text: "↩️ شاشتي", callback_data: "s" }],
    ],
  };
}

/** «🆕 بلا رد»: the conversations nobody has answered yet, oldest first. */
export async function unansweredList(me: StaffMember): Promise<ScreenView | null> {
  if (!me.agentId) return null;
  const open = await openFor(me.agentId);
  if (!open) return null;
  const nowSec = Date.now() / 1000;
  const list = open.filter((c) => !c.firstReplyAt).sort((a, b) => a.createdAt - b.createdAt);
  return {
    text: list.length ? `🆕 <b>لم يُرد عليها أبداً</b> — ${list.length}\nالأقدم أولاً — أول رد سريع يصنع الفرق.` : "✅ كل محادثاتك فيها رد منك.",
    buttons: [...list.slice(0, 10).map((c) => [{ text: rowLabel(c, nowSec), callback_data: `c:${c.id}` }]), [{ text: "↩️ شاشتي", callback_data: "s" }]],
  };
}

/** ▲ more / ▼ less for counts. For times, lower is better, and it says so. */
function trend(now: number | null | undefined, before: number | null | undefined, lowerIsBetter = false): string {
  if (now == null || before == null || now === before) return "";
  const up = now > before;
  const good = lowerIsBetter ? !up : up;
  return ` ${up ? "▲" : "▼"}${good ? " أفضل" : ""}`;
}

/** «📅 أدائي الأسبوع»: the last seven days against the seven before them, from Teletel's report and the system. */
export async function weekView(me: StaffMember, nowMs = Date.now()): Promise<ScreenView | null> {
  if (!me.agentId) return null;
  const now = Math.floor(nowMs / 1000);
  const [thisWeek, lastWeek, mine, before] = await Promise.all([
    agentSummaries(now - 7 * DAY, now),
    agentSummaries(now - 14 * DAY, now - 7 * DAY),
    systemCounts(me.id, now - 7 * DAY),
    systemCounts(me.id, now - 14 * DAY, now - 7 * DAY),
  ]);
  if (!thisWeek) return null;
  const a = thisWeek.get(me.agentId);
  const b = lastWeek?.get(me.agentId);
  const team = teamAverages(thisWeek);
  return {
    text: [
      "📅 <b>أداؤك آخر ٧ أيام</b>",
      "<i>بين قوسين: الأسبوع الذي قبله</i>",
      "",
      `💬 محادثات: <b>${a?.conversations ?? 0}</b> (${b?.conversations ?? 0})${trend(a?.conversations, b?.conversations)}`,
      `✅ أغلقت: <b>${a?.resolved ?? 0}</b> (${b?.resolved ?? 0})${trend(a?.resolved, b?.resolved)}`,
      `⚡ أول رد: <b>${secondsText(a?.firstResponseSec)}</b> (${secondsText(b?.firstResponseSec)})${trend(a?.firstResponseSec, b?.firstResponseSec, true)} — الفريق ${secondsText(team.firstResponseSec)}`,
      `↩️ الرد: <b>${secondsText(a?.replySec)}</b> (${secondsText(b?.replySec)})${trend(a?.replySec, b?.replySec, true)} — الفريق ${secondsText(team.replySec)}`,
      `📄 ملفات أصدرتها: <b>${mine.issued}</b> (${before.issued})${trend(mine.issued, before.issued)}`,
      mine.botReplies ? `🤖 ردود من البوت: <b>${mine.botReplies}</b>` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    buttons: [[{ text: "📈 أدائي اليوم", callback_data: "d" }, { text: "↩️ شاشتي", callback_data: "s" }]],
  };
}

/** 09:00–23:00 Riyadh, the reception's hours: a reminder at three in the morning helps nobody. */
const WORK_HOURS = [9, 23] as const;
const LEVELS = [
  { level: 15, until: 60 },
  { level: 60, until: 180 },
] as const;

/**
 * «⏰ ينتظر ردك»: a client waiting 15 minutes, and again at 60, during working
 * hours. A wait already past three hours is not news to anyone (it is on
 * «بانتظار ردي» and in the evening report), so it is not reminded. That is also
 * why the first run after a deploy cannot flood anyone with old waits.
 */
export async function remindWaiting(nowMs = Date.now()): Promise<{ reminded: number } | null> {
  const hour = new Date(nowMs + 3 * 3600_000).getUTCHours();
  if (hour < WORK_HOURS[0] || hour >= WORK_HOURS[1]) return null;
  const list = await listOpenConversations();
  if (!list) return null;
  const nowSec = nowMs / 1000;
  const due = list.rows
    .filter((c) => c.assigneeId && c.waitingSince > 0)
    .map((c) => ({ c, minutes: nowMinutes(c.waitingSince, nowSec) }))
    .map(({ c, minutes }) => ({ c, minutes, step: LEVELS.find((l) => minutes >= l.level && minutes < l.until) }))
    .filter((x): x is { c: OpenConversation; minutes: number; step: (typeof LEVELS)[number] } => Boolean(x.step));
  if (!due.length) return { reminded: 0 };

  const agents = [...new Set(due.map((d) => d.c.assigneeId as number))];
  const { data } = await db().from("employees").select("telegram_chat_id, teletel_agent_id").eq("status", "Active").in("teletel_agent_id", agents).not("telegram_chat_id", "is", null);
  const chatOf = new Map(((data ?? []) as { telegram_chat_id: number | string; teletel_agent_id: number }[]).map((e) => [e.teletel_agent_id, Number(e.telegram_chat_id)]));

  let reminded = 0;
  for (const { c, minutes, step } of due) {
    const chatId = chatOf.get(c.assigneeId as number);
    if (!chatId) continue;
    const { data: claimed } = await db()
      .from("staff_bot_reminders")
      .upsert({ conversation_id: c.id, waiting_since: c.waitingSince, level: step.level }, { onConflict: "conversation_id,waiting_since,level", ignoreDuplicates: true })
      .select("level");
    if (!claimed?.length) continue;
    const sent = await staffSend(
      chatId,
      [`⏰ <b>${escapeHtml(c.name)}</b> ينتظر ردك منذ ${waitText(minutes)}`, c.preview.trim() ? `💬 «${escapeHtml(c.preview.trim().slice(0, 200))}»` : null].filter(Boolean).join("\n"),
      replyButtons(c.id),
    );
    if (sent.ok) {
      await rememberThread(chatId, sent.messageId, c.id);
      reminded += 1;
    }
  }
  return { reminded };
}
