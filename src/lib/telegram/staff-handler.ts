import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { conversationThread, getTeletelConfig, teletelConversationUrl, teletelGet } from "@/lib/providers/teletel";
import { escapeHtml, staffCall, staffForChat, staffSend, staffSendAudio, type StaffMember } from "./staff-bot";
import { buildReport } from "./staff-report";
import { myNumbers, openFor, secondsText, waitText } from "./staff-numbers";
import { linkTeletelToken, promptReply, rememberThread, sendReply, threadOf, TOKEN_HELP } from "./staff-replies";
import type { InlineButton } from "./ops-bot";

/**
 * What «تنبيهاتي» answers. Private chats only, and only to a Telegram account
 * linked to an ACTIVE employee. An unlinked account gets its own ID back, so
 * the administration can link it from «الموظفين», and nothing else.
 *
 * The panel («لوحتي») is one message whose text the buttons replace, so the
 * chat stays the employee's notifications and is not filled with menus. Every
 * answer is about the employee's own Teletel agent. A conversation that is not
 * theirs is refused, even when someone asks for it by number.
 */

export type StaffUpdate = {
  message?: {
    message_id: number;
    chat?: { id?: number; type?: string };
    from?: { id?: number; first_name?: string };
    text?: string;
    reply_to_message?: { message_id: number };
  };
  callback_query?: { id: string; from?: { id?: number }; data?: string; message?: { message_id: number; chat?: { id?: number; type?: string } } };
};

type Screen = { text: string; buttons: InlineButton[][] };

const BACK: InlineButton = { text: "↩️ لوحتي", callback_data: "m" };

function teletelHome(): InlineButton[] {
  const config = getTeletelConfig();
  return config ? [{ text: "🌐 فتح تيلي تيل", url: `${config.baseUrl}/app/accounts/${config.accountId}/dashboard` }] : [];
}

function menu(me: StaffMember): Screen {
  return {
    text: [`🔔 <b>لوحتي</b> — ${escapeHtml(me.name)}`, "", "اختر ما تريد:"].join("\n"),
    buttons: [
      [{ text: "📊 أرقامي", callback_data: "n" }, { text: "⏳ بانتظار ردي", callback_data: "w" }],
      [{ text: "📈 تقرير اليوم", callback_data: "d" }, { text: "🎵 نغمة التنبيه", callback_data: "t" }],
      [{ text: "🔑 الرد باسمي من هنا", callback_data: "k" }],
      teletelHome(),
    ].filter((row) => row.length > 0),
  };
}

const NO_AGENT: Screen = {
  text: "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من صفحة «الموظفين» لتصلك محادثاتك وأرقامك.",
  buttons: [[BACK]],
};
const UNREACHABLE: Screen = { text: "تعذّر الوصول إلى تيلي تيل الآن — جرّب بعد دقيقة.", buttons: [[BACK]] };

async function numbers(me: StaffMember): Promise<Screen> {
  if (!me.agentId) return NO_AGENT;
  const n = await myNumbers(me.agentId);
  if (!n) return UNREACHABLE;
  const r = n.today.report;
  return {
    text: [
      "📊 <b>أرقامك</b>",
      "",
      "<b>الآن</b>",
      `• محادثات مفتوحة لك: <b>${n.open}</b>`,
      `• بانتظار ردك: <b>${n.waiting}</b>${n.oldestWaitMin != null ? ` (أقدمها منذ ${waitText(n.oldestWaitMin)})` : ""}`,
      `• لم يُرد عليها أبداً: <b>${n.neverAnswered}</b>`,
      "",
      "<b>الإجمالي في تيلي تيل</b>",
      `• كل ما أُسند إليك: <b>${n.total ?? "—"}</b>`,
      `• المغلقة: <b>${n.closed ?? "—"}</b>`,
      "",
      "<b>اليوم</b>",
      `• تحويلات وصلتك: <b>${n.today.assigned}</b>`,
      `• محادثات اليوم: <b>${r?.conversations ?? "—"}</b> · أغلقت: <b>${r?.resolved ?? "—"}</b>`,
      `• متوسط أول رد: <b>${secondsText(r?.firstResponseSec)}</b> · متوسط الرد: <b>${secondsText(r?.replySec)}</b>`,
    ].join("\n"),
    buttons: [[{ text: "⏳ بانتظار ردي", callback_data: "w" }, { text: "🔄 تحديث", callback_data: "n" }], [BACK]],
  };
}

async function waiting(me: StaffMember): Promise<Screen> {
  if (!me.agentId) return NO_AGENT;
  const open = await openFor(me.agentId);
  if (!open) return UNREACHABLE;
  const now = Date.now() / 1000;
  const list = open.filter((c) => c.waitingSince > 0).slice(0, 8);
  if (!list.length) return { text: "✅ لا أحد ينتظر ردك الآن.", buttons: [[{ text: "📊 أرقامي", callback_data: "n" }], [BACK]] };
  return {
    text: [`⏳ <b>بانتظار ردك</b> — ${open.filter((c) => c.waitingSince > 0).length}`, "", "الأقدم أولاً. اضغط على العميل لترى آخر رسائله."].join("\n"),
    buttons: [
      ...list.map((c) => [{ text: `${c.name.slice(0, 28)} — منذ ${waitText(Math.max(0, Math.floor((now - c.waitingSince) / 60)))}`, callback_data: `c:${c.id}` }]),
      [{ text: "🔄 تحديث", callback_data: "w" }, BACK],
    ],
  };
}

/** The conversation's last messages, for its assignee only. */
async function conversation(me: StaffMember, id: number): Promise<Screen> {
  if (!me.agentId) return NO_AGENT;
  const conv = await teletelGet<{ meta?: { assignee?: { id?: number } | null; sender?: { name?: string | null } | null } }>(`/conversations/${id}`);
  if (!conv) return UNREACHABLE;
  if (conv.meta?.assignee?.id !== me.agentId) return { text: "هذه المحادثة لم تعد مسندة إليك.", buttons: [[BACK]] };
  const thread = await conversationThread(id);
  const lines = (thread?.messages ?? [])
    .filter((m) => !m.isPrivate && m.text)
    .slice(-6)
    .map((m) => `${m.fromClient ? "👤" : "🟢"} ${escapeHtml(m.text.slice(0, 300))}`);
  const url = teletelConversationUrl(id);
  return {
    text: [`💬 <b>${escapeHtml(conv.meta?.sender?.name?.trim() || `#${id}`)}</b>`, "", ...(lines.length ? lines : ["— لا رسائل —"]), "", thread?.canReply ? "" : "⚠️ مرّ أكثر من ٢٤ ساعة على آخر رسالة من العميل — لا يصله إلا قالب معتمد."]
      .join("\n")
      .trim(),
    buttons: [
      [{ text: "✍️ رد", callback_data: `r:${id}` }, ...(url ? [{ text: "💬 افتح في تيلي تيل", url }] : [])],
      [{ text: "⏳ بانتظار ردي", callback_data: "w" }, BACK],
    ],
  };
}

async function report(me: StaffMember): Promise<Screen> {
  if (!me.agentId) return NO_AGENT;
  const r = await buildReport(me);
  return r ? { text: r.text, buttons: [[{ text: "🔄 تحديث", callback_data: "d" }, BACK]] } : UNREACHABLE;
}

const TONE_STEPS = [
  "🎵 <b>نغمة ترافليون للتنبيهات</b>",
  "",
  "لتسمعها كلما وصلك تنبيه من هذا البوت:",
  "١. اضغط مطوّلاً على الملف الصوتي ← «حفظ للإشعارات» (Save for Notifications).",
  "٢. افتح اسم البوت أعلى المحادثة ← «الإشعارات» ← «الصوت».",
  "٣. اختر «نغمة ترافليون».",
].join("\n");

/** The brand tone (public/sounds, 2.4 s, under Telegram's 5 s / 300 KB for a notification sound) with the steps. */
async function sendTone(chatId: number): Promise<void> {
  const bytes = await readFile(join(process.cwd(), "public", "sounds", "traveliun-tone.mp3")).catch(() => null);
  if (!bytes || !(await staffSendAudio(chatId, { bytes, name: "traveliun-tone.mp3", title: "نغمة ترافليون" }, TONE_STEPS))) {
    await staffSend(chatId, "تعذّر إرسال النغمة الآن — جرّب بعد دقيقة.");
  }
}

async function screenFor(me: StaffMember, data: string): Promise<Screen> {
  if (data === "n") return numbers(me);
  if (data === "w") return waiting(me);
  if (data.startsWith("c:")) return conversation(me, Number(data.slice(2)));
  if (data === "k") return { text: TOKEN_HELP, buttons: [[BACK]] };
  if (data === "d") return report(me);
  return menu(me);
}

/** Replace the panel's text in place, or post a new one when it is too old to edit (Telegram's 48 hours). */
async function show(chatId: number, screen: Screen, editId?: number): Promise<void> {
  if (editId) {
    const edited = await staffCall("editMessageText", {
      chat_id: chatId,
      message_id: editId,
      text: screen.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: screen.buttons },
    });
    // «message is not modified» (🔄 with nothing new) is a success, not a reason to post again
    if (edited.ok || /not modified/i.test(edited.description ?? "")) return;
  }
  await staffSend(chatId, screen.text, screen.buttons);
}

export async function handleStaffUpdate(update: StaffUpdate): Promise<void> {
  const callback = update.callback_query;
  if (callback) {
    const chatId = callback.message?.chat?.id;
    const me = chatId && callback.message?.chat?.type === "private" ? await staffForChat(chatId) : null;
    await staffCall("answerCallbackQuery", { callback_query_id: callback.id });
    if (!me || !chatId) return;
    const data = callback.data ?? "m";
    if (data.startsWith("r:")) return promptReply(me, chatId, Number(data.slice(2)));
    if (data === "t") return sendTone(chatId);
    await show(chatId, await screenFor(me, data), callback.message?.message_id);
    // a conversation's card can be answered with a Telegram «reply», like the client's own messages
    if (data.startsWith("c:") && callback.message) await rememberThread(chatId, callback.message.message_id, Number(data.slice(2)));
    return;
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (!message || !chatId || message.chat?.type !== "private") return;

  const me = await staffForChat(chatId);
  if (!me) {
    await staffSend(
      chatId,
      [
        "🔔 <b>تنبيهاتي - ترافليون</b>",
        "",
        "حسابك في تيليجرام غير مربوط بموظف في النظام بعد.",
        `رقم حسابك: <code>${chatId}</code>`,
        "أرسل هذا الرقم للإدارة لتربطه من صفحة «الموظفين»، ثم اضغط /start مرة أخرى.",
      ].join("\n"),
    );
    return;
  }

  const text = (message.text ?? "").trim();

  // a Telegram «reply» to a message about a conversation is the employee's answer to that client
  if (message.reply_to_message && text && !text.startsWith("/")) {
    const conversationId = await threadOf(chatId, message.reply_to_message.message_id);
    if (conversationId) return sendReply(me, chatId, conversationId, text);
    await staffSend(chatId, "لا أعرف لأي عميل هذا الرد — اضغط «✍️ رد» تحت رسالة العميل ثم اكتب ردك.");
    return;
  }
  // a pasted Teletel access token: one word of letters AND digits, nothing else (an English word alone is not one)
  if (/^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{20,64}$/.test(text)) return linkTeletelToken(me, chatId, message.message_id, text);
  if (text.startsWith("/token")) return show(chatId, { text: TOKEN_HELP, buttons: [[BACK]] });
  if (text.startsWith("/report") || text.includes("تقرير")) return show(chatId, await report(me));
  if (text.startsWith("/tone") || text.includes("نغمة")) return sendTone(chatId);

  if (text.startsWith("/start")) {
    await staffSend(
      chatId,
      [
        `🔔 أهلاً ${escapeHtml(me.name)}`,
        "",
        "حسابك مربوط بنظام ترافليون ✅",
        me.agentId
          ? "ستصلك هنا كل محادثة تُسند إليك في تيلي تيل لحظة إسنادها، وأرقامك من «لوحتي»."
          : "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من «الموظفين» لتصلك تنبيهات محادثاتك.",
      ].join("\n"),
    );
  }
  if (text.startsWith("/numbers") || text.includes("أرقامي")) return show(chatId, await numbers(me));
  if (text.startsWith("/waiting") || text.includes("بانتظار")) return show(chatId, await waiting(me));
  await show(chatId, menu(me));
}
