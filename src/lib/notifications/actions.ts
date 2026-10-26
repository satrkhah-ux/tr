"use server";

import { currentSecretaryEmployee, secretaryDb } from "@/lib/secretary/core";
import { isWorkingTime, parseHours } from "@/lib/murad/reception";
import { SETTING } from "@/lib/murad/core";
import type { NotificationRow } from "./core";

/**
 * The bell's own reads and writes — always the SIGNED-IN employee's rows
 * («مشاهدة الإدارة» reads boards, never these, so it can never mark another's
 * notifications read). The sound follows murad_reception_hours.
 */

const TABLE_MISSING = "42P01";

export type MyNotifications = {
  rows: NotificationRow[];
  unread: number;
  /** inside the office hours right now — outside them the page stays silent */
  withinHours: boolean;
  /** the table is not enabled yet: the bell hides itself */
  enabled: boolean;
};

export async function getMyNotifications(): Promise<MyNotifications | null> {
  const employee = await currentSecretaryEmployee();
  if (!employee) return null;
  const db = secretaryDb();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data, error }, { data: hoursRow }] = await Promise.all([
    db.from("employee_notifications").select("id, kind, title, body, href, source, created_at, read_at").eq("employee_id", employee.id).gte("created_at", since).order("created_at", { ascending: false }).limit(200),
    db.from("app_settings").select("value").eq("key", SETTING.receptionHours).maybeSingle(),
  ]);
  if (error) return { rows: [], unread: 0, withinHours: false, enabled: (error as { code?: string }).code !== TABLE_MISSING };
  const rows = (data ?? []) as NotificationRow[];
  return {
    rows,
    unread: rows.filter((r) => !r.read_at).length,
    withinHours: isWorkingTime(new Date(), parseHours((hoursRow as { value?: string } | null)?.value)),
    enabled: true,
  };
}

export async function markNotificationsRead(ids: string[] | "all"): Promise<{ ok: boolean }> {
  const employee = await currentSecretaryEmployee();
  if (!employee) return { ok: false };
  const db = secretaryDb();
  let query = db.from("employee_notifications").update({ read_at: new Date().toISOString() }).eq("employee_id", employee.id).is("read_at", null);
  if (ids !== "all") {
    const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
    if (!clean.length) return { ok: false };
    query = query.in("id", clean);
  }
  const { error } = await query;
  return { ok: !error };
}
