import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { conversationThread, getTeletelConfig, teletelConversationUrl, teletelGet } from "@/lib/providers/teletel";
import { escapeHtml, staffCall, staffForChat, staffSend, staffSendAudio, type StaffMember } from "./staff-bot";
import { buildReport } from "./staff-report";
import { openFor, waitText } from "./staff-numbers";
import { linkTeletelToken, promptReply, rememberThread, sendReply, threadOf, TOKEN_HELP } from "./staff-replies";
import { openList, openScreen, screenView, unansweredList, weekView } from "./staff-screen";
import { confirmDraft, draft, isBotManager, memberView, promptFor, remindDraft, takePending, teamView } from "./staff-manager";
import type { InlineButton } from "./ops-bot";

/**
 * What «تنبيهاتي» answers. Private chats only, and only to a Telegram account
 * linked to an ACTIVE employee. An unlinked account gets its own ID back, so
 * the administration can link it from «الموظفين», and nothing else.
 *
 * Two kinds of buttons:
 *   - the keyboard under the chat (always there, the employee's menu). Each key
 *     arrives as its own text and gets a fresh answer;
 *   - the buttons on a message, which replace that message's text in place, so
 *     going through lists does not fill the chat.
 * Every answer is about the employee's own Teletel agent. A conversation that is
 * not theirs is refused, even when someone asks for it by number.
 */

export type StaffUpdate = {
  message?: {
    message_id: number;
    chat?: { id?: number; type?: string };
    from?: { id?: number; first_name?: string };
    text?: string;
    reply_to_message?: { message_id: number; text?: string };
  };
  callback_query?: { id: string; from?: { id?: number }; data?: string; message?: { message_id: number; chat?: { id?: number; type?: string } } };
};

type Screen = { text: string; buttons: InlineButton[][] };

const BACK: InlineButton = { text: "↩️ شاشتي", callback_data: "s" };

/** The keyboard's keys, by what they open. The labels are what Telegram sends back as text. */
const KEYS = {
  screen: "🖥️ شاشتي",
  waiting: "⏳ بانتظار ردي",
  open: "📂 محادثاتي المفتوحة",
  unanswered: "🆕 بلا رد",
  today: "📈 أدائي اليوم",
  week: "📅 أدائي الأسبوع",
  token: "🔑 الرد باسمي",
  tone: "🎵 النغمة",
  teletel: "🌐 تيلي تيل",
  team: "👥 الفريق",
  broadcast: "📢 إعلان عام",
} as const;
type Key = keyof typeof KEYS;

function keyboard(manager: boolean): Record<string, unknown> {
  const rows: string[][] = [
    [KEYS.screen, KEYS.waiting],
    [KEYS.open, KEYS.unanswered],
    [KEYS.today, KEYS.week],
    [KEYS.token, KEYS.tone, KEYS.teletel],
  ];
  if (manager) rows.push([KEYS.team, KEYS.broadcast]);
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "اختر من القائمة، أو اسحب رسالة العميل لترد",
  };
}

const NO_AGENT: Screen = {
  text: "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من صفحة «الموظفين» لتصلك محادثاتك وأرقامك.",
  buttons: [],
};
const UNREACHABLE: Screen = { text: "تعذّر الوصول إلى تيلي تيل الآن — جرّب بعد دقيقة.", buttons: [[BACK]] };

async function waiting(me: StaffMember): Promise<Screen> {
  if (!me.agentId) return NO_AGENT;
  const open = await openFor(me.agentId);
  if (!open) return UNREACHABLE;
  const now = Date.now() / 1000;
  const all = open.filter((c) => c.waitingSince > 0);
  if (!all.length) return { text: "✅ لا أحد ينتظر ردك الآن.", buttons: [[BACK]] };
  return {
    text: [`⏳ <b>بانتظار ردك</b> — ${all.length}`, "", "الأقدم أولاً. اضغط على العميل لترى آخر رسائله وترد."].join("\n"),
    buttons: [
      ...all.slice(0, 10).map((c) => [{ text: `${c.name.slice(0, 28)} — منذ ${waitText(Math.max(0, Math.floor((now - c.waitingSince) / 60)))}`, callback_data: `c:${c.id}` }]),
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
    text: [
      `💬 <b>${escapeHtml(conv.meta?.sender?.name?.trim() || `#${id}`)}</b>`,
      "",
      ...(lines.length ? lines : ["— لا رسائل —"]),
      thread?.canReply ? "" : "\n⚠️ مرّ أكثر من ٢٤ ساعة على آخر رسالة من العميل — لا يصله إلا قالب معتمد من تيلي تيل.",
    ]
      .join("\n")
      .trim(),
    buttons: [
      [{ text: "✍️ رد", callback_data: `r:${id}` }, ...(url ? [{ text: "💬 افتح في تيلي تيل", url }] : [])],
      [{ text: "⏳ بانتظار ردي", callback_data: "w" }, BACK],
    ],
  };
}

async function today(me: StaffMember): Promise<Screen> {
  if (!me.agentId) return NO_AGENT;
  const r = await buildReport(me);
  return r ? { text: r.text, buttons: [[{ text: "📅 أدائي الأسبوع", callback_data: "wk" }, BACK]] } : UNREACHABLE;
}

const TONE_STEPS = [
  "🎵 <b>نغمة ترافليون للتنبيهات</b>",
  "",
  "لتسمعها كلما وصلك تنبيه من هذا البوت:",
  "١. اضغط مطوّلاً على الملف الصوتي ← «حفظ للإشعارات» (Save for Notifications).",
  "٢. افتح اسم البوت أعلى المحادثة ← «الإشعارات» ← «الصوت».",
  "٣. اختر «نغمة ترافليون».",
].join("\n");

/** The brand tone (public/sounds: the chime's three notes, then the owner's traveliun.mp3, 4.9 s / 78 KB, under Telegram's 5 s / 300 KB for a notification sound) with the steps. */
async function sendTone(chatId: number): Promise<void> {
  const bytes = await readFile(join(process.cwd(), "public", "sounds", "traveliun-tone.mp3")).catch(() => null);
  if (!bytes || !(await staffSendAudio(chatId, { bytes, name: "traveliun-tone.mp3", title: "نغمة ترافليون" }, TONE_STEPS))) {
    await staffSend(chatId, "تعذّر إرسال النغمة الآن — جرّب بعد دقيقة.");
  }
}

function teletelLink(): Screen {
  const config = getTeletelConfig();
  return config
    ? { text: "🌐 تيلي تيل", buttons: [[{ text: "افتح تيلي تيل", url: `${config.baseUrl}/app/accounts/${config.accountId}/dashboard` }]] }
    : UNREACHABLE;
}

/** What a message button opens, in place. */
async function screenFor(me: StaffMember, data: string): Promise<Screen> {
  if (data === "w") return waiting(me);
  if (data === "u") return (await unansweredList(me)) ?? (me.agentId ? UNREACHABLE : NO_AGENT);
  if (data.startsWith("o:")) return (await openList(me, Number(data.slice(2)) || 0)) ?? (me.agentId ? UNREACHABLE : NO_AGENT);
  if (data.startsWith("c:")) return conversation(me, Number(data.slice(2)));
  if (data === "d") return today(me);
  if (data === "wk") return (await weekView(me)) ?? (me.agentId ? UNREACHABLE : NO_AGENT);
  if (data === "k") return { text: TOKEN_HELP, buttons: [[BACK]] };
  return (await screenView(me)) ?? (me.agentId ? UNREACHABLE : NO_AGENT);
}

/** Replace a message's text in place, or post a new one when it can no longer be edited. */
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
  await staffSend(chatId, screen.text, screen.buttons.length ? screen.buttons : undefined);
}

async function onKey(me: StaffMember, chatId: number, key: Key): Promise<void> {
  if (key === "screen") return openScreen(me, chatId, NO_AGENT);
  if (key === "tone") return sendTone(chatId);
  if (key === "broadcast") return promptFor(me, chatId, "broadcast", null);
  if (key === "team") return show(chatId, await teamView(me));
  if (key === "teletel") return show(chatId, teletelLink());
  const data: Record<Exclude<Key, "screen" | "tone" | "broadcast" | "team" | "teletel">, string> = { waiting: "w", open: "o:0", unanswered: "u", today: "d", week: "wk", token: "k" };
  return show(chatId, await screenFor(me, data[key]));
}

const COMMANDS: Record<string, Key> = {
  "/screen": "screen",
  "/menu": "screen",
  "/numbers": "screen",
  "/waiting": "waiting",
  "/open": "open",
  "/unanswered": "unanswered",
  "/report": "today",
  "/week": "week",
  "/token": "token",
  "/tone": "tone",
  "/broadcast": "broadcast",
  "/team": "team",
};

async function welcome(me: StaffMember, chatId: number): Promise<void> {
  await staffSend(
    chatId,
    [
      `🔔 أهلاً ${escapeHtml(me.name)}`,
      "",
      "حسابك مربوط بنظام ترافليون ✅",
      me.agentId
        ? "ستصلك هنا كل محادثة تُسند إليك في تيلي تيل لحظة إسنادها، ورسائل عملائك لترد عليهم من هنا، وتذكير إذا انتظرك عميل."
        : "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من «الموظفين» لتصلك تنبيهات محادثاتك.",
      "",
      "القائمة أسفل المحادثة دائماً — ابدأ بـ «🖥️ شاشتي» وثبّتها أعلى المحادثة، تتحدّث وحدها كل ٥ دقائق.",
    ].join("\n"),
    undefined,
    { reply_markup: keyboard(await isBotManager(me.id)) },
  );
}

export async function handleStaffUpdate(update: StaffUpdate): Promise<void> {
  const callback = update.callback_query;
  if (callback) {
    const chatId = callback.message?.chat?.id;
    const me = chatId && callback.message?.chat?.type === "private" ? await staffForChat(chatId) : null;
    await staffCall("answerCallbackQuery", { callback_query_id: callback.id });
    if (!me || !chatId) return;
    const data = callback.data ?? "s";
    if (data.startsWith("r:")) return promptReply(me, chatId, Number(data.slice(2)));
    // the manager's buttons: each one checks staffbot.manage / employees.manage again (staff-manager.ts)
    if (data.startsWith("b:")) return confirmDraft(me, chatId, callback.message?.message_id, data);
    if (data.startsWith("a:")) return promptFor(me, chatId, "alert", data.slice(2));
    if (data.startsWith("q:")) return remindDraft(me, chatId, data.slice(2));
    if (data === "team") return show(chatId, await teamView(me), callback.message?.message_id);
    if (data.startsWith("e:")) return show(chatId, await memberView(me, data.slice(2)), callback.message?.message_id);
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
      undefined,
      { reply_markup: { remove_keyboard: true } },
    );
    return;
  }

  const text = (message.text ?? "").trim();

  // after «📢 إعلان عام» / «🔔 تنبيه له», the next text (reply or not) is the draft; the preview still asks before anything goes
  if (text && !text.startsWith("/") && !(Object.values(KEYS) as string[]).includes(text)) {
    const pending = await takePending(chatId);
    if (pending) return draft(me, chatId, text, pending.kind === "alert" ? pending.targetId : null);
  }
  // a Telegram «reply» to anything about a conversation is the answer to that client
  if (message.reply_to_message && text && !text.startsWith("/")) {
    const conversationId = await threadOf(chatId, message.reply_to_message.message_id);
    if (conversationId) return sendReply(me, chatId, conversationId, text);
    await staffSend(chatId, "لا أعرف لأي عميل هذا الرد — اضغط «✍️ رد» تحت رسالة العميل ثم اكتب ردك.");
    return;
  }
  // a pasted Teletel access token: one word of letters AND digits, nothing else (an English word alone is not one)
  if (/^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{20,64}$/.test(text)) return linkTeletelToken(me, chatId, message.message_id, text);

  if (text.startsWith("/start")) return welcome(me, chatId);
  const key = (Object.keys(KEYS) as Key[]).find((k) => KEYS[k] === text) ?? COMMANDS[text.split(/[\s@]/)[0]];
  if (key) return onKey(me, chatId, key);
  // anything else typed: the keyboard again, with a word on how to answer a client
  await staffSend(chatId, "اختر من القائمة أسفل المحادثة.\nللرد على عميل: اسحب رسالته (Reply) واكتب ردك، أو اضغط «✍️ رد».", undefined, {
    reply_markup: keyboard(await isBotManager(me.id)),
  });
}
