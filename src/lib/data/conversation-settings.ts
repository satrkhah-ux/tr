"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "@/lib/data/audit";
import { getTeletelConfig, listOpenConversations, listTeletelTeams } from "@/lib/providers/teletel";
import { LATENESS_EXEMPT_KEY, parseLatenessExempt, type LatenessExempt } from "@/lib/leads/lateness";
import { AUTOCLOSE_SETTING, readAutocloseHours, staleToClose, TRAVELLERS_SETTING } from "@/lib/leads/lifecycle-rules";

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
  reopen_action: "returned_to_employee" | "returned_to_file_owner" | "unassigned" | "kept" | null;
  travel_until: string | null;
};

export type ExemptChoices = { employees: { id: string; name: string }[]; roles: { id: string; name: string }[]; teams: { id: number; name: string }[] };
export type ConversationsAdmin = { hours: number | null; travellers: boolean; closures: ClosureRow[]; teletelBase: string | null; exempt: LatenessExempt; choices: ExemptChoices };

export async function getConversationsAdmin(): Promise<ConversationsAdmin | null> {
  if (!(await allowed())) return null;
  const [{ data: settings }, { data: closures }, { data: emps }, { data: roles }, teams] = await Promise.all([
    db().from("app_settings").select("key, value").in("key", [AUTOCLOSE_SETTING, TRAVELLERS_SETTING, LATENESS_EXEMPT_KEY]),
    db().from("conversation_closures").select("conversation_id, closed_at, closed_by_kind, closed_by_name, reason, reopened_at, reopen_action, travel_until").order("closed_at", { ascending: false }).limit(40),
    db().from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name"),
    db().from("roles").select("id, arabic_name").order("sort"),
    listTeletelTeams(),
  ]);
  const v = new Map(((settings ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const config = getTeletelConfig();
  return {
    hours: readAutocloseHours(v.get(AUTOCLOSE_SETTING)),
    travellers: v.get(TRAVELLERS_SETTING) !== "off",
    closures: (closures ?? []) as ClosureRow[],
    teletelBase: config ? `${config.baseUrl}/app/accounts/${config.accountId}/conversations` : null,
    exempt: parseLatenessExempt(v.get(LATENESS_EXEMPT_KEY)),
    choices: {
      employees: ((emps ?? []) as { id: string; arabic_name: string | null }[]).map((e) => ({ id: e.id, name: e.arabic_name ?? "—" })),
      roles: ((roles ?? []) as { id: string; arabic_name: string | null }[]).map((r) => ({ id: r.id, name: r.arabic_name ?? "—" })),
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
    },
  };
}

/** «لا يُحسب عليهم تأخير» (the owner, 2026-10-29): staff, departments and Teletel teams — the whole list replaced, audited. */
export async function saveLatenessExempt(next: LatenessExempt): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const value = parseLatenessExempt(JSON.stringify(next));
  const { data: before } = await db().from("app_settings").select("value").eq("key", LATENESS_EXEMPT_KEY).maybeSingle();
  const { error } = await db().from("app_settings").upsert({ key: LATENESS_EXEMPT_KEY, value: JSON.stringify(value), updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: LATENESS_EXEMPT_KEY, meta: { before: (before as { value: string } | null)?.value ?? null, after: value } });
  return { ok: true };
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

/** «مؤكد — مسافر قريباً»: on unless stopped here (the user approved it, 2026-10-22). */
export async function saveTravellersClose(on: boolean): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const { error } = on
    ? await db().from("app_settings").delete().eq("key", TRAVELLERS_SETTING)
    : await db().from("app_settings").upsert({ key: TRAVELLERS_SETTING, value: "off", updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: TRAVELLERS_SETTING, meta: { after: on ? "on" : "off" } });
  return { ok: true };
}
