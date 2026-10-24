import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { agentSummaries, listOpenConversations } from "@/lib/providers/teletel";
import { escapeHtml, staffCall, staffSend, type StaffMember } from "./staff-bot";
import { riyadhDayStart, waitText } from "./staff-numbers";
import { light, screenView, type ScreenView } from "./staff-screen";

/**
 * «تنبيهاتي» for its managers. These are staffbot.manage (the bot's management,
 * nothing more) or employees.manage (the administration). Read through
 * followup_employee_can, so the role, the permissions given to one person and
 * the ones taken away all count. It is checked again on every action, because
 * a button is not an authorisation.
 *
 *   - «👥 الفريق»: every colleague with a Teletel account, worst first
 *     (🔴🟡🟢), and each one's own screen;
 *   - «📢 إعلان عام»: to every linked colleague;
 *   - «🔔 تنبيه له» / «⏰ ذكّره بمن ينتظره»: to one colleague.
 * Every send goes write → preview → confirm. The draft → sending claim makes a
 * double tap send once, and the row is the record.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export async function isBotManager(employeeId: string): Promise<boolean> {
  const ask = (key: string) => db().rpc("followup_employee_can", { p_employee: employeeId, p_key: key });
  const [bot, team] = await Promise.all([ask("staffbot.manage"), ask("employees.manage")]);
  return bot.data === true || team.data === true;
}

const REFUSED = "هذا للإدارة فقط.";
const PENDING_MINUTES = 10;

export type Colleague = { id: string; name: string; chatId: number | null; agentId: number | null };

export async function colleagues(): Promise<Colleague[]> {
  const { data } = await db().from("employees").select("id, arabic_name, telegram_chat_id, teletel_agent_id").eq("status", "Active");
  return ((data ?? []) as { id: string; arabic_name: string; telegram_chat_id: number | string | null; teletel_agent_id: number | null }[]).map((e) => ({
    id: e.id,
    name: e.arabic_name,
    chatId: e.telegram_chat_id != null && Number(e.telegram_chat_id) ? Number(e.telegram_chat_id) : null,
    agentId: e.teletel_agent_id,
  }));
}

// ---------- «👥 الفريق» ----------

/** Every colleague with a Teletel account and their numbers now, the most urgent first. */
export async function teamView(me: StaffMember): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return { text: REFUSED, buttons: [] };
  const nowMs = Date.now();
  const nowSec = nowMs / 1000;
  const [list, people, today] = await Promise.all([listOpenConversations(), colleagues(), agentSummaries(riyadhDayStart(nowMs), Math.floor(nowSec))]);
  if (!list) return { text: "تعذّر الوصول إلى تيلي تيل الآن — جرّب بعد دقيقة.", buttons: [] };
  const rows = people
    .filter((p) => p.agentId)
    .map((p) => {
      const open = list.rows.filter((c) => c.assigneeId === p.agentId);
      const waiting = open.filter((c) => c.waitingSince > 0);
      const oldest = waiting.length ? Math.floor((nowSec - Math.min(...waiting.map((c) => c.waitingSince))) / 60) : null;
      const n = { open: open.length, waiting: waiting.length, neverAnswered: open.filter((c) => !c.firstReplyAt).length, oldestWaitMin: oldest };
      return { p, n, status: light(n) };
    })
    .sort((a, b) => "🔴🟡🟢".indexOf(a.status.icon) - "🔴🟡🟢".indexOf(b.status.icon) || b.n.waiting - a.n.waiting);
  const sum = (pick: (n: (typeof rows)[number]["n"]) => number) => rows.reduce((t, r) => t + pick(r.n), 0);
  const resolved = rows.reduce((t, r) => t + (today?.get(r.p.agentId as number)?.resolved ?? 0), 0);
  return {
    text: [
      `👥 <b>الفريق الآن</b> — ${rows.length} موظف`,
      "",
      `📂 مفتوحة: <b>${sum((n) => n.open)}</b> · ⏳ بانتظار الرد: <b>${sum((n) => n.waiting)}</b> · 🆕 بلا رد: <b>${sum((n) => n.neverAnswered)}</b>`,
      `✅ أُغلقت اليوم: <b>${resolved}</b>`,
      "",
      "🔴 عميل ينتظر ٣٠ د أو أكثر أو بلا رد · 🟡 ينتظر · 🟢 لا أحد ينتظر",
      "اضغط على الموظف لترى شاشته وترسل له تنبيهاً.",
    ].join("\n"),
    buttons: [
      ...rows.map((r) => [
        {
          text: `${r.status.icon} ${r.p.name.slice(0, 18)} — 📂${r.n.open} ⏳${r.n.waiting} 🆕${r.n.neverAnswered}${r.n.oldestWaitMin != null ? ` · ${waitText(r.n.oldestWaitMin)}` : ""}`,
          callback_data: `e:${r.p.id}`,
        },
      ]),
      [{ text: "🔄 تحديث", callback_data: "team" }, { text: "📄 الخطابات", callback_data: "lt" }, { text: "🎯 الأهداف", callback_data: "tg" }],
    ],
  };
}

/** One colleague's own screen, as they see it, with the alert buttons. */
export async function memberView(me: StaffMember, employeeId: string): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return { text: REFUSED, buttons: [] };
  const who = (await colleagues()).find((c) => c.id === employeeId);
  if (!who) return { text: "لم أجد هذا الموظف.", buttons: [[{ text: "↩️ الفريق", callback_data: "team" }]] };
  const view = who.agentId ? await screenView({ id: who.id, name: who.name, chatId: who.chatId ?? 0, agentId: who.agentId }) : null;
  return {
    text: `${view?.text ?? `👤 <b>${escapeHtml(who.name)}</b>\nحسابه في تيلي تيل غير مربوط.`}${who.chatId ? "" : "\n\n⚠️ حسابه في تيليجرام غير مربوط — لا يصله تنبيه."}`,
    buttons: [
      ...(who.chatId
        ? [
            [
              { text: "🔔 تنبيه له", callback_data: `a:${who.id}` },
              ...(who.agentId ? [{ text: "⏰ ذكّره بمن ينتظره", callback_data: `q:${who.id}` }] : []),
            ],
          ]
        : []),
      [{ text: "🔄 تحديث", callback_data: `e:${who.id}` }, { text: "↩️ الفريق", callback_data: "team" }],
    ],
  };
}

// ---------- the next text: an announcement, or an alert to one ----------

/** «📢 إعلان عام» or «🔔 تنبيه له»: the manager's next text, within ten minutes, becomes the draft. */
export async function promptFor(me: StaffMember, chatId: number, kind: "broadcast" | "alert", targetId: string | null): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED);
    return;
  }
  const people = await colleagues();
  const target = targetId ? people.find((p) => p.id === targetId && p.chatId) : null;
  if (kind === "alert" && !target) {
    await staffSend(chatId, "حسابه في تيليجرام غير مربوط — لا يمكن تنبيهه من البوت.");
    return;
  }
  await db().from("staff_bot_pending").upsert({ chat_id: chatId, kind, target_id: target?.id ?? null, created_at: new Date().toISOString() });
  const count = people.filter((p) => p.chatId && p.id !== me.id).length;
  await staffSend(
    chatId,
    kind === "alert"
      ? `🔔 اكتب التنبيه الذي يصل إلى <b>${escapeHtml(target?.name ?? "")}</b>:\n<i>تراه قبل الإرسال وتؤكده.</i>`
      : `📢 اكتب الإعلان الذي يصل لكل الموظفين المربوطين بالبوت (${count}):\n<i>تراه قبل الإرسال وتؤكده.</i>`,
    undefined,
    { reply_markup: { force_reply: true, input_field_placeholder: kind === "alert" ? "نص التنبيه" : "نص الإعلان" } },
  );
}

/** A pending prompt for this chat, taken (used once). Null when none, or older than ten minutes. */
export type Pending = { kind: "broadcast" | "alert" | "decision"; targetId: string | null; sourceKey: string | null };

export async function takePending(chatId: number): Promise<Pending | null> {
  const { data } = await db().from("staff_bot_pending").delete().eq("chat_id", chatId).select("kind, target_id, source_key, created_at").maybeSingle();
  const row = data as { kind: Pending["kind"]; target_id: string | null; source_key: string | null; created_at: string } | null;
  if (!row || Date.now() - Date.parse(row.created_at) > PENDING_MINUTES * 60_000) return null;
  return { kind: row.kind, targetId: row.target_id, sourceKey: row.source_key };
}

export function broadcastText(content: string, senderName: string, alert = false): string {
  return `${alert ? "🔔 <b>تنبيه من الإدارة</b>" : "📢 <b>إعلان من الإدارة</b>"}\n\n${escapeHtml(content)}\n\n— ${escapeHtml(senderName)}`;
}

/** The text → a draft and its preview, with «إرسال» and «إلغاء». Nothing is sent here. */
export async function draft(me: StaffMember, chatId: number, content: string, targetId: string | null): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED);
    return;
  }
  const text = content.trim().slice(0, 3500);
  if (!text) return;
  const people = await colleagues();
  const target = targetId ? people.find((p) => p.id === targetId && p.chatId) : null;
  if (targetId && !target) {
    await staffSend(chatId, "حسابه في تيليجرام لم يعد مربوطاً — لم يُحفظ التنبيه.");
    return;
  }
  const { data, error } = await db().from("staff_bot_broadcasts").insert({ sender_id: me.id, content: text, target_id: target?.id ?? null }).select("id").single();
  if (error || !data) {
    await staffSend(chatId, "تعذّر حفظه — جرّب مرة أخرى.");
    return;
  }
  const id = (data as { id: number }).id;
  const count = target ? 1 : people.filter((p) => p.chatId && p.id !== me.id).length;
  await staffSend(chatId, `👁 <b>هكذا يصل ${target ? `إلى ${escapeHtml(target.name)}` : `إلى ${count} موظف`}:</b>\n\n${broadcastText(text, me.name, Boolean(target))}`, [
    [
      { text: target ? "✅ إرسال" : `✅ إرسال للجميع (${count})`, callback_data: `b:send:${id}` },
      { text: "✖️ إلغاء", callback_data: `b:no:${id}` },
    ],
  ]);
}

/** «⏰ ذكّره بمن ينتظره»: the alert written from the colleague's own numbers, still shown first and confirmed. */
export async function remindDraft(me: StaffMember, chatId: number, employeeId: string): Promise<void> {
  const who = (await colleagues()).find((c) => c.id === employeeId);
  const list = await listOpenConversations();
  if (!who?.agentId || !list) {
    await staffSend(chatId, "تعذّر حساب من ينتظره الآن — جرّب بعد دقيقة.");
    return;
  }
  const nowSec = Date.now() / 1000;
  const waiting = list.rows.filter((c) => c.assigneeId === who.agentId && c.waitingSince > 0);
  const never = list.rows.filter((c) => c.assigneeId === who.agentId && !c.firstReplyAt).length;
  if (!waiting.length && !never) {
    await staffSend(chatId, `✅ لا أحد ينتظر ${escapeHtml(who.name)} الآن.`);
    return;
  }
  const oldest = waiting.length ? waitText(Math.floor((nowSec - Math.min(...waiting.map((c) => c.waitingSince))) / 60)) : null;
  const text = [
    waiting.length ? `عندك ${waiting.length} عميل بانتظار ردك${oldest ? `، أقدمهم منذ ${oldest}` : ""}.` : null,
    never ? `و${never} محادثة لم يُرد عليها أبداً.` : null,
    "نرجو الرد عليهم الآن — تجدهم في «⏳ بانتظار ردي».",
  ]
    .filter(Boolean)
    .join(" ");
  await draft(me, chatId, text, who.id);
}

/** «إرسال» or «إلغاء» on the preview: claimed once, then sent or dropped, and the sender told who it reached. */
export async function confirmDraft(me: StaffMember, chatId: number, previewId: number | undefined, data: string): Promise<void> {
  const [, action, raw] = data.split(":");
  const id = Number(raw);
  if (!Number.isInteger(id) || !(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED);
    return;
  }
  const next = action === "send" ? "sending" : "cancelled";
  const { data: claimed } = await db()
    .from("staff_bot_broadcasts")
    .update({ status: next })
    .eq("id", id)
    .eq("sender_id", me.id)
    .eq("status", "draft")
    .select("content, target_id")
    .maybeSingle();
  // the buttons go either way, so the preview cannot be pressed again
  if (previewId) await staffCall("editMessageReplyMarkup", { chat_id: chatId, message_id: previewId, reply_markup: { inline_keyboard: [] } });
  if (!claimed) {
    await staffSend(chatId, "هذا أُرسل أو أُلغي من قبل.");
    return;
  }
  if (next === "cancelled") {
    await staffSend(chatId, "✖️ أُلغي — لم يُرسل لأحد.");
    return;
  }

  const row = claimed as { content: string; target_id: string | null };
  const people = (await colleagues()).filter((p) => p.chatId && (row.target_id ? p.id === row.target_id : p.id !== me.id));
  const missed: string[] = [];
  for (const p of people) {
    if (!(await staffSend(p.chatId as number, broadcastText(row.content, me.name, Boolean(row.target_id)), undefined, {}, "admin")).ok) missed.push(p.name);
  }
  const delivered = people.length - missed.length;
  await db()
    .from("staff_bot_broadcasts")
    .update({ status: "sent", recipients: people.length, delivered, not_delivered: missed, sent_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit({
    action: row.target_id ? "staff_bot.alert_sent" : "staff_bot.broadcast_sent",
    entity: "staff_bot_broadcasts",
    entity_id: String(id),
    meta: { to: row.target_id, recipients: people.length, delivered, not_delivered: missed },
    actor: { id: me.id, label: me.name },
  });
  await staffSend(
    chatId,
    row.target_id
      ? delivered
        ? `✅ وصل التنبيه إلى ${escapeHtml(people[0]?.name ?? "")}.`
        : `⚠️ لم يصل التنبيه إلى ${escapeHtml(people[0]?.name ?? "الموظف")} — لم يضغط «ابدأ» في البوت بعد.`
      : [`✅ وصل الإعلان إلى <b>${delivered}</b> من ${people.length} موظف.`, missed.length ? `لم يصل إلى: ${missed.map(escapeHtml).join("، ")} — لم يضغطوا «ابدأ» في البوت بعد.` : null]
          .filter(Boolean)
          .join("\n"),
  );
}

