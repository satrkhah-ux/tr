import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  EXCUSE_LABEL,
  excuseAt,
  LIMITS_KEY,
  parseLimits,
  phoneDigits,
  riyadhDay,
  windowsOf,
  type ExcuseReason,
  type LeaveRow,
  type StatusLimits,
  type StatusRow,
  type Window,
} from "./excuse";

/**
 * «هل الموظف متاح / معذور الآن» — the one answer sessions A (conversations / Murad) and C (follow-up supervision) read,
 * and the switchboard routes by (the owner, 2026-10-29). Read-only, server-only; the CALLER decides what to do with it:
 * route nothing to an excused colleague, count no delay or conversation against them inside their windows.
 *
 *   employeeAvailability(id, atMs?)     → { available, reason }       leave / off_shift / break / offline / exempt
 *   availabilityOf(ids, atMs?, dept?)   → Map<employeeId, Availability> the same for many (routing)
 *   businessMinutesBetween(from, to, {employeeId?, department?}) → working minutes (hours, holidays, leaves, buttons out)
 *   excusedNow(at?)                     → Map<employeeId, Excuse>     who is away right now, and why
 *   excusedAgents(at?)                  → Map<teletelAgentId, Excuse> the same, by Teletel agent (routing, Teletel counts)
 *   excusedWindows(ids, fromMs, toMs)   → Map<employeeId, Window[]>   to take out of a delay (excuse.ts excusedMinutes)
 *   clientHint(phone)                   → the colleague who met / spoke to this client lately («لدي عميل» / «لدي اتصال»)
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

export type Excuse = { employeeId: string; agentId: number | null; reason: ExcuseReason; since: string; until: string | null; label: string };

const LEAVE_COLS = "employee_id, starts_on, ends_on, cancelled_at";
const STATUS_COLS = "employee_id, kind, started_at, cap_at, ended_at";

export async function loadLimits(): Promise<StatusLimits> {
  const { data } = await db().from("app_settings").select("value").eq("key", LIMITS_KEY).maybeSingle();
  return parseLimits((data as { value?: string } | null)?.value);
}

/** every window of these colleagues touching [fromMs, toMs) — leaves and buttons; a missing table reads as none */
export async function excusedWindows(employeeIds: string[], fromMs: number, toMs: number): Promise<Map<string, Window[]>> {
  const out = new Map<string, Window[]>(employeeIds.map((id) => [id, []]));
  if (!employeeIds.length) return out;
  const [leaves, statuses] = await Promise.all([
    db()
      .from("employee_leaves")
      .select(LEAVE_COLS)
      .in("employee_id", employeeIds)
      .is("cancelled_at", null)
      .lte("starts_on", riyadhDay(toMs))
      .gte("ends_on", riyadhDay(fromMs)),
    db()
      .from("employee_status_events")
      .select(STATUS_COLS)
      .in("employee_id", employeeIds)
      .lt("started_at", new Date(toMs).toISOString())
      .gt("cap_at", new Date(fromMs).toISOString()),
  ]);
  for (const id of employeeIds) {
    const w = windowsOf(
      ((leaves.data ?? []) as LeaveRow[]).filter((l) => l.employee_id === id),
      ((statuses.data ?? []) as StatusRow[]).filter((s) => s.employee_id === id),
    ).filter((x) => x.to > fromMs && x.from < toMs);
    out.set(id, w);
  }
  return out;
}

/** who is excused at `at` (now): a leave covering today, or a button still on and under its cap */
export async function excusedNow(at = Date.now()): Promise<Map<string, Excuse>> {
  const iso = new Date(at).toISOString();
  const day = riyadhDay(at);
  const [leaves, statuses] = await Promise.all([
    db().from("employee_leaves").select(LEAVE_COLS).is("cancelled_at", null).lte("starts_on", day).gte("ends_on", day),
    db().from("employee_status_events").select(STATUS_COLS).lte("started_at", iso).gt("cap_at", iso).or(`ended_at.is.null,ended_at.gt.${iso}`),
  ]);
  const rows = new Map<string, { leaves: LeaveRow[]; statuses: StatusRow[] }>();
  for (const l of (leaves.data ?? []) as LeaveRow[])
    rows.set(l.employee_id, { leaves: [...(rows.get(l.employee_id)?.leaves ?? []), l], statuses: rows.get(l.employee_id)?.statuses ?? [] });
  for (const s of (statuses.data ?? []) as StatusRow[])
    rows.set(s.employee_id, { leaves: rows.get(s.employee_id)?.leaves ?? [], statuses: [...(rows.get(s.employee_id)?.statuses ?? []), s] });
  if (!rows.size) return new Map();
  const { data: emps } = await db()
    .from("employees")
    .select("id, teletel_agent_id")
    .in("id", [...rows.keys()]);
  const agent = new Map(((emps ?? []) as { id: string; teletel_agent_id: number | null }[]).map((e) => [e.id, e.teletel_agent_id]));
  const out = new Map<string, Excuse>();
  for (const [id, r] of rows) {
    const w = excuseAt(windowsOf(r.leaves, r.statuses), at);
    if (!w) continue;
    out.set(id, {
      employeeId: id,
      agentId: agent.get(id) ?? null,
      reason: w.reason,
      since: new Date(w.from).toISOString(),
      until: new Date(w.to).toISOString(),
      label: EXCUSE_LABEL[w.reason],
    });
  }
  return out;
}

export async function excusedAgents(at = Date.now()): Promise<Map<number, Excuse>> {
  const out = new Map<number, Excuse>();
  for (const e of (await excusedNow(at)).values()) if (e.agentId !== null) out.set(Number(e.agentId), e);
  return out;
}

// ---------- the seam for A and C: one answer per colleague, and working minutes ----------

/**
 * Why a colleague is not to be given work or judged on a delay now — the first that applies:
 *   leave      on leave today
 *   off_shift  outside the office's working hours (مُراد's reception hours, or the department's own)
 *   break      a status button is on: «لدي عميل», «لدي اتصال», «صلاة», «اجتماع»
 *   offline    neither the system open nor «متصل» in Teletel
 *   exempt     AVAILABLE, but the administration excluded them from lateness (app_settings lateness_exempt, session A's)
 */
export type AvailabilityReason = "leave" | "off_shift" | "break" | "offline" | "exempt";
export type Availability = { available: boolean; reason: AvailabilityReason | null };

/**
 * Everyone with no lateness counted — session A's setting (lateness_exempt: employees, roles, whole Teletel teams), read
 * by its own latenessExempt (leads/lifecycle.ts); a team is opened to its members' agents here (cached a minute). For a
 * time-independent «is this colleague exempt» — the evening report, the letters — ask this, not availabilityOf, whose
 * «exempt» only shows when nothing else (off shift, leave…) comes first.
 */
export async function exemptStaff(): Promise<{ employeeIds: ReadonlySet<string>; agentIds: ReadonlySet<number> }> {
  const { latenessExempt } = await import("@/lib/leads/lifecycle");
  const x = await latenessExempt().catch(() => null);
  if (!x) return { employeeIds: new Set(), agentIds: new Set() };
  const agentIds = new Set(x.agentIds);
  if (x.teamIds.size) {
    const { teamMembers } = await import("@/lib/providers/teletel");
    for (const members of await Promise.all([...x.teamIds].map((t) => teamMembers(t).catch(() => [])))) for (const m of members) agentIds.add(m.id);
  }
  return { employeeIds: x.employeeIds, agentIds };
}
export const isExempt = (x: { employeeIds: ReadonlySet<string>; agentIds: ReadonlySet<number> }, m: { id: string; agentId: number | null }) =>
  x.employeeIds.has(m.id) || (m.agentId !== null && x.agentIds.has(Number(m.agentId)));
/** a department's own working hours, when it has them: {"<department>": "<hours text as مُراد's>"} */
export const DEPARTMENT_HOURS_KEY = "department_hours";

let onlineCache: { at: number; ids: Set<number> | null } | null = null;
/** online now, cached a minute (the Teletel agents list is one call for everyone) */
async function onlineAgentIds(): Promise<Set<number> | null> {
  if (onlineCache && Date.now() - onlineCache.at < 60_000) return onlineCache.ids;
  const { onlineAgents } = await import("@/lib/mine/remind");
  const ids = await onlineAgents().catch(() => null);
  onlineCache = { at: Date.now(), ids };
  return ids;
}

async function settings(keys: string[]): Promise<Map<string, string>> {
  const { data } = await db().from("app_settings").select("key, value").in("key", keys);
  return new Map(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
}

async function hoursFor(department: string | undefined, s: Map<string, string>) {
  const { parseHours } = await import("@/lib/murad/reception");
  const { SETTING } = await import("@/lib/murad/core");
  if (department) {
    try {
      const own = (JSON.parse(s.get(DEPARTMENT_HOURS_KEY) ?? "{}") as Record<string, unknown>)[department];
      if (typeof own === "string" && own.trim()) return parseHours(own);
    } catch {
      /* the office's */
    }
  }
  return parseHours(s.get(SETTING.receptionHours));
}

/**
 * Each colleague's own shift that covers the Riyadh day of `atMs` (employee_shifts, the owner 2026-10-29): it overrides
 * the department's and the office's hours for them. A missing table reads as none.
 */
export async function ownShifts(employeeIds: string[], atMs = Date.now()): Promise<Map<string, import("@/lib/murad/reception").Hours>> {
  const out = new Map<string, import("@/lib/murad/reception").Hours>();
  if (!employeeIds.length) return out;
  const { activeShift } = await import("./shift");
  const { parseHours } = await import("@/lib/murad/reception");
  const day = riyadhDay(atMs);
  const { data } = await db().from("employee_shifts").select("employee_id, hours, starts_on, ends_on").in("employee_id", employeeIds).lte("starts_on", day);
  const rows = (data ?? []) as { employee_id: string; hours: string; starts_on: string; ends_on: string | null }[];
  for (const id of employeeIds) {
    const own = activeShift(
      rows.filter((r) => r.employee_id === id),
      day,
    );
    if (own) out.set(id, parseHours(own.hours));
  }
  return out;
}

/** every colleague asked for, at `atMs`: available, or why not (see AvailabilityReason) — each by their own shift when they have one */
export async function availabilityOf(employeeIds: string[], atMs = Date.now(), department?: string): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>();
  if (!employeeIds.length) return out;
  const { SETTING } = await import("@/lib/murad/core");
  const { isWorkingTime } = await import("@/lib/murad/reception");
  const [excused, s, online, { data: emps }, exempt, shifts] = await Promise.all([
    excusedNow(atMs),
    settings([SETTING.receptionHours, DEPARTMENT_HOURS_KEY]),
    onlineAgentIds(),
    db().from("employees").select("id, teletel_agent_id").in("id", employeeIds),
    exemptStaff(),
    ownShifts(employeeIds, atMs),
  ]);
  const hours = await hoursFor(department, s);
  const officeWorking = isWorkingTime(new Date(atMs), hours);
  const row = new Map(((emps ?? []) as { id: string; teletel_agent_id: number | null }[]).map((e) => [e.id, e]));
  for (const id of employeeIds) {
    const e = row.get(id);
    const x = excused.get(id);
    const own = shifts.get(id);
    const working = own ? isWorkingTime(new Date(atMs), own) : officeWorking;
    const reason: AvailabilityReason | null =
      x?.reason === "leave"
        ? "leave"
        : !working
          ? "off_shift"
          : x
            ? "break"
            : online && !(e?.teletel_agent_id && online.has(Number(e.teletel_agent_id)))
              ? "offline"
              : isExempt(exempt, { id, agentId: e?.teletel_agent_id ?? null })
                ? "exempt"
                : null;
    out.set(id, { available: reason === null || reason === "exempt", reason });
  }
  return out;
}

export async function employeeAvailability(employeeId: string, atMs = Date.now()): Promise<Availability> {
  return (await availabilityOf([employeeId], atMs)).get(employeeId) ?? { available: false, reason: "offline" };
}

/**
 * The working minutes of [fromMs, toMs): the colleague's own shift when they have one, else the department's or the
 * office's windows; less public holidays (app_settings public_holidays) and — with an employee — their leaves and status
 * buttons. Judge a delay on this, not on the clock.
 * ponytail: the shift that covers `fromMs` is used for the whole span; a span across a shift change is rare (a wait).
 */
export async function businessMinutesBetween(fromMs: number, toMs: number, opts: { employeeId?: string; department?: string } = {}): Promise<number> {
  if (toMs <= fromMs) return 0;
  const { SETTING } = await import("@/lib/murad/core");
  const { businessMinutes, HOLIDAYS_KEY, parseHolidays } = await import("./business");
  const [s, windows, shifts] = await Promise.all([
    settings([SETTING.receptionHours, DEPARTMENT_HOURS_KEY, HOLIDAYS_KEY]),
    opts.employeeId ? excusedWindows([opts.employeeId], fromMs, toMs) : Promise.resolve(new Map<string, Window[]>()),
    opts.employeeId ? ownShifts([opts.employeeId], fromMs) : Promise.resolve(new Map<string, import("@/lib/murad/reception").Hours>()),
  ]);
  return businessMinutes({
    from: fromMs,
    to: toMs,
    hours: (opts.employeeId && shifts.get(opts.employeeId)) || (await hoursFor(opts.department, s)),
    holidays: parseHolidays(s.get(HOLIDAYS_KEY)),
    excused: opts.employeeId ? (windows.get(opts.employeeId) ?? []) : [],
  });
}

/** how long a client met or spoken to stays with that colleague when they write to us */
export const HINT_DAYS = 14;

/**
 * The colleague who registered this client on «لدي عميل» / «لدي اتصال» in the last fourteen days — the newest — with
 * what they asked for: their next message goes to that colleague (the switchboard), who is told who it is.
 */
export async function clientHint(
  phoneRaw: string | null | undefined,
  at = Date.now(),
): Promise<{ employeeId: string; kind: "client" | "call"; details: Record<string, unknown>; at: string } | null> {
  const phone = phoneDigits(phoneRaw);
  if (!phone) return null;
  const { data } = await db()
    .from("employee_status_events")
    .select("employee_id, kind, details, started_at")
    .eq("client_phone", phone)
    .in("kind", ["client", "call"])
    .gte("started_at", new Date(at - HINT_DAYS * 86_400_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { employee_id: string; kind: "client" | "call"; details: Record<string, unknown>; started_at: string } | null;
  return row ? { employeeId: row.employee_id, kind: row.kind, details: row.details ?? {}, at: row.started_at } : null;
}
