import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Tell the operations team a case has landed.
 *
 * The moment a salesperson records «تم تأكيد العميل», somebody else has to start
 * booking. Without a push, that handover is a shout across the office or a
 * WhatsApp message that gets lost, and the case sits until someone happens to
 * open the board.
 *
 * Sent over the Traveliun bot to the employees who have already linked their
 * Telegram (employees.telegram_chat_id, migration 0019). Best-effort by design:
 * a notification that fails must never roll back the confirmation itself — the
 * operation exists either way and the board still shows it.
 */

function readEnv(name: string): string | undefined {
  // bracket access on purpose: these resolve at RUNTIME on the VPS, not at build
  return process.env[name];
}

async function send(chatId: number, text: string): Promise<boolean> {
  const token = readEnv("TELEGRAM_WEBAPP_BOT_TOKEN");
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Employees who should hear about operations work.
 *
 * "Has the operations permission" is a role question, and roles live in a table
 * whose only marker for full access is english_name = 'All Permissions'. Rather
 * than re-implement that lookup, this takes everyone with a linked Telegram —
 * the linking itself is the opt-in, and an employee without ops work simply has
 * no reason to have linked. Narrow it to a role when someone complains.
 */
async function opsRecipients(supabase: SupabaseClient): Promise<number[]> {
  const { data } = await supabase
    .from("employees")
    .select("telegram_chat_id")
    .not("telegram_chat_id", "is", null);
  return ((data ?? []) as { telegram_chat_id: number | string }[])
    .map((e) => Number(e.telegram_chat_id))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

export type OpsNotice = {
  serial: string;
  customer: string | null;
  destination: string | null;
  travelStart: string | null;
  operationId: string;
  confirmedBy: string | null;
};

/** Returns how many recipients actually received it. */
export async function notifyOperationConfirmed(notice: OpsNotice): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const chatIds = await opsRecipients(supabase);
    if (chatIds.length === 0) return 0;

    const base = readEnv("NEXT_PUBLIC_SITE_URL") ?? "https://pkg.traveliun.com";
    const lines = [
      "🟢 <b>عملية جديدة — العميل أكّد</b>",
      "",
      `العميل: <b>${escapeHtml(notice.customer ?? "—")}</b>`,
      `العرض: <code>${escapeHtml(notice.serial)}</code>`,
      notice.destination ? `الوجهة: ${escapeHtml(notice.destination)}` : null,
      notice.travelStart ? `السفر: <code>${escapeHtml(notice.travelStart)}</code>` : null,
      notice.confirmedBy ? `سجّله: ${escapeHtml(notice.confirmedBy)}` : null,
      "",
      "ابدأ الحجوزات وإصدار الفواتشر:",
      `${base}/operations/${notice.operationId}`,
    ].filter((l): l is string => l !== null);

    const text = lines.join("\n");
    const results = await Promise.all(chatIds.map((id) => send(id, text)));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
