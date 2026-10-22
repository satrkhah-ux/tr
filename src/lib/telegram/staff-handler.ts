import "server-only";
import { escapeHtml, staffCall, staffForChat, staffSend } from "./staff-bot";

/**
 * What «تنبيهاتي» answers. Private chats only, and only to a Telegram account
 * that is linked to an ACTIVE employee. An unlinked account gets its own ID back,
 * so the administration can link it from «الموظفين», and nothing else.
 */

export type StaffUpdate = {
  message?: { message_id: number; chat?: { id?: number; type?: string }; from?: { id?: number; first_name?: string }; text?: string };
  callback_query?: { id: string; from?: { id?: number }; data?: string; message?: { message_id: number; chat?: { id?: number; type?: string } } };
};

export async function handleStaffUpdate(update: StaffUpdate): Promise<void> {
  if (update.callback_query) {
    await staffCall("answerCallbackQuery", { callback_query_id: update.callback_query.id });
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

  await staffSend(
    chatId,
    [
      `🔔 أهلاً ${escapeHtml(me.name)}`,
      "",
      "حسابك مربوط بنظام ترافليون ✅",
      me.agentId
        ? "ستصلك هنا تنبيهات المحادثات التي تُسند إليك في تيلي تيل، وأرقامك اليومية."
        : "حسابك في تيلي تيل غير مربوط بعد — اطلب من الإدارة ربطه من «الموظفين» لتصلك تنبيهات محادثاتك.",
    ].join("\n"),
  );
}
