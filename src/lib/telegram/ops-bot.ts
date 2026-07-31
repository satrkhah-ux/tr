import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isPermission, type Permission } from "@/lib/roles/roles";

/**
 * «قسم العمليات» — the operations bot.
 *
 * A SEPARATE bot from the admin one on purpose: it is the ops team's tool, its
 * menu button opens the operations screen rather than the dashboard, and giving
 * it its own token means the office can hand it to whoever runs bookings without
 * handing over the administrative bot too.
 *
 * What it deliberately does NOT do:
 *   - print passport data. Those numbers are encrypted at rest and every read is
 *     logged with a name; pasting them into a third-party chat would undo both.
 *     The bot links to the screen instead.
 *   - act on a message from a Telegram account it cannot resolve to an employee
 *     with the operations permission. A chat command is not an authorisation.
 *
 * Env, read at RUNTIME (VPS, not build):
 *   TELEGRAM_OPS_BOT_TOKEN   the new bot's token from BotFather — required
 *   TELEGRAM_OPS_WEBHOOK_SECRET  optional shared secret on the webhook
 *   NEXT_PUBLIC_SITE_URL     defaults to https://pkg.traveliun.com
 */

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function opsBotToken(): string | undefined {
  return env("TELEGRAM_OPS_BOT_TOKEN");
}

/** The ops bot when configured, else the admin bot, else nothing. */
export function sendingToken(): string | undefined {
  return opsBotToken() ?? env("TELEGRAM_WEBAPP_BOT_TOKEN");
}

export function siteUrl(): string {
  return (env("NEXT_PUBLIC_SITE_URL") ?? "https://pkg.traveliun.com").replace(/\/$/, "");
}

/**
 * A Mini App link that lands on a screen INSIDE the app.
 *
 * `/tg` verifies Telegram's signed initData, signs the employee in and forwards.
 * The path is carried as a parameter rather than a separate entry point so every
 * button — a case, the board, a booking — reuses the one verified bridge.
 */
export function miniAppUrl(path = "/operations"): string {
  return `${siteUrl()}/tg?to=${encodeURIComponent(path)}`;
}

export type InlineButton = { text: string; url?: string; web_app?: { url: string }; callback_data?: string };

export async function sendMessage(
  chatId: number,
  text: string,
  buttons?: InlineButton[][],
  /** which bot speaks. Defaults to operations; «عين الإدارة» passes its own. */
  botToken?: string,
): Promise<boolean> {
  const token = botToken ?? sendingToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * A voice note. Telegram wants OGG/opus for `sendVoice` — anything else arrives
 * as a file attachment you have to download, which is not the same thing at all.
 */
export async function sendVoice(chatId: number, audio: Buffer, caption?: string, botToken?: string): Promise<boolean> {
  const token = botToken ?? sendingToken();
  if (!token) return false;
  try {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("voice", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), "report.ogg");
    if (caption) {
      form.set("caption", caption.slice(0, 1000));
      form.set("parse_mode", "HTML");
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function answerCallback(callbackId: string, text?: string, botToken?: string): Promise<void> {
  const token = botToken ?? sendingToken();
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text: text ?? "" }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* best effort */
  }
}

export type BotEmployee = {
  id: string;
  name: string;
  permissions: Permission[];
};

/**
 * Who is this Telegram account, and what may they do?
 *
 * The chat id was linked from inside the Mini App, where Telegram's signed
 * initData proved the account — so this lookup inherits that proof. The
 * permissions come from the employee's section, exactly as on the web: the bot
 * is another door onto the same rules, never a second set of them.
 */
export async function employeeForChat(chatId: number): Promise<BotEmployee | null> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase
      .from("employees")
      .select("id, arabic_name, status, roles(permission_keys)")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();

    const row = data as unknown as
      | { id: string; arabic_name: string; status: string | null; roles: { permission_keys: string[] } | { permission_keys: string[] }[] | null }
      | null;
    if (!row) return null;
    if (row.status && row.status !== "Active") return null;

    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    return {
      id: row.id,
      name: row.arabic_name,
      permissions: (role?.permission_keys ?? []).filter(isPermission),
    };
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
