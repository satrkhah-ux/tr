import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { agentSummaries, listOpenConversations, type AgentSummary, type OpenConversation } from "@/lib/providers/teletel";
import { escapeHtml, staffCall, staffSend, type StaffMember } from "./staff-bot";
import { DEFAULT_TARGETS, loadTargets, myNumbers, openFor, riyadhDayStart, secondsText, speedText, systemCounts, waitText, type MyNumbers, type Targets } from "./staff-numbers";
import { teamAverages, type Team } from "./staff-report";
import { rememberThread, replyButtons } from "./staff-replies";
import type { InlineButton } from "./ops-bot";
import { loadSettings } from "@/lib/mine/day";
import { onlineAgents } from "@/lib/mine/remind";
import { excusedAgents, ownShifts } from "@/lib/presence/availability";
import { isWorkingTime } from "@/lib/murad/reception";
import { quiet, STOP_REMINDING_AT, waitLevelNow, waitLevels, type DaySettings } from "@/lib/mine/rank";
import { followedMarks, latenessExempt } from "@/lib/leads/lifecycle";
import { exemptConversation } from "@/lib/leads/lateness";
import { followedSince } from "@/lib/leads/lifecycle-rules";

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

export function dashboardText(
  name: string,
  n: MyNumbers,
  team: Team,
  extra: { issued: number; botReplies: number },
  nowMs: number,
  targets: Targets = DEFAULT_TARGETS,
): string {
  const r = n.today.report;
  const status = light(n);
  const at = new Date(nowMs).toLocaleTimeString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });
  return [
    `🖥️ <b>شاشتي</b> — ${escapeHtml(name)}`,
    `${status.icon} ${status.words}`,
    "",
    "<b>━━ الآن ━━</b>",
    `📂 محادثات مفتوحة لك: <b>${n.open}</b>`,
    `⏳ عملاء ينتظرون ردك: <b>${n.waiting}</b>${n.oldestWaitMin != null ? ` · أقدمهم منذ ${waitText(n.oldestWaitMin)}` : ""}`,
    `🆕 محادثات لم ترد عليها أبداً: <b>${n.neverAnswered}</b>`,
    "",
    "<b>━━ اليوم ━━</b>",
    `📥 محادثات أُسندت إليك: <b>${n.today.assigned}</b>`,
    `✅ محادثات أغلقتها: <b>${r?.resolved ?? 0}</b>`,
    `⚡ أول رد للعميل: ${speedText(r?.firstResponseSec, targets.firstReply)}`,
    `↩️ ردّك أثناء المحادثة: ${speedText(r?.replySec, targets.reply)}`,
    `👥 متوسط الفريق اليوم: أول رد ${secondsText(team.firstResponseSec)} · الرد ${secondsText(team.replySec)}`,
    extra.issued ? `📄 ملفات أصدرتها في النظام: <b>${extra.issued}</b>` : null,
    extra.botReplies ? `🤖 ردود أرسلتها من البوت: <b>${extra.botReplies}</b>` : null,
    "",
    "<b>━━ منذ البداية ━━</b>",
    `🗂️ كل محادثاتك: <b>${n.total ?? "—"}</b> · المغلقة منها: <b>${n.closed ?? "—"}</b>`,
    "",
    `<i>الهدف من إعدادات «SLA»: أول رد خلال ${waitText(targets.firstReply[0])}، والرد خلال ${waitText(targets.reply[0])}</i>`,
    `<i>يتحدّث تلقائياً كل ٥ دقائق · آخر تحديث ${at}</i>`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
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
  const [n, extra, targets] = await Promise.all([myNumbers(me.agentId, nowMs, all), systemCounts(me.id, since), loadTargets()]);
  return n ? { text: dashboardText(me.name, n, teamAverages(all), extra, nowMs, targets), buttons: SCREEN_BUTTONS } : null;
}

/** «🖥️ شاشتي» from the keyboard: a fresh screen, pinned silently. The previous one is removed, and the minute job keeps the new one current. */
export async function openScreen(me: StaffMember, chatId: number, fallback: ScreenView): Promise<void> {
  const view = (await screenView(me)) ?? fallback;
  const sent = await staffSend(chatId, view.text, view.buttons, {}, "screen");
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
  const targets = await loadTargets();
  return {
    text: [
      "📅 <b>أداؤك آخر ٧ أيام</b>",
      "<i>بين قوسين: الأيام السبعة التي قبلها</i>",
      "",
      `💬 محادثات جديدة أُسندت إليك: <b>${a?.conversations ?? 0}</b> (${b?.conversations ?? 0})${trend(a?.conversations, b?.conversations)}`,
      `✅ محادثات أغلقتها: <b>${a?.resolved ?? 0}</b> (${b?.resolved ?? 0})${trend(a?.resolved, b?.resolved)}`,
      `⚡ أول رد للعميل: ${speedText(a?.firstResponseSec, targets.firstReply)} (${secondsText(b?.firstResponseSec)})${trend(a?.firstResponseSec, b?.firstResponseSec, true)}`,
      `↩️ ردّك أثناء المحادثة: ${speedText(a?.replySec, targets.reply)} (${secondsText(b?.replySec)})${trend(a?.replySec, b?.replySec, true)}`,
      `👥 متوسط الفريق: أول رد ${secondsText(team.firstResponseSec)} · الرد ${secondsText(team.replySec)}`,
      `📄 ملفات أصدرتها في النظام: <b>${mine.issued}</b> (${before.issued})${trend(mine.issued, before.issued)}`,
      mine.botReplies ? `🤖 ردود أرسلتها من البوت: <b>${mine.botReplies}</b>` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    buttons: [[{ text: "📈 أدائي اليوم", callback_data: "d" }, { text: "↩️ شاشتي", callback_data: "s" }]],
  };
}

/**
 * «⏰ ينتظر ردك»: a client waiting past the employee's own first minutes (15 unless
 * they set otherwise in «متابعتي»), and once more after their repeat (45 more),
 * outside their quiet hours (23:00–09:00 unless set), a hot client (Murad) at five
 * minutes too — and nothing to anyone offline (the owner, 2026-10-25). A wait
 * already past three hours is not news to anyone (it is on «بانتظار ردي» and in
 * the evening report), so it is not reminded. That is also why the first run
 * after a deploy cannot flood anyone with old waits.
 */
export async function remindWaiting(nowMs = Date.now()): Promise<{ reminded: number } | null> {
  const list = await listOpenConversations();
  if (!list) return null;
  const nowSec = nowMs / 1000;
  const waiting = list.rows.filter((c) => c.assigneeId && c.waitingSince > 0 && nowMinutes(c.waitingSince, nowSec) < STOP_REMINDING_AT);
  if (!waiting.length) return { reminded: 0 };

  const agents = [...new Set(waiting.map((c) => c.assigneeId as number))];
  const [{ data }, online, { data: hotRows }, excused] = await Promise.all([
    db().from("employees").select("id, telegram_chat_id, teletel_agent_id").eq("status", "Active").in("teletel_agent_id", agents).not("telegram_chat_id", "is", null),
    onlineAgents(),
    db().from("sla_followups").select("conversation_id").eq("status", "open").eq("summary->>heat", "hot").in("conversation_id", waiting.map((c) => c.id)),
    // on leave, with a client, on a call, praying, in a meeting: no reminder (presence/availability.ts)
    excusedAgents(nowMs).catch(() => new Map<number, unknown>()),
  ]);
  const byAgent = new Map(((data ?? []) as { id: string; telegram_chat_id: number | string; teletel_agent_id: number }[]).map((e) => [e.teletel_agent_id, { id: e.id, chat: Number(e.telegram_chat_id) }]));
  const hot = new Set(((hotRows ?? []) as { conversation_id: number }[]).map((r) => Number(r.conversation_id)));
  // «@#@#@#» since the client wrote: the colleague followed it up — no reminder; and no delay is counted against the
  // morning desk or the visa department (lateness_exempt) — no «ينتظر ردك منذ…» for them (the owner, 2026-10-29)
  const [followed, exempt] = await Promise.all([followedMarks(waiting.map((c) => c.id)), latenessExempt()]);
  // a colleague on their own shift (employee_shifts) is not reminded outside it — the night shift sleeps by day
  const shifts = await ownShifts([...byAgent.values()].map((w) => w.id), nowMs);
  const settings = new Map<string, Promise<DaySettings>>();

  let reminded = 0;
  for (const c of waiting) {
    const who = byAgent.get(c.assigneeId as number);
    if (!who?.chat || (online && !online.has(c.assigneeId as number)) || excused.has(c.assigneeId as number)) continue;
    if (followedSince(followed.get(c.id), c.waitingSince * 1000) || exemptConversation(c, exempt)) continue;
    const own = shifts.get(who.id);
    if (own && !isWorkingTime(new Date(nowMs), own)) continue;
    if (!settings.has(who.id)) settings.set(who.id, loadSettings(who.id));
    const mine = await settings.get(who.id)!;
    if (quiet(mine, nowMs)) continue;
    const minutes = nowMinutes(c.waitingSince, nowSec);
    const level = waitLevelNow(waitLevels(mine, hot.has(c.id)), minutes);
    if (level === null) continue;
    const { data: claimed } = await db()
      .from("staff_bot_reminders")
      .upsert({ conversation_id: c.id, waiting_since: c.waitingSince, level }, { onConflict: "conversation_id,waiting_since,level", ignoreDuplicates: true })
      .select("level");
    if (!claimed?.length) continue;
    const sent = await staffSend(
      who.chat,
      [`${hot.has(c.id) ? "🔥 عميل ساخن — " : "⏰ "}<b>${escapeHtml(c.name)}</b> ينتظر ردك منذ ${waitText(minutes)}`, c.preview.trim() ? `💬 «${escapeHtml(c.preview.trim().slice(0, 200))}»` : null].filter(Boolean).join("\n"),
      replyButtons(c.id),
      {},
      `conv:${c.id}`,
    );
    if (sent.ok) {
      await rememberThread(who.chat, sent.messageId, c.id);
      reminded += 1;
    }
  }
  return { reminded };
}
