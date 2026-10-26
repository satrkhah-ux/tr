import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/roles/roles";

/**
 * «مركز الإشعارات» — THE ONE DOOR (the owner, 2026-10-26). Every part of the
 * system that wants to tell an employee something in-app calls notifyEmployee;
 * nothing else writes employee_notifications. The bell in the top bar and the
 * counter on مُراد's floating button read what lands here; «تنبيهاتي»
 * (Telegram) stays its own parallel channel.
 *
 * FOR OTHER SESSIONS (operations, visas, mail, proposals):
 *   await notifyEmployee({
 *     employeeId: "<uuid>",            // OR permission: "operations.write" — every Active holder gets it
 *     kind: "ops",                     // a short slug; the bell filters by it
 *     title: "وصل جواز العميل فلان",   // ≤200 chars, what the employee reads
 *     body: "سطر إضافي اختياري",       // ≤1000
 *     href: "/operations/123",         // in-system path the click opens
 *     source: "operations",            // which part raised it
 *     dedupeKey: "ops:case123:passport" // SAME event never lands twice per employee — always set one for sweeps
 *   });
 * Returns {ok, created}. A duplicate dedupeKey is silently skipped. PRIVACY:
 * the caller puts NOTHING in title/body the employee may not see (no buy
 * prices, no other people's data) — this door does not re-check that.
 */

export type NotifyInput = {
  employeeId?: string;
  /** instead of employeeId: every Active employee holding this permission */
  permission?: Permission;
  kind: string;
  title: string;
  body?: string;
  href?: string;
  source?: string;
  dedupeKey?: string;
};

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

type EmployeeRow = {
  id: string;
  extra_permission_keys: string[] | null;
  removed_permission_keys: string[] | null;
  roles: { permission_keys: string[] } | { permission_keys: string[] }[] | null;
};

/** who holds a permission, the same way roles/current reads it for one person */
export function holdsPermission(e: EmployeeRow, permission: string): boolean {
  const role = Array.isArray(e.roles) ? e.roles[0] : e.roles;
  const keys = new Set([...(role?.permission_keys ?? []), ...(e.extra_permission_keys ?? [])]);
  for (const k of e.removed_permission_keys ?? []) keys.delete(k);
  return keys.has(permission);
}

export async function notifyEmployee(input: NotifyInput): Promise<{ ok: boolean; created: number }> {
  const title = clip(input.title, 200);
  const kind = clip(input.kind, 40);
  if (!title || !kind) return { ok: false, created: 0 };
  const service = db();

  let targets: string[] = [];
  if (input.employeeId && /^[0-9a-f-]{36}$/i.test(input.employeeId)) targets = [input.employeeId];
  else if (input.permission) {
    const { data } = await service
      .from("employees")
      .select("id, extra_permission_keys, removed_permission_keys, roles(permission_keys)")
      .eq("status", "Active");
    targets = ((data ?? []) as unknown as EmployeeRow[]).filter((e) => holdsPermission(e, input.permission!)).map((e) => e.id);
  }
  if (!targets.length) return { ok: false, created: 0 };

  let created = 0;
  for (const employee_id of targets) {
    const { error } = await service.from("employee_notifications").insert({
      employee_id,
      kind,
      title,
      body: clip(input.body, 1000),
      href: clip(input.href, 300) || null,
      source: clip(input.source, 40),
      dedupe_key: clip(input.dedupeKey, 200) || null,
    });
    // 23505 = the dedupe key already landed: the point of it, never an error. A missing table (42P01) is silent too: the feature is simply not enabled yet.
    if (!error) created += 1;
    else if ((error as { code?: string }).code !== "23505" && (error as { code?: string }).code !== "42P01") return { ok: false, created };
  }
  return { ok: true, created };
}
