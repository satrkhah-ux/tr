import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto/secrets";
import { escapeHtml, siteUrl, type InlineButton } from "./ops-bot";

/**
 * «تنبيهاتي - ترافليون» (@traveliunbot) — every employee's own bot (the owner,
 * 2026-10-22). Each one gets the Teletel conversations assigned to them, their
 * numbers, and the client's messages, which they answer from here.
 *
 * A FOURTH bot, apart from operations and «عين الإدارة», because it speaks to
 * each employee about their own work only. Every lookup goes from the Telegram
 * account to ONE employee (employees.telegram_chat_id), then to that employee's
 * Teletel agent (employees.teletel_agent_id). Nothing is ever said about anyone
 * else.
 *
 * The token comes from bot_credentials (encrypted, replaced on «المطوّر»
 * without a deploy), with env TELEGRAM_STAFF_BOT_TOKEN as the fallback.
 */

export const STAFF_BOT = "staff";
export const STAFF_BOT_ENV = "TELEGRAM_STAFF_BOT_TOKEN";

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type TokenSource = "vault" | "env" | null;
type Resolved = { at: number; token: string | null; source: TokenSource; username: string | null };
let resolved: Resolved | null = null;

/** The token in use and where it came from. Re-read once a minute, so a replaced token takes effect without a restart. */
export async function staffBotToken(): Promise<Resolved> {
  if (resolved && Date.now() - resolved.at < 60_000) return resolved;
  let next: Resolved = { at: Date.now(), token: null, source: null, username: null };
  try {
    const { data } = await db().from("bot_credentials").select("token_enc, username").eq("bot", STAFF_BOT).maybeSingle();
    const row = data as { token_enc?: string; username?: string | null } | null;
    if (row?.token_enc) next = { ...next, token: decryptSecret(row.token_enc), source: "vault", username: row.username ?? null };
  } catch {
    /* no key or a tampered blob: the env fallback below still answers */
  }
  const env = process.env[STAFF_BOT_ENV];
  if (!next.token && env) next = { ...next, token: env, source: "env" };
  resolved = next;
  return next;
}

export function forgetStaffBotToken(): void {
  resolved = null;
}

/**
 * Telegram sends it back on every update (setWebhook secret_token). It is
 * derived from ADMIN_API_SECRET and stored nowhere, so it changes only when
 * that secret does.
 */
export function staffWebhookSecret(): string | null {
  const secret = process.env["ADMIN_API_SECRET"];
  return secret ? createHash("sha256").update(`staff-bot:${secret}`).digest("hex").slice(0, 40) : null;
}

export const staffWebhookUrl = (): string => `${siteUrl()}/api/telegram/staff`;

export type TgReply<T> = { ok: boolean; result?: T; description?: string; error_code?: number };

/** One Bot API call with a given token. It never throws, and a network failure comes back as ok:false. */
export async function tgCall<T>(token: string, method: string, body?: Record<string, unknown>, timeoutMs = 8000): Promise<TgReply<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return (await res.json()) as TgReply<T>;
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.name : "network" };
  }
}

/** The same call with the bot's current token. ok:false «not_configured» when there is none. */
export async function staffCall<T>(method: string, body?: Record<string, unknown>): Promise<TgReply<T>> {
  const { token } = await staffBotToken();
  return token ? tgCall<T>(token, method, body) : { ok: false, description: "not_configured" };
}

/** Points the bot at /api/telegram/staff with the derived secret. It runs again whenever the token changes. */
export async function registerStaffWebhook(token?: string): Promise<TgReply<boolean>> {
  const secret = staffWebhookSecret();
  const use = token ?? (await staffBotToken()).token;
  if (!use || !secret) return { ok: false, description: "not_configured" };
  const hook = await tgCall<boolean>(use, "setWebhook", {
    url: staffWebhookUrl(),
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  // the «/» menu in the chat, set with the webhook so a new token gets it too
  if (hook.ok) {
    await tgCall(use, "setMyCommands", {
      commands: [
        { command: "menu", description: "لوحتي" },
        { command: "numbers", description: "أرقامي" },
        { command: "waiting", description: "بانتظار ردي" },
      ],
    });
  }
  return hook;
}

export type Sent = { ok: true; messageId: number } | { ok: false; reason: "not_configured" | "not_started" | "failed"; description?: string };

/**
 * A message to one chat. «not_started» is Telegram refusing a chat that never
 * pressed «ابدأ»: a bot cannot speak first, and the screen tells the
 * administrator so.
 */
export async function staffSend(
  chatId: number,
  text: string,
  buttons?: InlineButton[][],
  extra: Record<string, unknown> = {},
): Promise<Sent> {
  const reply = await staffCall<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    ...extra,
  });
  if (reply.ok && reply.result) return { ok: true, messageId: reply.result.message_id };
  if (reply.description === "not_configured") return { ok: false, reason: "not_configured" };
  const refused = reply.error_code === 403 || /chat not found|bot can't initiate|blocked/i.test(reply.description ?? "");
  return { ok: false, reason: refused ? "not_started" : "failed", description: reply.description };
}

/** The bot's @username, for the «ابدأ» link: what was stored with the token, else getMe (and «traveliunbot» only if both fail). */
export async function staffBotUsername(): Promise<string> {
  const current = await staffBotToken();
  if (current.username) return current.username;
  const me = await staffCall<{ username?: string }>("getMe");
  const username = me.result?.username ?? "traveliunbot";
  if (resolved) resolved = { ...resolved, username };
  return username;
}

export type StaffMember = { id: string; name: string; chatId: number; agentId: number | null };

type MemberRow = { id: string; arabic_name: string; status: string | null; telegram_chat_id: number | string | null; teletel_agent_id: number | null };
const MEMBER_COLS = "id, arabic_name, status, telegram_chat_id, teletel_agent_id";

function member(row: MemberRow | null): StaffMember | null {
  if (!row || (row.status && row.status !== "Active")) return null;
  const chatId = Number(row.telegram_chat_id);
  return { id: row.id, name: row.arabic_name, chatId: Number.isFinite(chatId) ? chatId : 0, agentId: row.teletel_agent_id };
}

/** The ACTIVE employee this Telegram account is linked to, or null. A message from anyone else gets their own ID back and nothing more. */
export async function staffForChat(chatId: number): Promise<StaffMember | null> {
  try {
    const { data } = await db().from("employees").select(MEMBER_COLS).eq("telegram_chat_id", chatId).maybeSingle();
    return member(data as MemberRow | null);
  } catch {
    return null;
  }
}

/** The ACTIVE employee behind a Teletel agent, when their Telegram is linked too. Otherwise null, and nobody is told. */
export async function staffForAgent(agentId: number): Promise<StaffMember | null> {
  try {
    const { data } = await db().from("employees").select(MEMBER_COLS).eq("teletel_agent_id", agentId).maybeSingle();
    const found = member(data as MemberRow | null);
    return found && found.chatId ? found : null;
  } catch {
    return null;
  }
}

export { escapeHtml };
