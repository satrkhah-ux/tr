import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { conversationThread, listOpenConversations, teletelConversationUrl } from "@/lib/providers/teletel";
import { normalizeManagerThresholds } from "@/lib/manager-screen/rules";
import { followupPeople } from "@/lib/followups/service";
import { NEXT_LABEL, type FollowupSummary } from "@/lib/followups/summary-core";
import { onlineAgents } from "@/lib/mine/remind";
import { escapeHtml, staffCall, staffSend, type StaffMember } from "./staff-bot";
import { waitText } from "./staff-numbers";
import { rememberThread, whenText } from "./staff-replies";
import { broadcastText, colleagues, isBotManager } from "./staff-manager";
import { BACK_ADMIN } from "./staff-admin-core";
import {
  filterLabel,
  managerThreadText,
  nudgedRecently,
  nudgedText,
  nudgeContent,
  parseWaitData,
  pickWaiting,
  teamNudgeContent,
  toneOf,
  waitData,
  waitListView,
  type Limits,
  type ManagerLine,
  type WaitRow,
} from "./staff-waiting-core";
import type { InlineButton } from "./ops-bot";

/**
 * «⏳ المحادثات المنتظرة» — the server side of staff-waiting-core. Every screen
 * and every button checks the bot's manager FIRST, before anything is read from
 * Teletel or the database: a callback_data can be sent by any linked account.
 * Nothing here writes to Teletel and nothing reaches a client; a nudge is a
 * Telegram message to a colleague, written → previewed → confirmed, recorded in
 * the audit (staff_bot.alert_sent), once per colleague and conversation in fifteen minutes.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type View = { text: string; buttons: InlineButton[][] };
const REFUSED: View = { text: "هذا للإدارة فقط.", buttons: [] };
const NO_TELETEL: View = { text: "تعذّر الوصول إلى تيلي تيل الآن — جرّب بعد دقيقة.", buttons: [[BACK_ADMIN]] };
const BACK_LIST: InlineButton = { text: "↩️ المحادثات المنتظرة", callback_data: waitData({ kind: "all" }, 0) };

async function limits(): Promise<Limits> {
  const { data } = await db().from("app_settings").select("value").eq("key", "manager_screen").maybeSingle();
  const t = normalizeManagerThresholds((data as { value?: unknown } | null)?.value);
  return { waitAmberMin: t.waitAmberMin, waitRedMin: t.waitRedMin };
}

/** every waiting conversation, with who holds it */
async function waitingRows(nowMs: number): Promise<WaitRow[] | null> {
  const [list, people] = await Promise.all([listOpenConversations(), colleagues()]);
  if (!list) return null;
  const byAgent = new Map(people.filter((p) => p.agentId).map((p) => [p.agentId as number, p]));
  return list.rows
    .filter((c) => c.waitingSince > 0)
    .map((c) => {
      const who = c.assigneeId ? byAgent.get(c.assigneeId) : undefined;
      return {
        id: c.id,
        name: c.name || `#${c.id}`,
        minutes: Math.max(0, Math.floor((nowMs / 1000 - c.waitingSince) / 60)),
        agentId: c.assigneeId,
        employeeId: who?.id ?? null,
        holder: who ? who.name.trim() : c.assignee,
      };
    });
}

export async function waitingListView(me: StaffMember, data: string): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const parsed = parseWaitData(data) ?? { filter: { kind: "all" as const }, page: 0 };
  const nowMs = Date.now();
  const [rows, t] = await Promise.all([waitingRows(nowMs), limits()]);
  if (!rows) return NO_TELETEL;
  const f = parsed.filter;
  const picked = pickWaiting(rows, f, t);
  const name = f.kind === "emp" ? (rows.find((r) => r.employeeId === f.id)?.holder ?? null) : null;
  return waitListView({ rows: picked, all: rows.length, filter: f, label: filterLabel(f, name), page: parsed.page, t, waitText, escape: escapeHtml });
}

/** «👤 لدى موظف»: whom — the colleagues holding waiting clients, the most first */
export async function waitingPickView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const rows = await waitingRows(Date.now());
  if (!rows) return NO_TELETEL;
  const count = new Map<string, { name: string; n: number }>();
  for (const r of rows) if (r.employeeId) count.set(r.employeeId, { name: r.holder ?? "—", n: (count.get(r.employeeId)?.n ?? 0) + 1 });
  const people = [...count].sort((a, b) => b[1].n - a[1].n);
  return {
    text: people.length ? "👤 <b>لدى من؟</b>\nاختر الموظف لترى من ينتظره." : "لا أحد من الفريق عنده عميل ينتظر الآن ✅",
    buttons: [
      ...people.map(([id, p]) => [{ text: `${p.name.slice(0, 22)} — ${p.n}`, callback_data: waitData({ kind: "emp", id }, 0) }]),
      [BACK_LIST, BACK_ADMIN],
    ],
  };
}

/** when the conversation reached its current holder: the lead's last hand-over (client_leads.handoffs, 0099) */
async function heldSince(conversationId: number, holder: string | null): Promise<number | null> {
  if (!holder) return null;
  const { data } = await db().from("client_leads").select("handoffs").eq("teletel_conversation_id", conversationId).maybeSingle();
  const stages = ((data as { handoffs?: { agent: string; from: number }[] | null } | null)?.handoffs ?? []).filter((s) => s.agent?.trim() === holder.trim());
  return stages.length ? stages[stages.length - 1].from : null;
}

/** One conversation, read-only, as the administration sees it. */
export async function waitingConvView(me: StaffMember, conversationId: number): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return { text: "لم أجد هذه المحادثة.", buttons: [[BACK_LIST, BACK_ADMIN]] };
  const nowMs = Date.now();
  const [rows, t, thread, murad, follow, list] = await Promise.all([
    waitingRows(nowMs),
    limits(),
    conversationThread(conversationId),
    db().from("murad_log").select("reply_message_id").eq("conversation_id", conversationId).not("reply_message_id", "is", null),
    db().from("sla_followups").select("summary").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    listOpenConversations(),
  ]);
  if (!rows || !list) return NO_TELETEL;
  const row = rows.find((r) => r.id === conversationId);
  const open = list.rows.find((c) => c.id === conversationId);
  if (!open) return { text: "هذه المحادثة لم تعد مفتوحة.", buttons: [[BACK_LIST, BACK_ADMIN]] };
  const since = await heldSince(conversationId, row?.holder ?? open.assignee);
  const s = (follow.data as { summary?: FollowupSummary | null } | null)?.summary ?? null;
  const lines: ManagerLine[] = (thread?.messages ?? []).filter((m) => m.text).slice(-8);
  const muradIds = new Set(((murad.data ?? []) as { reply_message_id: number }[]).map((r) => Number(r.reply_message_id)));
  const holder = row?.holder ?? open.assignee;
  const tone = row ? toneOf(row.minutes, t) : "plain";
  const text = [
    `💬 <b>${escapeHtml(open.name || `#${conversationId}`)}</b>${open.phone ? ` · <code>${escapeHtml(open.phone)}</code>` : ""}`,
    row ? `${tone === "red" ? "🔴" : tone === "amber" ? "🟠" : "⚪"} ينتظر الرد منذ ${waitText(row.minutes)}` : "✅ لا ينتظر رداً الآن",
    `عند: <b>${holder ? escapeHtml(holder) : "بلا موظف"}</b>${since ? ` · أُسندت إليه منذ ${waitText(Math.max(0, Math.floor((nowMs / 1000 - since) / 60)))}` : ""}`,
    ...(s ? ["", `أراد: ${escapeHtml(s.wants)}`, `المقترح: ${NEXT_LABEL[s.next]} — ${escapeHtml(s.advice)}`] : []),
    "",
    `<b>آخر الرسائل</b>${thread ? "" : " — تعذّرت قراءتها الآن"}`,
    managerThreadText(open.name || `#${conversationId}`, lines, muradIds, (at) => whenText(at, nowMs), escapeHtml),
  ].join("\n");
  const nudge: InlineButton[] = row?.employeeId
    ? [{ text: `🔔 نبّه ${(holder ?? "").slice(0, 20)}`, callback_data: `ax:${conversationId}` }]
    : row && row.agentId === null
      ? [{ text: "📢 نبّه الفريق", callback_data: `ay:${conversationId}` }]
      : [];
  const url = teletelConversationUrl(conversationId);
  return {
    // Telegram keeps a message to 4096 characters: the oldest lines go first
    text: text.length > 3900 ? `${text.slice(0, 3890)}…` : text,
    buttons: [
      ...(nudge.length ? [nudge] : []),
      [{ text: "🔄 تحديث", callback_data: `av:${conversationId}` }, ...(url ? [{ text: "💬 تيلي تيل", url }] : [])],
      [BACK_LIST, BACK_ADMIN],
    ],
  };
}

/** the last nudge about this conversation to this colleague (or «team»), from the audit */
async function lastNudge(conversationId: number, to: string): Promise<number | null> {
  const { data } = await db()
    .from("audit_logs")
    .select("created_at")
    .eq("action", "staff_bot.alert_sent")
    .eq("entity", "conversations")
    .eq("entity_id", String(conversationId))
    .eq("meta->>to", to)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const at = (data as { created_at?: string } | null)?.created_at;
  return at ? Date.parse(at) : null;
}

/** the sales colleagues online now, with Telegram (Teletel unreadable: every linked seller) */
async function teamOnline(): Promise<{ id: string; name: string; chatId: number }[]> {
  const [people, online, linked] = await Promise.all([followupPeople(), onlineAgents(), colleagues()]);
  const chat = new Map(linked.filter((c) => c.chatId).map((c) => [c.id, c.chatId as number]));
  return people
    .filter((p) => p.seller && chat.has(p.id) && (!online || (p.agentId && online.has(p.agentId))))
    .map((p) => ({ id: p.id, name: p.name.trim(), chatId: chat.get(p.id) as number }));
}

/** «🔔 نبّه …» / «📢 نبّه الفريق»: the text, saved as a draft and shown to the manager with «إرسال» / «إلغاء». Nothing is sent here. */
export async function prepareNudge(me: StaffMember, chatId: number, conversationId: number, team: boolean): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED.text);
    return;
  }
  const rows = await waitingRows(Date.now());
  const row = rows?.find((r) => r.id === conversationId);
  if (!row) {
    await staffSend(chatId, "هذه المحادثة لم تعد تنتظر رداً — لا حاجة للتنبيه.", [[BACK_LIST]]);
    return;
  }
  if (team ? row.agentId !== null : !row.employeeId) {
    await staffSend(chatId, team ? "المحادثة عند موظف الآن — نبّهه هو من شاشتها." : "من عنده المحادثة ليس موظفاً مربوطاً بالبوت.", [
      [{ text: "↩️ المحادثة", callback_data: `av:${conversationId}` }],
    ]);
    return;
  }
  const to = team ? "team" : (row.employeeId as string);
  const ago = nudgedRecently(await lastNudge(conversationId, to), Date.now());
  if (ago !== null) {
    await staffSend(chatId, nudgedText(ago), [[{ text: "↩️ المحادثة", callback_data: `av:${conversationId}` }]]);
    return;
  }
  const reach = team ? await teamOnline() : (await colleagues()).filter((c) => c.id === row.employeeId && c.chatId);
  if (!reach.length) {
    await staffSend(chatId, team ? "لا أحد من فريق المبيعات متصل الآن ومربوط بالبوت." : "حسابه في تيليجرام غير مربوط — لا يصله تنبيه.", [
      [{ text: "↩️ المحادثة", callback_data: `av:${conversationId}` }],
    ]);
    return;
  }
  const content = team ? teamNudgeContent(row.name, row.minutes, waitText) : nudgeContent(row.name, row.minutes, waitText);
  const { data, error } = await db()
    .from("staff_bot_broadcasts")
    .insert({ sender_id: me.id, content, target_id: team ? null : row.employeeId })
    .select("id")
    .single();
  if (error || !data) {
    await staffSend(chatId, "تعذّر حفظه — جرّب مرة أخرى.");
    return;
  }
  const id = (data as { id: number }).id;
  await staffSend(
    chatId,
    `👁 <b>هكذا يصل ${team ? `إلى ${reach.length} من فريق المبيعات المتصلين` : `إلى ${escapeHtml(row.holder ?? "")}`}:</b>\n\n${broadcastText(content, me.name, true)}`,
    [
      [
        { text: "✅ إرسال", callback_data: `bw:send:${id}:${conversationId}` },
        { text: "✖️ إلغاء", callback_data: `bw:no:${id}:${conversationId}` },
      ],
    ],
  );
}

/** «إرسال» / «إلغاء» on a nudge's preview: claimed once, the fifteen minutes checked again, sent, recorded. */
export async function confirmNudge(me: StaffMember, chatId: number, previewId: number | undefined, data: string): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED.text);
    return;
  }
  const [, action, rawId, rawConv] = data.split(":");
  const id = Number(rawId);
  const conversationId = Number(rawConv);
  if (!Number.isInteger(id) || !Number.isInteger(conversationId)) return;
  const next = action === "send" ? "sending" : "cancelled";
  const { data: claimed } = await db()
    .from("staff_bot_broadcasts")
    .update({ status: next })
    .eq("id", id)
    .eq("sender_id", me.id)
    .eq("status", "draft")
    .select("content, target_id")
    .maybeSingle();
  if (previewId) await staffCall("editMessageReplyMarkup", { chat_id: chatId, message_id: previewId, reply_markup: { inline_keyboard: [] } });
  const back = [[{ text: "↩️ المحادثة", callback_data: `av:${conversationId}` }, BACK_LIST]];
  if (!claimed) {
    await staffSend(chatId, "هذا أُرسل أو أُلغي من قبل.", back);
    return;
  }
  if (next === "cancelled") {
    await staffSend(chatId, "✖️ أُلغي — لم يُرسل لأحد.", back);
    return;
  }
  const row = claimed as { content: string; target_id: string | null };
  const to = row.target_id ?? "team";
  // a second preview confirmed late, or two managers at once: the window holds
  const ago = nudgedRecently(await lastNudge(conversationId, to), Date.now());
  if (ago !== null) {
    await db().from("staff_bot_broadcasts").update({ status: "cancelled" }).eq("id", id);
    await staffSend(chatId, nudgedText(ago), back);
    return;
  }
  const people = row.target_id
    ? (await colleagues()).filter((c) => c.id === row.target_id && c.chatId).map((c) => ({ id: c.id, name: c.name.trim(), chatId: c.chatId as number }))
    : await teamOnline();
  const url = teletelConversationUrl(conversationId);
  const missed: string[] = [];
  for (const p of people) {
    const sent = await staffSend(
      p.chatId,
      broadcastText(row.content, me.name, true),
      row.target_id ? [[{ text: "💬 افتح المحادثة", callback_data: `c:${conversationId}` }]] : url ? [[{ text: "💬 افتح في تيلي تيل", url }]] : undefined,
      {},
      `nudge:${conversationId}`,
    );
    if (!sent.ok) missed.push(p.name);
    // the holder may answer the client by replying to the nudge, like to the client's own card
    else if (row.target_id) await rememberThread(p.chatId, sent.messageId, conversationId);
  }
  const delivered = people.length - missed.length;
  await db()
    .from("staff_bot_broadcasts")
    .update({ status: "sent", recipients: people.length, delivered, not_delivered: missed, sent_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit({
    action: "staff_bot.alert_sent",
    entity: "conversations",
    entity_id: String(conversationId),
    meta: { to, conversation: conversationId, draft: id, recipients: people.length, delivered, not_delivered: missed },
    actor: { id: me.id, label: me.name },
  });
  await staffSend(
    chatId,
    delivered
      ? `✅ وصل التنبيه إلى ${row.target_id ? escapeHtml(people[0]?.name ?? "") : `${delivered} من فريق المبيعات`}.`
      : "⚠️ لم يصل التنبيه — لم يضغط «ابدأ» في البوت بعد.",
    back,
  );
}
