import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { escapeHtml, staffCall, staffSend, type StaffMember } from "./staff-bot";

/**
 * «📢 إعلان عام» (the owner, 2026-10-22, item 7). The administration writes an
 * announcement in the bot, and every linked colleague gets it.
 *
 * Who may send it: employees.manage, read through followup_employee_can, so
 * the role, the permissions given to one person and the ones taken away all
 * count, as everywhere else. It is checked when the menu shows the button, again
 * when the draft is written, and again at «إرسال». A button is not an
 * authorisation.
 *
 * Nothing goes out before the manager has seen the preview and confirmed it.
 * The draft → sending claim makes a double tap send once.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** The reply-prompt's first words: a Telegram reply to it is the announcement's text. */
export const BROADCAST_PROMPT = "📢 اكتب الإعلان";

export async function canBroadcast(employeeId: string): Promise<boolean> {
  const { data, error } = await db().rpc("followup_employee_can", { p_employee: employeeId, p_key: "employees.manage" });
  return !error && data === true;
}

type Recipient = { id: string; name: string; chatId: number };

/** Every ACTIVE colleague with a linked Telegram, except the sender. */
async function recipients(senderId: string): Promise<Recipient[]> {
  const { data } = await db().from("employees").select("id, arabic_name, telegram_chat_id").eq("status", "Active").not("telegram_chat_id", "is", null);
  return ((data ?? []) as { id: string; arabic_name: string; telegram_chat_id: number | string }[])
    .filter((e) => e.id !== senderId)
    .map((e) => ({ id: e.id, name: e.arabic_name, chatId: Number(e.telegram_chat_id) }))
    .filter((e) => Number.isFinite(e.chatId) && e.chatId !== 0);
}

const REFUSED = "هذا الأمر للإدارة فقط.";

/** «📢 إعلان عام»: a prompt that opens the keyboard. The answer to it becomes the draft. */
export async function promptBroadcast(me: StaffMember, chatId: number): Promise<void> {
  if (!(await canBroadcast(me.id))) {
    await staffSend(chatId, REFUSED);
    return;
  }
  const count = (await recipients(me.id)).length;
  await staffSend(chatId, `${BROADCAST_PROMPT} الذي يصل لكل الموظفين المربوطين بالبوت (${count}):\n<i>تراه قبل الإرسال وتؤكده.</i>`, undefined, {
    reply_markup: { force_reply: true, input_field_placeholder: "نص الإعلان" },
  });
}

export function broadcastText(content: string, senderName: string): string {
  return `📢 <b>إعلان من الإدارة</b>\n\n${escapeHtml(content)}\n\n— ${escapeHtml(senderName)}`;
}

/** The text the manager wrote → a draft and its preview, with «إرسال» and «إلغاء». */
export async function draftBroadcast(me: StaffMember, chatId: number, content: string): Promise<void> {
  if (!(await canBroadcast(me.id))) {
    await staffSend(chatId, REFUSED);
    return;
  }
  const text = content.trim().slice(0, 3500);
  if (!text) return;
  const [{ data, error }, list] = await Promise.all([
    db().from("staff_bot_broadcasts").insert({ sender_id: me.id, content: text }).select("id").single(),
    recipients(me.id),
  ]);
  if (error || !data) {
    await staffSend(chatId, "تعذّر حفظ الإعلان — جرّب مرة أخرى.");
    return;
  }
  const id = (data as { id: number }).id;
  await staffSend(chatId, `👁 <b>هكذا يصل الإعلان إلى ${list.length} موظف:</b>\n\n${broadcastText(text, me.name)}`, [
    [
      { text: `✅ إرسال للجميع (${list.length})`, callback_data: `b:send:${id}` },
      { text: "✖️ إلغاء", callback_data: `b:no:${id}` },
    ],
  ]);
}

/** «إرسال» or «إلغاء» on the preview: claimed once, then sent or dropped, and the sender told who it reached. */
export async function confirmBroadcast(me: StaffMember, chatId: number, previewId: number | undefined, data: string): Promise<void> {
  const [, action, raw] = data.split(":");
  const id = Number(raw);
  if (!Number.isInteger(id) || !(await canBroadcast(me.id))) {
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
    .select("content")
    .maybeSingle();
  // the buttons go either way, so the preview cannot be pressed again
  if (previewId) await staffCall("editMessageReplyMarkup", { chat_id: chatId, message_id: previewId, reply_markup: { inline_keyboard: [] } });
  if (!claimed) {
    await staffSend(chatId, "هذا الإعلان أُرسل أو أُلغي من قبل.");
    return;
  }
  if (next === "cancelled") {
    await staffSend(chatId, "✖️ أُلغي الإعلان — لم يُرسل لأحد.");
    return;
  }

  const content = (claimed as { content: string }).content;
  const list = await recipients(me.id);
  const missed: string[] = [];
  for (const r of list) {
    if (!(await staffSend(r.chatId, broadcastText(content, me.name))).ok) missed.push(r.name);
  }
  const delivered = list.length - missed.length;
  await db()
    .from("staff_bot_broadcasts")
    .update({ status: "sent", recipients: list.length, delivered, not_delivered: missed, sent_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit({
    action: "staff_bot.broadcast_sent",
    entity: "staff_bot_broadcasts",
    entity_id: String(id),
    meta: { recipients: list.length, delivered, not_delivered: missed },
    actor: { id: me.id, label: me.name },
  });
  await staffSend(
    chatId,
    [
      `✅ وصل الإعلان إلى <b>${delivered}</b> من ${list.length} موظف.`,
      missed.length ? `لم يصل إلى: ${missed.map(escapeHtml).join("، ")} — لم يضغطوا «ابدأ» في البوت بعد.` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
