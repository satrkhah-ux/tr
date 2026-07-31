import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isPermission } from "@/lib/roles/roles";
import { answerCallback, escapeHtml, sendMessage, sendVoice } from "./ops-bot";

/**
 * «عين الإدارة» — the watcher's own bot.
 *
 * A THIRD bot, and the separation is the point: this one carries a report that
 * measures how long each colleague took to answer a client. The operations team
 * must not receive it, and giving management its own bot is the simplest way to
 * make that structural rather than a matter of who remembers not to forward.
 *
 * Env, read at RUNTIME:
 *   TELEGRAM_EYE_BOT_TOKEN        from BotFather — the bot is silent without it
 *   TELEGRAM_EYE_WEBHOOK_SECRET   optional shared secret on the webhook
 */

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function eyeBotToken(): string | undefined {
  return env("TELEGRAM_EYE_BOT_TOKEN");
}

export const eyeSend = (chatId: number, text: string, buttons?: Parameters<typeof sendMessage>[2]) =>
  sendMessage(chatId, text, buttons, eyeBotToken());

export const eyeVoice = (chatId: number, audio: Buffer, caption?: string) =>
  sendVoice(chatId, audio, caption, eyeBotToken());

export const eyeAnswer = (callbackId: string, text?: string) => answerCallback(callbackId, text, eyeBotToken());

export { escapeHtml };

export type EyeListener = { id: string; name: string; chatId: number };

/**
 * Who may hear the report.
 *
 * `dashboard.admin` and a linked Telegram account — both, always. This is the
 * one place in the system where a permission decides who hears about OTHER
 * people's day, so it resolves the section's real permission keys rather than
 * trusting a role name.
 */
export async function eyeListeners(): Promise<EyeListener[]> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase
      .from("employees")
      .select("id, arabic_name, status, telegram_chat_id, roles(permission_keys)")
      .not("telegram_chat_id", "is", null);

    const rows = (data ?? []) as unknown as {
      id: string;
      arabic_name: string;
      status: string | null;
      telegram_chat_id: number | string;
      roles: { permission_keys: string[] } | { permission_keys: string[] }[] | null;
    }[];

    return rows
      .filter((r) => (r.status ?? "Active") === "Active")
      .filter((r) => {
        const role = Array.isArray(r.roles) ? r.roles[0] : r.roles;
        return (role?.permission_keys ?? []).filter(isPermission).includes("dashboard.admin");
      })
      .map((r) => ({ id: r.id, name: r.arabic_name, chatId: Number(r.telegram_chat_id) }))
      .filter((r) => Number.isFinite(r.chatId) && r.chatId !== 0);
  } catch {
    return [];
  }
}
