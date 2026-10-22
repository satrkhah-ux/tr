import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret, isVaultConfigured } from "@/lib/crypto/secrets";
import { logAudit } from "@/lib/data/audit";
import {
  sendTeletelMessageAs,
  teletelAgentOfToken,
  teletelConversationUrl,
  teletelGet,
  teletelMessageStatus,
  type DeliveryStatus,
} from "@/lib/providers/teletel";
import { escapeHtml, staffCall, staffForAgent, staffSend, type StaffMember } from "./staff-bot";
import type { InlineButton } from "./ops-bot";

/**
 * «تنبيهاتي» stage c: the client writes, the employee answers from Telegram.
 *
 *   - Each incoming client message in a conversation assigned to a linked
 *     employee is forwarded to them, with «✍️ رد».
 *   - A Telegram «reply» to any message the bot sent about a conversation
 *     (staff_bot_threads) is an answer to that client. It is sent with the
 *     employee's OWN Teletel token, so Teletel, the SLA clocks and the client all
 *     see it from them, never from the system's account.
 *   - The bot confirms the send, then edits that confirmation as WhatsApp
 *     reports it: delivered, read, or failed. The webhook's message_updated says
 *     it at once, and the minute job asks for anything still open.
 *
 * Nothing is sent that the employee did not write and send themselves. The bot
 * only carries their words.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export async function rememberThread(chatId: number, messageId: number, conversationId: number): Promise<void> {
  await db().from("staff_bot_threads").upsert({ chat_id: chatId, message_id: messageId, conversation_id: conversationId });
}

export async function threadOf(chatId: number, messageId: number): Promise<number | null> {
  const { data } = await db().from("staff_bot_threads").select("conversation_id").eq("chat_id", chatId).eq("message_id", messageId).maybeSingle();
  return (data as { conversation_id: number } | null)?.conversation_id ?? null;
}

/** «14:05», or «21/10 14:05» when it was not today (Riyadh). */
export function whenText(atSec: number, nowMs = Date.now()): string {
  const opts = { timeZone: "Asia/Riyadh" } as const;
  const time = new Date(atSec * 1000).toLocaleTimeString("ar-SA-u-nu-latn", { ...opts, hour: "2-digit", minute: "2-digit" });
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", opts);
  if (day(atSec * 1000) === day(nowMs)) return time;
  return `${new Date(atSec * 1000).toLocaleDateString("ar-SA-u-nu-latn-ca-gregory", { ...opts, day: "2-digit", month: "2-digit" })} ${time}`;
}

export type ThreadLine = { id: number; at: number; text: string; fromClient: boolean; sender: string | null };

/**
 * A conversation as the employee reads it in the bot (the user, 2026-10-22:
 * «المحادثات متداخلة … اجعل شيء واضح من ارسل و من اجاب»). Each message is its
 * own block, headed by who wrote it and when: the client by name, a colleague
 * by name, or «مُراد» for an automatic reply (his murad_log reply ids). A line
 * separates the messages.
 */
export function threadText(clientName: string, lines: ThreadLine[], muradIds: Set<number>, nowMs = Date.now()): string {
  if (!lines.length) return "— لا رسائل —";
  return lines
    .map((m) => {
      const who = m.fromClient
        ? `👤 <b>العميل — ${escapeHtml(clientName)}</b>`
        : muradIds.has(m.id)
          ? "🤖 <b>مُراد (رد آلي)</b>"
          : `🟢 <b>${escapeHtml(m.sender?.trim() || "ترافليون")}</b>`;
      return `${who} · ${whenText(m.at, nowMs)}\n${escapeHtml(m.text.slice(0, 400))}`;
    })
    .join("\n┈┈┈┈┈┈┈┈\n");
}

export function replyButtons(conversationId: number): InlineButton[][] {
  const url = teletelConversationUrl(conversationId);
  return [[{ text: "✍️ رد", callback_data: `r:${conversationId}` }, ...(url ? [{ text: "💬 تيلي تيل", url }] : [])]];
}

/** What a Teletel message_created / message_updated webhook carries. */
export type TeletelMessageEvent = {
  event?: string;
  id?: number;
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  status?: string;
  content_attributes?: { external_error?: string | null } | null;
  attachments?: { file_type?: string }[];
  conversation?: { id?: number; meta?: { sender?: { name?: string | null } | null; assignee?: { id?: number } | null } | null } | null;
};

/** An incoming client message → the assignee's Telegram, when they are linked. */
export async function forwardClientMessage(body: TeletelMessageEvent): Promise<void> {
  const incoming = body.message_type === "incoming" || body.message_type === 0;
  const conversationId = Number(body.conversation?.id);
  const agent = body.conversation?.meta?.assignee?.id;
  if (!incoming || body.private || !conversationId || typeof agent !== "number") return;
  const member = await staffForAgent(agent);
  if (!member) return;
  const text = (body.content ?? "").trim();
  const files = body.attachments?.length ? `📎 ${body.attachments.length > 1 ? `${body.attachments.length} مرفقات` : "مرفق"} — افتحه في تيلي تيل` : "";
  if (!text && !files) return;
  const name = body.conversation?.meta?.sender?.name?.trim() || `#${conversationId}`;
  const sent = await staffSend(
    member.chatId,
    [`👤 <b>رسالة من العميل — ${escapeHtml(name)}</b>`, text ?escapeHtml(text.slice(0, 1500)) : null, files || null].filter(Boolean).join("\n"),
    replyButtons(conversationId),
  );
  if (sent.ok) await rememberThread(member.chatId, sent.messageId, conversationId);
}

/** «✍️ رد»: a prompt Telegram opens the keyboard on. The answer to it is the reply. */
export async function promptReply(me: StaffMember, chatId: number, conversationId: number): Promise<void> {
  const conv = await mine(me, conversationId);
  if (!conv.ok) {
    await staffSend(chatId, conv.text);
    return;
  }
  const sent = await staffSend(chatId, `✍️ اكتب ردك على <b>${escapeHtml(conv.name)}</b> — يصله من حسابك في تيلي تيل:`, undefined, {
    reply_markup: { force_reply: true, input_field_placeholder: "ردك للعميل" },
  });
  if (sent.ok) await rememberThread(chatId, sent.messageId, conversationId);
}

type Mine = { ok: true; name: string; canReply: boolean } | { ok: false; text: string };

/** The conversation, if it is still this employee's. Read with the system token, before anything is sent. */
async function mine(me: StaffMember, conversationId: number): Promise<Mine> {
  if (!me.agentId) return { ok: false, text: "حسابك في تيلي تيل غير مربوط — اطلب من الإدارة ربطه من «الموظفين»." };
  const conv = await teletelGet<{ can_reply?: boolean; meta?: { assignee?: { id?: number } | null; sender?: { name?: string | null } | null } }>(
    `/conversations/${conversationId}`,
  );
  if (!conv) return { ok: false, text: "تعذّر الوصول إلى تيلي تيل الآن — جرّب بعد دقيقة." };
  if (conv.meta?.assignee?.id !== me.agentId) return { ok: false, text: "هذه المحادثة لم تعد مسندة إليك — لم يُرسل شيء." };
  return { ok: true, name: conv.meta?.sender?.name?.trim() || `#${conversationId}`, canReply: conv.can_reply === true };
}

async function tokenOf(me: StaffMember): Promise<string | null> {
  const { data } = await db().from("staff_teletel_tokens").select("token_enc, agent_id").eq("employee_id", me.id).maybeSingle();
  const row = data as { token_enc: string; agent_id: number } | null;
  // a token linked to another agent than theirs today (they were re-linked on «الموظفين») is not theirs to use
  if (!row || row.agent_id !== me.agentId) return null;
  try {
    return decryptSecret(row.token_enc);
  } catch {
    return null;
  }
}

export const TOKEN_HELP = [
  "🔑 <b>لترسل الردود باسمك من هنا</b> (مرة واحدة):",
  "١. افتح تيلي تيل من الكمبيوتر أو الجوال.",
  "٢. اضغط صورتك أسفل القائمة ← «إعدادات الملف الشخصي» (Profile settings).",
  "٣. انزل إلى «رمز الوصول» (Access Token) وانسخه.",
  "٤. الصقه هنا في رسالة وحدها.",
  "",
  "<i>يُحذف الرمز من المحادثة فوراً ويُحفظ مشفّراً، ولا يراه أحد.</i>",
].join("\n");

/** A pasted access token: checked to be THIS employee's agent, stored encrypted, and the message holding it deleted. */
export async function linkTeletelToken(me: StaffMember, chatId: number, messageId: number, token: string): Promise<void> {
  await staffCall("deleteMessage", { chat_id: chatId, message_id: messageId });
  if (!me.agentId) {
    await staffSend(chatId, "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من «الموظفين» ثم أعد لصق الرمز.");
    return;
  }
  if (!isVaultConfigured()) {
    await staffSend(chatId, "تعذّر حفظ الرمز الآن (التشفير غير مضبوط على الخادم) — أبلغ الإدارة.");
    return;
  }
  const agent = await teletelAgentOfToken(token);
  if (agent !== me.agentId) {
    await staffSend(chatId, agent === null ? "⚠️ لم يقبل تيلي تيل هذا الرمز — انسخه من جديد والصقه." : "⚠️ هذا الرمز لحساب آخر في تيلي تيل وليس لحسابك — لم يُحفظ.");
    await logAudit({ action: "staff_bot.token_refused", entity: "employees", entity_id: me.id, meta: { agent }, actor: { id: me.id, label: me.name } });
    return;
  }
  await db().from("staff_teletel_tokens").upsert({ employee_id: me.id, token_enc: encryptSecret(token), agent_id: agent, linked_at: new Date().toISOString() });
  await logAudit({ action: "staff_bot.token_linked", entity: "employees", entity_id: me.id, meta: { agent }, actor: { id: me.id, label: me.name } });
  await staffSend(chatId, "✅ تم ربط حسابك في تيلي تيل — ردودك من هنا تصل للعميل باسمك.\nللرد: اسحب رسالة العميل (Reply) واكتب ردك، أو اضغط «✍️ رد».");
}

const STATUS_TEXT: Record<DeliveryStatus, string> = {
  sent: "✓ أُرسل — بانتظار وصوله إلى واتساب العميل",
  delivered: "✓✓ وصل إلى العميل",
  read: "✓✓ قرأه العميل 👁",
  failed: "⚠️ لم يصل إلى العميل",
};

function confirmation(name: string, content: string, status: DeliveryStatus, error: string | null): string {
  return [
    `📤 ردّك على <b>${escapeHtml(name)}</b>:`,
    `«${escapeHtml(content.slice(0, 300))}»`,
    "",
    `<b>${STATUS_TEXT[status]}</b>${status === "failed" && error ? `\n${escapeHtml(error.slice(0, 200))}` : ""}`,
  ].join("\n");
}

/** The employee's own words → the client, as them. Refused with the reason when it cannot go. */
export async function sendReply(me: StaffMember, chatId: number, conversationId: number, content: string): Promise<void> {
  const text = content.trim();
  if (!text) return;
  const conv = await mine(me, conversationId);
  if (!conv.ok) {
    await staffSend(chatId, conv.text);
    return;
  }
  if (!conv.canReply) {
    await staffSend(chatId, "⚠️ لم يُرسل: مرّ أكثر من ٢٤ ساعة على آخر رسالة من العميل، وواتساب لا يقبل إلا قالباً معتمداً — أرسله من تيلي تيل.", replyButtons(conversationId).map((row) => row.slice(1)));
    return;
  }
  const token = await tokenOf(me);
  if (!token) {
    await staffSend(chatId, `لم يُرسل ردك بعد — حسابك في تيلي تيل غير مربوط بالبوت.\n\n${TOKEN_HELP}`);
    return;
  }
  const messageId = await sendTeletelMessageAs(token, conversationId, text);
  if (!messageId) {
    await staffSend(chatId, "⚠️ لم يُرسل: رفض تيلي تيل الرسالة. إن تكرر، انسخ رمز الوصول من جديد والصقه هنا.");
    return;
  }
  const sent = await staffSend(chatId, confirmation(conv.name, text, "sent", null), replyButtons(conversationId));
  if (sent.ok) await rememberThread(chatId, sent.messageId, conversationId);
  await db().from("staff_bot_replies").insert({
    employee_id: me.id,
    conversation_id: conversationId,
    teletel_message_id: messageId,
    chat_id: chatId,
    tg_message_id: sent.ok ? sent.messageId : null,
    content: text,
  });
  await logAudit({ action: "staff_bot.reply_sent", entity: "teletel_conversation", entity_id: String(conversationId), meta: { message: messageId }, actor: { id: me.id, label: me.name } });
}

type ReplyRow = { id: number; conversation_id: number; teletel_message_id: number; chat_id: number; tg_message_id: number | null; content: string; status: DeliveryStatus };
const RANK: Record<DeliveryStatus, number> = { sent: 0, delivered: 1, read: 2, failed: 3 };

/** A new WhatsApp status for a reply: stored, and the confirmation edited. It never goes backwards (read stays read). */
async function applyStatus(row: ReplyRow, status: DeliveryStatus, error: string | null): Promise<boolean> {
  if (RANK[status] <= RANK[row.status]) return false;
  await db().from("staff_bot_replies").update({ status, error, updated_at: new Date().toISOString() }).eq("id", row.id);
  if (row.tg_message_id) {
    const conv = await teletelGet<{ meta?: { sender?: { name?: string | null } | null } }>(`/conversations/${row.conversation_id}`);
    await staffCall("editMessageText", {
      chat_id: row.chat_id,
      message_id: row.tg_message_id,
      text: confirmation(conv?.meta?.sender?.name?.trim() || `#${row.conversation_id}`, row.content, status, error),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: replyButtons(row.conversation_id) },
    });
  }
  return true;
}

const REPLY_COLS = "id, conversation_id, teletel_message_id, chat_id, tg_message_id, content, status";

/**
 * Teletel's message_updated: the status of one of our replies, at once. When
 * the event does not carry the status itself, it is read back for that one
 * message, and only for messages the bot sent.
 */
export async function onMessageUpdated(body: TeletelMessageEvent): Promise<void> {
  const id = Number(body.id);
  if (!id) return;
  const { data } = await db().from("staff_bot_replies").select(REPLY_COLS).eq("teletel_message_id", id).maybeSingle();
  const row = data as ReplyRow | null;
  if (!row) return;
  const given = (["sent", "delivered", "read", "failed"] as const).find((s) => s === body.status);
  const now = given ? { status: given, error: body.content_attributes?.external_error ?? null } : await teletelMessageStatus(row.conversation_id, id);
  if (now) await applyStatus(row, now.status, now.error);
}

/** The minute job: replies of the last two hours still short of «read», asked once each. */
export async function refreshDeliveries(): Promise<{ checked: number; changed: number }> {
  const { data } = await db()
    .from("staff_bot_replies")
    .select(REPLY_COLS)
    .in("status", ["sent", "delivered"])
    .gte("created_at", new Date(Date.now() - 2 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  let changed = 0;
  for (const row of (data ?? []) as ReplyRow[]) {
    const now = await teletelMessageStatus(row.conversation_id, row.teletel_message_id);
    if (now && (await applyStatus(row, now.status, now.error))) changed += 1;
  }
  return { checked: data?.length ?? 0, changed };
}
