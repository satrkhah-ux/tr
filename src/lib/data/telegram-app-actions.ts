"use server";

import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Employee } from "@/lib/types";
import { AUTH_COOKIE_MAX_AGE, AUTH_STORAGE_KEY, getSupabaseEnv } from "@/lib/supabase/constants";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { verifyTelegramInitData } from "@/lib/telegram-app/verify";

/**
 * Telegram Mini App auth bridge.
 *
 * `telegramSignIn` — the webview posts Telegram's signed initData; we verify it
 * with the bot token (HMAC), resolve the employee by telegram_chat_id, mint a
 * real Supabase session for that employee (admin magiclink → verifyOtp) and set
 * the SAME auth cookie the normal login writes — so the employee lands in the
 * app with their true role/permissions. No passwords typed inside Telegram.
 *
 * `linkTelegramAccount` — one-time: an ALREADY signed-in employee opens the
 * Mini App; the verified Telegram id is saved on their employee row.
 */

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export type TelegramSignInResult =
  | { ok: true }
  | { ok: false; code: "unconfigured" | "invalid" | "not_linked" | "no_auth_account" | "failed" };

export async function telegramSignIn(initData: string): Promise<TelegramSignInResult> {
  try {
    const botToken = readEnv("TELEGRAM_WEBAPP_BOT_TOKEN");
    if (!botToken) return { ok: false, code: "unconfigured" };

    const verified = verifyTelegramInitData(initData, botToken);
    if (!verified) return { ok: false, code: "invalid" };

    const service = createSupabaseServiceClient();
    const { data: employee } = await service
      .from("employees")
      .select("id, email, status")
      .eq("telegram_chat_id", verified.user.id)
      .maybeSingle<Pick<Employee, "id" | "email" | "status">>();
    if (!employee?.email) return { ok: false, code: "not_linked" };

    // Mint a session without a password: admin-issued magiclink token, verified
    // immediately server-side. Fails cleanly when the employee has no auth user.
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: "magiclink",
      email: employee.email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) return { ok: false, code: "no_auth_account" };

    const { url, anonKey } = getSupabaseEnv();
    const anon = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: otpData, error: otpError } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (otpError || !otpData.session) return { ok: false, code: "failed" };

    // Same cookie shape the browser client persists (client.ts cookieStorage):
    // the whole session JSON, URI-encoded — server AND browser clients read it.
    const cookieStore = await cookies();
    cookieStore.set(AUTH_STORAGE_KEY, encodeURIComponent(JSON.stringify(otpData.session)), {
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: readEnv("NODE_ENV") === "production",
    });
    return { ok: true };
  } catch {
    return { ok: false, code: "failed" };
  }
}

export type TelegramLinkResult =
  | { ok: true }
  | { ok: false; code: "unconfigured" | "invalid" | "session" | "no_employee" | "taken" | "failed" };

export async function linkTelegramAccount(initData: string): Promise<TelegramLinkResult> {
  try {
    const botToken = readEnv("TELEGRAM_WEBAPP_BOT_TOKEN");
    if (!botToken) return { ok: false, code: "unconfigured" };

    const verified = verifyTelegramInitData(initData, botToken);
    if (!verified) return { ok: false, code: "invalid" };

    const user = await getServerUser();
    if (!user) return { ok: false, code: "session" };

    // dynamic update → loosen the generics (project-wide convention in data/).
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;

    // one Telegram ↔ one employee: refuse if another employee holds this id.
    const { data: holder } = await service
      .from("employees")
      .select("id, auth_user_id")
      .eq("telegram_chat_id", verified.user.id)
      .maybeSingle<Pick<Employee, "id" | "auth_user_id">>();
    if (holder && holder.auth_user_id !== user.id) return { ok: false, code: "taken" };

    const { data: updated, error } = await service
      .from("employees")
      .update({ telegram_chat_id: verified.user.id })
      .eq("auth_user_id", user.id)
      .select("id");
    if (error) return { ok: false, code: "failed" };
    if (!updated || updated.length === 0) return { ok: false, code: "no_employee" };
    return { ok: true };
  } catch {
    return { ok: false, code: "failed" };
  }
}
