"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "@/lib/data/audit";
import { getTeletelConfig, listOpenConversations } from "@/lib/providers/teletel";
import { AUTOCLOSE_SETTING, readAutocloseHours, staleToClose } from "@/lib/leads/lifecycle-rules";

/**
 * «الإدارة ← إدارة المحادثات» (the user, 2026-10-22: «اضف هذه الخيارات في
 * اعدادات الادارة… اغلاق للمحادثة اجباري بعد وقت معين من عدم الرد»),
 * settings.manage: how long without a reply before the system closes a Teletel
 * conversation (off when empty), what that would close now, and the last
 * closings with who closed them and where each went when the client came back.
 */
type Result = { ok: true } | { ok: false; error: string };
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const allowed = () => currentCan("settings.manage");

export type ClosureRow = {
  conversation_id: number;
  closed_at: string;
  closed_by_kind: "employee" | "system" | "murad";
  closed_by_name: string | null;
  reason: string | null;
  reopened_at: string | null;
  reopen_action: "returned_to_employee" | "unassigned" | "kept" | null;
};

export type ConversationsAdmin = { hours: number | null; closures: ClosureRow[]; teletelBase: string | null };

export async function getConversationsAdmin(): Promise<ConversationsAdmin | null> {
  if (!(await allowed())) return null;
  const [{ data: setting }, { data: closures }] = await Promise.all([
    db().from("app_settings").select("value").eq("key", AUTOCLOSE_SETTING).maybeSingle(),
    db().from("conversation_closures").select("conversation_id, closed_at, closed_by_kind, closed_by_name, reason, reopened_at, reopen_action").order("closed_at", { ascending: false }).limit(40),
  ]);
  const config = getTeletelConfig();
  return {
    hours: readAutocloseHours((setting as { value: string } | null)?.value),
    closures: (closures ?? []) as ClosureRow[],
    teletelBase: config ? `${config.baseUrl}/app/accounts/${config.accountId}/conversations` : null,
  };
}

/** What a duration would close right now, and the clients waiting on us that it never touches. */
export async function previewAutoclose(hours: number): Promise<{ ok: true; close: number; waiting: number; open: number } | { ok: false; error: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const h = readAutocloseHours(String(hours));
  if (!h) return { ok: false, error: "مدة بين ساعة و90 يوماً" };
  const list = await listOpenConversations(true);
  if (!list) return { ok: false, error: "تعذّر الوصول إلى Teletel" };
  return { ok: true, close: staleToClose(list.rows, Math.floor(Date.now() / 1000), h).length, waiting: list.rows.filter((c) => c.waitingSince > 0).length, open: list.rows.length };
}

/** null switches the system's closing off. */
export async function saveAutoclose(hours: number | null): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const h = hours === null ? null : readAutocloseHours(String(hours));
  if (hours !== null && !h) return { ok: false, error: "مدة بين ساعة و90 يوماً" };
  const { data: before } = await db().from("app_settings").select("value").eq("key", AUTOCLOSE_SETTING).maybeSingle();
  const { error } = h
    ? await db().from("app_settings").upsert({ key: AUTOCLOSE_SETTING, value: String(h), updated_at: new Date().toISOString() })
    : await db().from("app_settings").delete().eq("key", AUTOCLOSE_SETTING);
  if (error) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: AUTOCLOSE_SETTING, meta: { before: (before as { value: string } | null)?.value ?? null, after: h } });
  return { ok: true };
}
