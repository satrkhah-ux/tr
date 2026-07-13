"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles/roles";

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

async function employeeIdForUser(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase.from("employees").select("id").eq("auth_user_id", userId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Resolve the signed-in user's real role from their linked employee record. */
export async function getCurrentRole(): Promise<Role> {
  const user = await getServerUser();
  if (!user) return "visitor";
  try {
    const supabase = await db();
    const { data: emp } = await supabase.from("employees").select("id, role_id").eq("auth_user_id", user.id).maybeSingle();
    const employee = emp as { id: string; role_id: string | null } | null;
    if (!employee) return "employee";
    if (employee.role_id) {
      const { data: role } = await supabase.from("roles").select("english_name").eq("id", employee.role_id).maybeSingle();
      if ((role as { english_name: string | null } | null)?.english_name === "All Permissions") return "admin";
    }
    return "employee";
  } catch {
    return "visitor";
  }
}

/** Heartbeat — keeps the signed-in employee's presence row fresh (online-now). */
export async function touchPresence(): Promise<void> {
  try {
    const user = await getServerUser();
    if (!user) return;
    const supabase = await db();
    const empId = await employeeIdForUser(supabase, user.id);
    if (!empId) return;
    await supabase
      .from("presence")
      .upsert({ employee_id: empId, user_id: user.id, last_seen_at: new Date().toISOString() }, { onConflict: "employee_id" });
  } catch {
    /* presence is best-effort; never blocks the page */
  }
}

// ---------- employee view ----------
export type RequestTypeCount = { type: string; count: number };
export type EmployeeMetrics = {
  ok: boolean;
  requestsToday: number;
  packages: number;
  executed: number;
  requestTypes: RequestTypeCount[];
};

export async function getEmployeeMetrics(employeeId?: string): Promise<EmployeeMetrics> {
  const empty: EmployeeMetrics = { ok: false, requestsToday: 0, packages: 0, executed: 0, requestTypes: [] };
  try {
    const user = await getServerUser();
    if (!user) return empty;
    const supabase = await db();
    const scopeId = employeeId ?? (await employeeIdForUser(supabase, user.id));
    if (!scopeId) return { ...empty, ok: true };

    const today = startOfTodayIso();
    const [todayCount, packagesCount, executedCount, typeRows] = await Promise.all([
      supabase.from("care_tickets").select("id", { count: "exact", head: true }).eq("employee_id", scopeId).gte("created_at", today),
      supabase.from("offers").select("id", { count: "exact", head: true }).eq("employee_id", scopeId),
      supabase.from("care_tickets").select("id", { count: "exact", head: true }).eq("employee_id", scopeId).not("responded_at", "is", null),
      supabase.from("care_tickets").select("type").eq("employee_id", scopeId),
    ]);

    const counts = new Map<string, number>();
    for (const row of (typeRows.data ?? []) as { type: string | null }[]) {
      const key = row.type ?? "غير محدد";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      ok: true,
      requestsToday: todayCount.count ?? 0,
      packages: packagesCount.count ?? 0,
      executed: executedCount.count ?? 0,
      requestTypes: [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    };
  } catch {
    return empty;
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
    const user = await getServerUser();
    if (!user) return empty;
    const supabase = await db();
    const onlineCut = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60_000).toISOString();
    const today = startOfTodayIso();

    let presenceQuery = supabase.from("presence").select("employee_id, last_seen_at");
    if (employeeFilterId) presenceQuery = presenceQuery.eq("employee_id", employeeFilterId);
    const presence = ((await presenceQuery).data ?? []) as { employee_id: string; last_seen_at: string }[];
    const onlineNow = presence.filter((p) => p.last_seen_at >= onlineCut).length;
    const activeToday = presence.filter((p) => p.last_seen_at >= today).length;

    let ticketsQuery = supabase.from("care_tickets").select("employee_id, responded_at");
    if (employeeFilterId) ticketsQuery = ticketsQuery.eq("employee_id", employeeFilterId);
    const tickets = ((await ticketsQuery).data ?? []) as { employee_id: string | null; responded_at: string | null }[];

    const assigned = new Set<string>();
    const pending = new Set<string>();
    let answered = 0;
    for (const t of tickets) {
      if (t.responded_at) answered += 1;
      if (t.employee_id) {
        assigned.add(t.employee_id);
        if (!t.responded_at) pending.add(t.employee_id);
      }
    }

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
