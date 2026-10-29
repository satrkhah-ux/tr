import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getTeletelConfig, teletelConversationUrl, teletelGet } from "@/lib/providers/teletel";
import { clearSlot, escapeHtml, keepInSlot, staffCall, staffForChat, staffSend, staffSendAudio, type StaffMember } from "./staff-bot";
import { buildReport } from "./staff-report";
import { openFor, waitText } from "./staff-numbers";
import { linkTeletelToken, promptReply, recentThread, rememberThread, sendReply, threadOf, TOKEN_HELP } from "./staff-replies";
import { lettersView, resendLetter, signLetter, unsignedLetter } from "./staff-letters";
import { targetView, teamTargetsView } from "./staff-target";
import { openList, openScreen, screenView, unansweredList, weekView } from "./staff-screen";
import { confirmDraft, draft, isBotManager, memberView, promptFor, remindDraft, takePending } from "./staff-manager";
import { adminRows, ADMIN_KEYS, BACK_ADMIN, TO_ADMIN, type AdminKey } from "./staff-admin-core";
import {
  ADMIN_WELCOME,
  adminTeamView,
  alertPickView,
  dayView,
  faceOf,
  moneyView,
  opsVisaView,
  performanceView,
  seesMoney,
  setFace,
  systemView,
} from "./staff-admin";
import { confirmNudge, prepareNudge, waitingConvView, waitingListView, waitingPickView } from "./staff-waiting";
import { grantLeave, leaveView } from "./staff-leave";
import { decisionStep, decisionsView, decisionText, decisionView, interventionView, promptDecision, setDecisionStatus, signalView } from "./staff-decisions";
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
  goal: "🎯 هدفي",
  token: "🔑 الرد باسمي",
  tone: "🎵 النغمة",
  teletel: "🌐 تيلي تيل",
} as const;
type Key = keyof typeof KEYS;

const STAFF_ROWS: string[][] = [
  [KEYS.screen, KEYS.waiting],
  [KEYS.open, KEYS.unanswered],
  [KEYS.today, KEYS.week, KEYS.goal],
  [KEYS.token, KEYS.tone, KEYS.teletel],
];
const STAFF_HINT = "اختر من القائمة، أو اسحب رسالة العميل لترد";

const markup = (rows: string[][], hint: string): Record<string, unknown> => ({
  keyboard: rows.map((row) => row.map((text) => ({ text }))),
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: hint,
});

/**
 * The keyboard this person sees (the owner, 2026-10-26: «واجهته للإدارة إدارية وليس
 * مثل واجهة الموظفين»): an employee's own; a manager's is the administration's
 * (staff-admin-core), unless they switched to the employee's, which then carries
 * the way back. The choice is kept (staff-admin faceOf).
 */
async function keyboardFor(me: StaffMember): Promise<{ markup: Record<string, unknown>; face: "employee" | "admin" | "staff" }> {
  if (!(await isBotManager(me.id))) return { markup: markup(STAFF_ROWS, STAFF_HINT), face: "employee" };
  if ((await faceOf(me.id)) === "admin") return { markup: markup(adminRows(await seesMoney(me.id)), "اختر من لوحة الإدارة"), face: "admin" };
  return { markup: markup([...STAFF_ROWS, [TO_ADMIN]], STAFF_HINT), face: "staff" };
}

/** a manager's screen carries «↩️ لوحة الإدارة» once */
const withBack = (v: Screen): Screen =>
  v.buttons.some((row) => row.some((b) => (b as { callback_data?: string }).callback_data === "ad")) ? v : { ...v, buttons: [...v.buttons, [BACK_ADMIN]] };

const NO_AGENT: Screen = {
  text: "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من صفحة «الموظفين» لتصلك محادثاتك وأرقامك.",
  buttons: [],
};
/** a button pressed before the letter is signed (Telegram's alert: 200 characters at most) */
const LOCKED_ALERT = "🔒 اعتمد الخطاب الرسمي أولاً: اقرأه ثم اضغط تحته «✍️ اعتمدت الخطاب»، وبعدها يعمل البوت كالمعتاد.";
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
      ...all
        .slice(0, 10)
        .map((c) => [{ text: `${c.name.slice(0, 28)} — منذ ${waitText(Math.max(0, Math.floor((now - c.waitingSince) / 60)))}`, callback_data: `c:${c.id}` }]),
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
  const client = conv.meta?.sender?.name?.trim() || `#${id}`;
  const recent = await recentThread(id, client, 8);
  const url = teletelConversationUrl(id);
  return {
    text: [
      `💬 <b>محادثتك مع ${escapeHtml(client)}</b> — آخر ${recent?.shown ?? 0} رسائل`,
      "",
      recent?.text ?? "— لا رسائل —",
      recent?.canReply ? null : "\n⚠️ مرّ أكثر من ٢٤ ساعة على آخر رسالة من العميل — لا يصله إلا قالب معتمد من تيلي تيل.",
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
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
  if (key === "screen") {
    // the screen is pinned on its own; whatever was open before goes
    await clearSlot(chatId, "view");
    return openScreen(me, chatId, NO_AGENT);
  }
  if (key === "tone") return sendTone(chatId);
  if (key === "teletel") return show(chatId, teletelLink());
  if (key === "goal") return show(chatId, await targetView(me));
  const data: Record<Exclude<Key, "screen" | "tone" | "teletel" | "goal">, string> = {
    waiting: "w",
    open: "o:0",
    unanswered: "u",
    today: "d",
    week: "wk",
    token: "k",
  };
  return show(chatId, await screenFor(me, data[key]));
}

type AdminAction = AdminKey | "toAdmin";
const ADMIN_VIEWS: Record<Exclude<AdminKey, "broadcast" | "toStaff">, (me: StaffMember) => Promise<Screen>> = {
  day: dayView,
  waiting: (me) => waitingListView(me, "aw:all:0"),
  leave: (me) => leaveView(me, "lv"),
  urgent: (me) => interventionView(me),
  decisions: decisionsView,
  team: adminTeamView,
  performance: performanceView,
  money: moneyView,
  alert: alertPickView,
  ops: opsVisaView,
  system: systemView,
};

/** The administration's keyboard: the manager checked again, every screen with its way back. */
async function onAdminKey(me: StaffMember, chatId: number, key: AdminAction): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, "هذا للإدارة فقط.");
    return;
  }
  if (key === "toStaff" || key === "toAdmin") {
    await setFace(me.id, key === "toStaff" ? "staff" : "admin");
    return welcome(me, chatId);
  }
  if (key === "broadcast") return promptFor(me, chatId, "broadcast", null);
  return show(chatId, withBack(await ADMIN_VIEWS[key](me)));
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
  "/goal": "goal",
  "/token": "token",
  "/tone": "tone",
};
const ADMIN_COMMANDS: Record<string, AdminAction> = {
  "/admin": "day",
  "/broadcast": "broadcast",
  "/team": "team",
  "/urgent": "urgent",
  "/decisions": "decisions",
};

export function welcomeText(name: string, linked: boolean, manager: boolean): string {
  return [
    `🔔 أهلاً ${escapeHtml(name)}`,
    "",
    "حسابك مربوط بترافليون ون ✅",
    linked
      ? "ستصلك هنا كل محادثة تُسند إليك في تيلي تيل لحظة إسنادها، ورسائل عملائك لترد عليهم من هنا، وتذكير إذا انتظرك عميل."
      : "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من «الموظفين» لتصلك تنبيهات محادثاتك.",
    "",
    "القائمة أسفل المحادثة دائماً — ابدأ بـ «🖥️ شاشتي» وثبّتها أعلى المحادثة، تتحدّث وحدها كل ٥ دقائق.",
    ...(manager ? ["", `للعودة إلى واجهة الإدارة: «${TO_ADMIN}».`] : []),
  ].join("\n");
}

async function welcome(me: StaffMember, chatId: number): Promise<void> {
  const k = await keyboardFor(me);
  await staffSend(
    chatId,
    k.face === "admin" ? ADMIN_WELCOME(me.name.trim()) : welcomeText(me.name, Boolean(me.agentId), k.face === "staff"),
    undefined,
    { reply_markup: k.markup },
    // its own slot: the message that carries the keyboard is not swept away with the views
    "menu",
  );
}

export async function handleStaffUpdate(update: StaffUpdate): Promise<void> {
  const callback = update.callback_query;
  if (callback) {
    const chatId = callback.message?.chat?.id;
    const me = chatId && callback.message?.chat?.type === "private" ? await staffForChat(chatId) : null;
    const data = callback.data ?? "s";
    // an unsigned letter locks every button but the letter's own
    const lock = me && !/^l[sr]:/.test(data) ? await unsignedLetter(me.id) : null;
    await staffCall("answerCallbackQuery", { callback_query_id: callback.id, ...(lock ? { text: LOCKED_ALERT, show_alert: true } : {}) });
    if (!me || !chatId || lock) return;
    if (data.startsWith("lr:")) return resendLetter(me, chatId, Number(data.slice(3)));
    if (data.startsWith("r:")) return promptReply(me, chatId, Number(data.slice(2)));
    // the manager's buttons: each one checks staffbot.manage / employees.manage again (staff-manager.ts)
    if (data.startsWith("b:")) return confirmDraft(me, chatId, callback.message?.message_id, data);
    if (data.startsWith("a:")) return promptFor(me, chatId, "alert", data.slice(2));
    if (data.startsWith("q:")) return remindDraft(me, chatId, data.slice(2));
    const at = callback.message?.message_id;
    // «🏢 لوحة الإدارة» (staff-admin.ts): each screen checks the manager again
    const admin: Record<string, (m: StaffMember) => Promise<Screen>> = {
      ad: dayView,
      at: adminTeamView,
      team: adminTeamView,
      ap: performanceView,
      am: moneyView,
      ao: opsVisaView,
      as: systemView,
      an: alertPickView,
    };
    if (admin[data]) return show(chatId, withBack(await admin[data](me)), at);
    // «⏳ المحادثات المنتظرة» (staff-waiting.ts): the list, one conversation read-only, and a nudge — each checks the manager first
    if (data === "awp") return show(chatId, withBack(await waitingPickView(me)), at);
    if (data.startsWith("aw:")) return show(chatId, withBack(await waitingListView(me, data)), at);
    if (data.startsWith("av:")) return show(chatId, withBack(await waitingConvView(me, Number(data.slice(3)))), at);
    if (data.startsWith("ax:") || data.startsWith("ay:")) return prepareNudge(me, chatId, Number(data.slice(3)), data.startsWith("ay:"));
    if (data.startsWith("bw:")) return confirmNudge(me, chatId, at, data);
    // «🏖️ منح إجازة» (staff-leave.ts): the colleague → days → reason → preview → grant, each step checks the manager first
    if (data === "lv" || data.startsWith("lv:")) return show(chatId, withBack(await leaveView(me, data)), at);
    if (data.startsWith("lvok:")) return grantLeave(me, chatId, data);
    if (data.startsWith("e:")) return show(chatId, withBack(await memberView(me, data.slice(2))), at);
    // «قرارات الإدارة»: the screen's items and the decisions (staff-decisions.ts, each step checks the manager again)
    if (data === "si" || data === "sw") return show(chatId, withBack(await interventionView(me, data === "sw")), at);
    if (data.startsWith("sg:")) return show(chatId, withBack(await signalView(me, data.slice(3))), at);
    if (data.startsWith("sd:")) return promptDecision(me, chatId, data.slice(3));
    if (data === "dn") return promptDecision(me, chatId, null);
    if (/^d[odx]:/.test(data)) return show(chatId, withBack(await decisionStep(me, chatId, data)), at);
    if (data === "dl") return show(chatId, withBack(await decisionsView(me)), at);
    if (data.startsWith("dc:")) return show(chatId, withBack(await decisionView(me, data.slice(3))), at);
    if (data.startsWith("ds:")) return show(chatId, withBack(await setDecisionStatus(me, data)), at);
    // «الخطاب الرسمي»: the employee's signature, and the managers' summary
    if (data.startsWith("ls:")) return signLetter(me, chatId, Number(data.slice(3)), at);
    if (data === "lt") return show(chatId, withBack(await lettersView(me)), at);
    // «🎯 هدفي»: the managers' targets of the whole team
    if (data === "tg") return show(chatId, withBack(await teamTargetsView(me)), at);
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

  // until they sign their letter (the owner, 2026-10-23), nothing they send is used: it goes, and the notice points at the letter
  const lock = await unsignedLetter(me.id);
  if (lock) {
    await staffCall("deleteMessage", { chat_id: chatId, message_id: message.message_id });
    await staffSend(
      chatId,
      [
        `🔒 <b>البوت مقفل حتى تعتمد الخطاب الرسمي رقم ${lock.number}</b>`,
        "",
        "اقرأ الخطاب، ثم اضغط تحته «✍️ اعتمدت الخطاب». يُحفظ اعتمادك في النظام توقيعاً إلكترونياً منك، وبعده يعمل البوت كالمعتاد.",
        "",
        "تنبيهات عملائك تصلك كالمعتاد، وتستطيع الرد عليهم من تيلي تيل مباشرة.",
      ].join("\n"),
      [[{ text: "📄 اعرض الخطاب", callback_data: `lr:${lock.id}` }]],
    );
    return;
  }

  const text = (message.text ?? "").trim();
  // what the employee pressed or typed goes once it is answered: the chat keeps the answer only
  const drop = () => staffCall("deleteMessage", { chat_id: chatId, message_id: message.message_id });
  // what may still be wanted (a refused reply, a stray text) stays until the next thing they open
  const later = () => keepInSlot(chatId, "view", message.message_id);

  // after «📢 إعلان عام» / «🔔 تنبيه له», the next text (reply or not) is the draft; the preview quotes it and still asks before anything goes
  if (text && !text.startsWith("/") && ![...Object.values(KEYS), ...Object.values(ADMIN_KEYS), TO_ADMIN].includes(text)) {
    const pending = await takePending(chatId);
    if (pending) {
      if (pending.kind === "decision") await decisionText(me, chatId, text, pending.sourceKey);
      else await draft(me, chatId, text, pending.kind === "alert" ? pending.targetId : null);
      await drop();
      return;
    }
  }
  // a Telegram «reply» to anything about a conversation is the answer to that client
  if (message.reply_to_message && text && !text.startsWith("/")) {
    const conversationId = await threadOf(chatId, message.reply_to_message.message_id);
    if (conversationId) await sendReply(me, chatId, conversationId, text, message.message_id);
    else await staffSend(chatId, "لا أعرف لأي عميل هذا الرد — اضغط «✍️ رد» تحت رسالة العميل ثم اكتب ردك.");
    await later();
    return;
  }
  // a pasted Teletel access token: one word of letters AND digits, nothing else (an English word alone is not one)
  if (/^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{20,64}$/.test(text)) return linkTeletelToken(me, chatId, message.message_id, text);

  const adminKey: AdminAction | undefined =
    (Object.keys(ADMIN_KEYS) as AdminKey[]).find((k) => ADMIN_KEYS[k] === text) ?? (text === TO_ADMIN ? "toAdmin" : ADMIN_COMMANDS[text.split(/[\s@]/)[0]]);
  if (adminKey) {
    await drop();
    return onAdminKey(me, chatId, adminKey);
  }
  const key = text.startsWith("/start") ? "start" : ((Object.keys(KEYS) as Key[]).find((k) => KEYS[k] === text) ?? COMMANDS[text.split(/[\s@]/)[0]]);
  if (key) {
    await drop();
    return key === "start" ? welcome(me, chatId) : onKey(me, chatId, key);
  }
  // anything else typed: the keyboard again, with a word on how to answer a client
  await staffSend(
    chatId,
    "اختر من القائمة أسفل المحادثة.\nللرد على عميل: اسحب رسالته (Reply) واكتب ردك، أو اضغط «✍️ رد».",
    undefined,
    { reply_markup: (await keyboardFor(me)).markup },
    "menu",
  );
  await later();
}
