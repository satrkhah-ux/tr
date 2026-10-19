"use server";
import { ttlCache } from "@/lib/ttl-cache";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles/roles";
import { currentCan, currentRole } from "@/lib/roles/current";
import { AUTO_FOLLOWUP_MAX_MINUTES } from "@/lib/sla/classify";
import { requestCounts, ticketsFromLeads, LEAD_TICKET_COLS, type LeadForTicket } from "@/lib/eye/anomalies";
import { allRows } from "./all-rows";

/**
 * Dashboard metric queries — the ONLY place that reads metric data. Backend
 * swap = change this file's internals; the dashboard UI is untouched. Loose
 * client (offers span joins/aggregations Supabase generics collapse).
 */
async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const ONLINE_WINDOW_MINUTES = 2;

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The signed-in user's employee row id, or null when they have none.
 * Used to stamp «الموظف المختص» on an offer at creation time.
 */
export async function getCurrentEmployeeId(): Promise<string | null> {
  try {
    const user = await getServerUser();
    if (!user) return null;
    return await employeeIdOf(user.id);
  } catch {
    return null;
  }
}

/**
 * asked many times per request (stamps, «ملفاتي», audit rows) — read once per
 * user per request, and kept 5 min across requests: an account's employee row
 * does not change, and each read is a round trip to the database in Mumbai
 */
const employeeIds = ttlCache<string, string>(5 * 60_000);
const employeeIdOf = cache(async (userId: string): Promise<string | null> => {
  const known = employeeIds.get(userId);
  if (known) return known;
  const id = await employeeIdForUser(await db(), userId);
  if (id) employeeIds.set(userId, id);
  return id;
});

async function employeeIdForUser(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * The signed-in user's role label.
 *
 * Delegates to the permission resolver so there is ONE truth: the role a person
 * holds is whatever their role row grants. This used to compare
 * `english_name === 'All Permissions'`, which made an administrator out of anyone
 * who could rename a row — and until migration 0030 any signed-in user could.
 */
export async function getCurrentRole(): Promise<Role> {
  return currentRole();
}

/** Heartbeat — keeps the signed-in employee's presence row fresh (online-now). */
export async function touchPresence(): Promise<void> {
  try {
    const user = await getServerUser();
    if (!user) return;
    const supabase = await db();
    const empId = await employeeIdForUser(supabase, user.id);
    if (!empId) return;
    const now = new Date().toISOString();
    await supabase
      .from("presence")
      .upsert({ employee_id: empId, user_id: user.id, last_seen_at: now }, { onConflict: "employee_id" });

    // The same beat, kept as a DAY. `presence` is overwritten on every heartbeat,
    // so it can say who is online right now but never when they arrived — and
    // «عين الإدارة» is asked exactly that. touch_attendance() (0073) inserts the
    // arrival once and afterwards only moves last_seen_at and the beat count; the
    // old upsert here rewrote first_seen_at on every beat, and the table's own
    // write policies let anyone set their arrival. It takes no argument: the
    // person and the Riyadh day are the database's to decide.
    await supabase.rpc("touch_attendance");
  } catch {
    /* presence is best-effort; never blocks the page */
  }
}

// ---------- admin view ----------
export type AdminMetrics = {
  ok: boolean;
  onlineNow: number;
  activeToday: number;
  employeesWithRequestsNow: number;
  requestsAnswered: number;
  employeesNotResponded: number;
  notRespondedNames: string[];
};

export async function getAdminMetrics(employeeFilterId?: string): Promise<AdminMetrics> {
  const empty: AdminMetrics = {
    ok: false, onlineNow: 0, activeToday: 0, employeesWithRequestsNow: 0,
    requestsAnswered: 0, employeesNotResponded: 0, notRespondedNames: [],
  };
  try {
    // the team's activity is the admin dashboard's, not every caller's
    if (!(await currentCan("dashboard.admin"))) return empty;
    const supabase = await db();
    const onlineCut = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60_000).toISOString();
    const today = startOfTodayIso();

    let presenceQuery = supabase.from("presence").select("employee_id, last_seen_at");
    if (employeeFilterId) presenceQuery = presenceQuery.eq("employee_id", employeeFilterId);
    const presence = ((await presenceQuery).data ?? []) as { employee_id: string; last_seen_at: string }[];
    const onlineNow = presence.filter((p) => p.last_seen_at >= onlineCut).length;
    const activeToday = presence.filter((p) => p.last_seen_at >= today).length;

    // «خدمة العملاء» went with the menu consolidation (the owner, 2026-10-19) and care_tickets
    // is empty: the requests are the client conversations of «العملاء», measured as
    // «عين الإدارة» measures them — the last week, our first reply (eye/anomalies.ts)
    const since = new Date(Date.now() - AUTO_FOLLOWUP_MAX_MINUTES * 60_000).toISOString();
    const { data: leads } = await allRows((a, b) => supabase.from("client_leads").select(LEAD_TICKET_COLS).gte("created_at", since).order("id").range(a, b));
    const tickets = ticketsFromLeads(leads as LeadForTicket[], new Map()).filter((t) => !employeeFilterId || t.employee_id === employeeFilterId);
    const { answered, assigned, pending } = requestCounts(tickets);

    let notRespondedNames: string[] = [];
    if (pending.size > 0) {
      const { data: emps } = await supabase.from("employees").select("id, arabic_name").in("id", [...pending]);
      notRespondedNames = ((emps ?? []) as { id: string; arabic_name: string }[]).map((e) => e.arabic_name);
    }

    return {
      ok: true,
      onlineNow,
      activeToday,
      employeesWithRequestsNow: assigned.size,
      requestsAnswered: answered,
      employeesNotResponded: pending.size,
      notRespondedNames,
    };
  } catch {
    return empty;
  }
}

export type EmployeeOption = { id: string; name: string };

export async function searchEmployees(query: string): Promise<EmployeeOption[]> {
  try {
    if (!(await currentCan("dashboard.admin"))) return [];
    const supabase = await db();
    let q = supabase.from("employees").select("id, arabic_name").order("arabic_name").limit(25);
    const trimmed = query.trim();
    if (trimmed) q = q.ilike("arabic_name", `%${trimmed}%`);
    const { data } = await q;
    return ((data ?? []) as { id: string; arabic_name: string }[]).map((e) => ({ id: e.id, name: e.arabic_name }));
  } catch {
    return [];
  }
}
