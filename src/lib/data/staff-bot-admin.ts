"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "@/lib/data/audit";
import { encryptSecret, isVaultConfigured } from "@/lib/crypto/secrets";
import { listTeletelAgents, type TeletelAgent } from "@/lib/providers/teletel";
import {
  forgetStaffBotToken,
  registerStaffWebhook,
  STAFF_BOT,
  staffBotToken,
  staffBotUsername,
  staffSend,
  staffWebhookUrl,
  tgCall,
  type TokenSource,
} from "@/lib/telegram/staff-bot";

/**
 * «تنبيهاتي» (@traveliunbot) from inside the system. On «المطوّر» the developer
 * replaces the token, checks the bot and registers its webhook again
 * (developer.access). On «الموظفين» the administration sends a colleague a test
 * message and reads the Teletel agents to pick from (employees.manage).
 *
 * A token never leaves the server. It arrives here once, is checked with
 * Telegram, then encrypted, and the screen only ever sees the bot's @username
 * and where the token lives.
 */

type Fail = { ok: false; error: string };
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type StaffBotPanelData = {
  source: TokenSource;
  username: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  vaultReady: boolean;
  webhookUrl: string;
};

export async function staffBotPanel(): Promise<StaffBotPanelData | null> {
  if (!(await currentCan("developer.access"))) return null;
  const { data } = await db().from("bot_credentials").select("username, updated_at, updated_by").eq("bot", STAFF_BOT).maybeSingle();
  const row = data as { username: string | null; updated_at: string; updated_by: string | null } | null;
  const current = await staffBotToken();
  return {
    source: current.source,
    username: row?.username ?? null,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
    vaultReady: isVaultConfigured(),
    webhookUrl: staffWebhookUrl(),
  };
}

export type StaffBotCheck =
  | { ok: true; username: string; webhook: { set: boolean; ours: boolean; pending: number; lastError: string | null } }
  | Fail;

type Hook = { url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string };

/** «فحص»: getMe names the bot, and getWebhookInfo says whether its updates reach us. */
export async function checkStaffBot(): Promise<StaffBotCheck> {
  if (!(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  const { token } = await staffBotToken();
  if (!token) return { ok: false, error: "dev.sb.noToken" };
  const me = await tgCall<{ username?: string }>(token, "getMe");
  if (!me.ok) return { ok: false, error: "dev.sb.rejected" };
  const hook = (await tgCall<Hook>(token, "getWebhookInfo")).result ?? {};
  // Telegram keeps the last error forever, so only one from the last day counts
  const recent = hook.last_error_date && Date.now() / 1000 - hook.last_error_date < 24 * 3600;
  return {
    ok: true,
    username: me.result?.username ?? "—",
    webhook: {
      set: Boolean(hook.url),
      ours: hook.url === staffWebhookUrl(),
      pending: hook.pending_update_count ?? 0,
      lastError: recent ? (hook.last_error_message ?? "").replaceAll(token, "***") : null,
    },
  };
}

/** «تسجيل الربط»: point the bot at this server again (after a domain move, or whatever ate the webhook). */
export async function registerStaffBotWebhook(): Promise<{ ok: true } | Fail> {
  if (!(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  const res = await registerStaffWebhook();
  if (!res.ok) return { ok: false, error: res.description === "not_configured" ? "dev.sb.noToken" : "dev.sb.webhookFailed" };
  await logAudit({ action: "bot.webhook_registered", entity: "bot_credentials", entity_id: STAFF_BOT, meta: { url: staffWebhookUrl() } });
  return { ok: true };
}

/**
 * A new token from BotFather. It is checked with Telegram before anything is
 * stored, then encrypted and saved, and the webhook is moved to it. When it
 * belongs to a DIFFERENT bot, the old bot's webhook is removed, so the two
 * never both post here. Audited by @username, never by the value.
 */
export async function saveStaffBotToken(input: string): Promise<{ ok: true; username: string } | Fail> {
  if (!(await currentCan("developer.access"))) return { ok: false, error: "err.forbidden" };
  const token = input.trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) return { ok: false, error: "dev.sb.badFormat" };
  if (!isVaultConfigured()) return { ok: false, error: "dev.sb.noVault" };
  const me = await tgCall<{ id?: number; username?: string }>(token, "getMe");
  if (!me.ok || !me.result?.username) return { ok: false, error: "dev.sb.rejected" };

  const before = await staffBotToken();
  const user = await getServerUser();
  const { error } = await db()
    .from("bot_credentials")
    .upsert({ bot: STAFF_BOT, token_enc: encryptSecret(token), username: me.result.username, updated_at: new Date().toISOString(), updated_by: user?.email ?? null });
  if (error) return { ok: false, error: "err.db" };
  forgetStaffBotToken();

  if (before.token && before.token.split(":")[0] !== token.split(":")[0]) {
    await tgCall(before.token, "deleteWebhook");
  }
  const hook = await registerStaffWebhook(token);
  await logAudit({
    action: "bot.token_changed",
    entity: "bot_credentials",
    entity_id: STAFF_BOT,
    meta: { username: me.result.username, previous: before.username ?? before.source, webhook: hook.ok },
  });
  return hook.ok ? { ok: true, username: me.result.username } : { ok: false, error: "dev.sb.savedNoWebhook" };
}

export type TestResult = { ok: true } | { ok: false; error: "err.forbidden" | "team.tg.notLinked" | "team.tg.notStarted" | "team.tg.noBot" | "team.tg.failed" };

/** «رسالة تجربة» to one colleague's linked Telegram. It fails with «لم يضغط ابدأ» until they open the bot once. */
export async function sendMemberTestMessage(employeeId: string): Promise<TestResult> {
  if (!(await currentCan("employees.manage"))) return { ok: false, error: "err.forbidden" };
  const { data } = await db().from("employees").select("arabic_name, telegram_chat_id").eq("id", employeeId).maybeSingle();
  const row = data as { arabic_name: string; telegram_chat_id: number | string | null } | null;
  if (!row?.telegram_chat_id) return { ok: false, error: "team.tg.notLinked" };
  const sent = await staffSend(
    Number(row.telegram_chat_id),
    `🔔 رسالة تجربة من نظام ترافليون\n\nأهلاً ${row.arabic_name} — حسابك مربوط ✅\nستصلك هنا تنبيهات محادثاتك في تيلي تيل.`,
  );
  await logAudit({ action: "employee.telegram_test", entity: "employees", entity_id: employeeId, meta: { ok: sent.ok, reason: sent.ok ? null : sent.reason } });
  if (sent.ok) return { ok: true };
  return { ok: false, error: sent.reason === "not_started" ? "team.tg.notStarted" : sent.reason === "not_configured" ? "team.tg.noBot" : "team.tg.failed" };
}

/** Teletel's agents, for the picker on «الموظفين». */
export async function teletelAgentsForTeam(): Promise<TeletelAgent[]> {
  if (!(await currentCan("employees.manage"))) return [];
  return listTeletelAgents();
}

/** The bot's @username, for the «ابدأ» link a colleague is sent. */
export async function staffBotLink(): Promise<string | null> {
  if (!(await getServerUser())) return null;
  return `https://t.me/${await staffBotUsername()}`;
}
