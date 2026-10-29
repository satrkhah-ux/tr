"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import type { Permission } from "@/lib/roles/roles";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { loadLimits } from "@/lib/presence/availability";
import {
  cleanClient,
  dayStartMs,
  LIMITS_KEY,
  overlaps,
  parseLimits,
  riyadhDay,
  STATUS_BUTTON,
  type StatusKind,
  type StatusLimits,
} from "@/lib/presence/excuse";
import { HOLIDAYS_KEY, parseHolidays } from "@/lib/presence/business";
import { activeShift, daysFromShift, shiftFromDays, type ShiftRow } from "@/lib/presence/shift";
import { hoursText, parseHours } from "@/lib/murad/reception";
import { SETTING } from "@/lib/murad/core";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";

/**
 * Presence (the owner, 2026-10-29): each colleague's own status buttons, and the administration's leaves, meetings and
 * log. A colleague acts on their own status only, with the button's permission (status.client / status.call /
 * status.prayer) or an invitation to a meeting that is open; the administration (employees.manage or dashboard.admin)
 * keeps the leaves, calls and ends meetings, reads the log and sets the limits. Every read and write goes through the
 * service client after that check.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type Done = { ok: true } | { ok: false; error: string };
const fail = (error: string): Done => ({ ok: false, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERM: Record<Exclude<StatusKind, "meeting">, Permission> = { client: "status.client", call: "status.call", prayer: "status.prayer" };

async function manager(): Promise<string | null> {
  const [me, team, admin] = await Promise.all([getCurrentEmployeeId(), currentCan("employees.manage"), currentCan("dashboard.admin")]);
  return me && (team || admin) ? me : null;
}

/** the meeting this colleague is invited to and that is still open */
async function openMeetingFor(employeeId: string): Promise<{ id: number; title: string } | null> {
  const { data } = await db()
    .from("staff_meetings")
    .select("id, title")
    .is("ends_at", null)
    .contains("invited", [employeeId])
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: number; title: string } | null) ?? null;
}

export type MyPresence = {
  allowed: StatusKind[];
  active: { kind: StatusKind; startedAt: string; capAt: string; details: Record<string, unknown> } | null;
  meeting: { id: number; title: string } | null;
  onLeave: { endsOn: string } | null;
  limits: StatusLimits;
  /** the server's clock when read (ms) — the button's timer starts from it */
  at: number;
};

export async function getMyPresence(): Promise<MyPresence | null> {
  const me = await getCurrentEmployeeId();
  if (!me) return null;
  const today = riyadhDay(Date.now());
  const [client, call, prayer, meeting, active, leave, limits] = await Promise.all([
    currentCan("status.client"),
    currentCan("status.call"),
    currentCan("status.prayer"),
    openMeetingFor(me),
    db().from("employee_status_events").select("kind, started_at, cap_at, details").eq("employee_id", me).is("ended_at", null).maybeSingle(),
    db()
      .from("employee_leaves")
      .select("ends_on")
      .eq("employee_id", me)
      .is("cancelled_at", null)
      .lte("starts_on", today)
      .gte("ends_on", today)
      .limit(1)
      .maybeSingle(),
    loadLimits(),
  ]);
  const allowed = (["client", "call", "prayer"] as const).filter((k, i) => [client, call, prayer][i]) as StatusKind[];
  if (meeting) allowed.push("meeting");
  const a = active.data as { kind: StatusKind; started_at: string; cap_at: string; details: Record<string, unknown> } | null;
  // past its cap it no longer counts (the sweep closes it within the minute)
  const live = a && Date.parse(a.cap_at) > Date.now() ? { kind: a.kind, startedAt: a.started_at, capAt: a.cap_at, details: a.details ?? {} } : null;
  const l = leave.data as { ends_on: string } | null;
  return { allowed, active: live, meeting, onLeave: l ? { endsOn: l.ends_on } : null, limits, at: Date.now() };
}

/** a button pressed: whatever was on ends, this one starts — at most its limit long */
export async function startMyStatus(kind: StatusKind, form?: Record<string, string>): Promise<Done> {
  const me = await getCurrentEmployeeId();
  if (!me || !["client", "call", "prayer", "meeting"].includes(kind)) return fail("forbidden");
  const meeting = kind === "meeting" ? await openMeetingFor(me) : null;
  if (kind === "meeting" ? !meeting : !(await currentCan(PERM[kind as Exclude<StatusKind, "meeting">]))) return fail("forbidden");
  let details: Record<string, unknown> = {};
  let phone: string | null = null;
  if (kind === "client" || kind === "call") {
    const c = cleanClient(form ?? {});
    if (!c.ok) return fail(c.error);
    details = c.details;
    phone = c.phone;
  }
  const limits = await loadLimits();
  const now = Date.now();
  await db()
    .from("employee_status_events")
    .update({ ended_at: new Date(now).toISOString(), ended_by: "employee" })
    .eq("employee_id", me)
    .is("ended_at", null);
  const { error } = await db()
    .from("employee_status_events")
    .insert({
      employee_id: me,
      kind,
      started_at: new Date(now).toISOString(),
      cap_at: new Date(now + limits[kind] * 60_000).toISOString(),
      details,
      client_phone: phone,
      meeting_id: meeting?.id ?? null,
    });
  return error ? fail("تعذّر الحفظ، أعد المحاولة.") : { ok: true };
}

export async function endMyStatus(): Promise<Done> {
  const me = await getCurrentEmployeeId();
  if (!me) return fail("forbidden");
  const { error } = await db()
    .from("employee_status_events")
    .update({ ended_at: new Date().toISOString(), ended_by: "employee" })
    .eq("employee_id", me)
    .is("ended_at", null);
  return error ? fail("تعذّر الحفظ، أعد المحاولة.") : { ok: true };
}

// ---------- the administration ----------

export type LeaveView = {
  id: number;
  employeeId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  reason: string;
  by: string | null;
  cancelled: boolean;
};
export type StatusLogRow = {
  id: number;
  name: string;
  kind: StatusKind;
  startedAt: string;
  endedAt: string | null;
  capAt: string;
  endedBy: string | null;
  minutes: number;
  details: Record<string, unknown>;
};
export type MeetingView = { id: number; title: string; startsAt: string; endsAt: string | null; invited: string[]; calledBy: string | null };
export type AttendanceData = {
  leaves: LeaveView[];
  log: StatusLogRow[];
  meetings: MeetingView[];
  people: { id: string; name: string }[];
  limits: StatusLimits;
  /** public holidays (app_settings public_holidays): no working minute is counted on them */
  holidays: { day: string; name: string }[];
  /** each colleague's own shift that covers today, or the next one set to start (employee_shifts) */
  shifts: ShiftView[];
  /** the office's hours (مُراد's reception hours), what everyone without a shift works */
  officeHours: string;
  day: string;
  at: number;
};
export type ShiftView = { employeeId: string; name: string; hours: string; days: string[]; startsOn: string; endsOn: string | null; note: string };

const nameMap = (rows: { id: string; arabic_name: string }[]) => new Map(rows.map((r) => [r.id, r.arabic_name.trim()]));

/** «الحضور والإجازات»: the leaves from yesterday on, the day's buttons and meetings, the limits */
export async function getAttendance(dayIn?: string): Promise<AttendanceData | null> {
  if (!(await manager())) return null;
  const now = Date.now();
  const day = dayIn && DAY.test(dayIn) ? dayIn : riyadhDay(now);
  const from = new Date(`${day}T00:00:00+03:00`).toISOString();
  const to = new Date(Date.parse(from) + 86_400_000).toISOString();
  const [{ data: people }, leaves, log, meetings, limits, holidayRow, shiftRows, officeRow] = await Promise.all([
    db().from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name"),
    db()
      .from("employee_leaves")
      .select("id, employee_id, starts_on, ends_on, reason, created_by, cancelled_at")
      .gte("ends_on", riyadhDay(now - 86_400_000))
      .order("starts_on"),
    db()
      .from("employee_status_events")
      .select("id, employee_id, kind, started_at, ended_at, cap_at, ended_by, details")
      .gte("started_at", from)
      .lt("started_at", to)
      .order("started_at", { ascending: false }),
    db()
      .from("staff_meetings")
      .select("id, title, starts_at, ends_at, invited, called_by")
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at", { ascending: false }),
    loadLimits(),
    db().from("app_settings").select("value").eq("key", HOLIDAYS_KEY).maybeSingle(),
    db()
      .from("employee_shifts")
      .select("employee_id, hours, starts_on, ends_on, note")
      .or(`ends_on.is.null,ends_on.gte.${riyadhDay(now)}`)
      .order("starts_on"),
    db().from("app_settings").select("value").eq("key", SETTING.receptionHours).maybeSingle(),
  ]);
  const names = nameMap((people ?? []) as { id: string; arabic_name: string }[]);
  const nm = (id: string | null) => (id ? (names.get(id) ?? "—") : null);
  return {
    leaves: (
      (leaves.data ?? []) as {
        id: number;
        employee_id: string;
        starts_on: string;
        ends_on: string;
        reason: string;
        created_by: string | null;
        cancelled_at: string | null;
      }[]
    ).map((l) => ({
      id: l.id,
      employeeId: l.employee_id,
      name: nm(l.employee_id) ?? "—",
      startsOn: l.starts_on,
      endsOn: l.ends_on,
      reason: l.reason,
      by: nm(l.created_by),
      cancelled: Boolean(l.cancelled_at),
    })),
    log: (
      (log.data ?? []) as {
        id: number;
        employee_id: string;
        kind: StatusKind;
        started_at: string;
        ended_at: string | null;
        cap_at: string;
        ended_by: string | null;
        details: Record<string, unknown>;
      }[]
    ).map((s) => {
      const end = Math.min(s.ended_at ? Date.parse(s.ended_at) : now, Date.parse(s.cap_at));
      return {
        id: s.id,
        name: nm(s.employee_id) ?? "—",
        kind: s.kind,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        capAt: s.cap_at,
        endedBy: s.ended_by,
        minutes: Math.max(0, Math.round((end - Date.parse(s.started_at)) / 60_000)),
        details: s.details ?? {},
      };
    }),
    meetings: (
      (meetings.data ?? []) as { id: number; title: string; starts_at: string; ends_at: string | null; invited: string[]; called_by: string | null }[]
    ).map((m) => ({
      id: m.id,
      title: m.title,
      startsAt: m.starts_at,
      endsAt: m.ends_at,
      invited: (m.invited ?? []).map((id) => nm(id) ?? "—"),
      calledBy: nm(m.called_by),
    })),
    people: [...names].map(([id, name]) => ({ id, name })),
    limits: limits,
    holidays: holidaysOf((holidayRow.data as { value?: string } | null)?.value),
    shifts: shiftsOf((shiftRows.data ?? []) as ShiftRow[], riyadhDay(now)).map((r) => ({
      employeeId: r.employee_id,
      name: nm(r.employee_id) ?? "—",
      hours: r.hours,
      days: daysFromShift(r.hours),
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      note: r.note ?? "",
    })),
    officeHours: hoursText(parseHours((officeRow.data as { value?: string } | null)?.value)),
    day,
    at: now,
  };
}

/** per colleague: the shift covering today, else the next one to start */
function shiftsOf(rows: ShiftRow[], today: string): ShiftRow[] {
  const by = new Map<string, ShiftRow[]>();
  for (const r of rows) by.set(r.employee_id, [...(by.get(r.employee_id) ?? []), r]);
  return [...by.values()].map((list) => activeShift(list, today) ?? [...list].sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0]);
}

/** «دوام خاص»: the seven days (Saturday first) from a day on, until a day if given — a new row, the old one ended the day before */
export async function saveShift(input: { employeeId: string; days: string[]; startsOn: string; endsOn: string | null; note: string }): Promise<Done> {
  const me = await manager();
  if (!me) return fail("forbidden");
  if (!UUID.test(input.employeeId) || !DAY.test(input.startsOn) || (input.endsOn !== null && (!DAY.test(input.endsOn) || input.endsOn < input.startsOn)))
    return fail("اختر الموظف وتاريخ البداية.");
  const shift = shiftFromDays(input.days);
  if (!shift.ok) return fail(shift.error);
  // what ran before ends the day before this starts; one set to start later is replaced
  const dayBefore = riyadhDay(dayStartMs(input.startsOn) - 43_200_000);
  await db().from("employee_shifts").delete().eq("employee_id", input.employeeId).gte("starts_on", input.startsOn);
  await db().from("employee_shifts").update({ ends_on: dayBefore }).eq("employee_id", input.employeeId).or(`ends_on.is.null,ends_on.gte.${input.startsOn}`);
  const { error } = await db()
    .from("employee_shifts")
    .insert({
      employee_id: input.employeeId,
      hours: shift.hours,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      note: (input.note ?? "").trim().slice(0, 200),
      created_by: me,
    });
  if (error) return fail("تعذّر الحفظ، أعد المحاولة.");
  await logAudit({
    action: "presence.shift_saved",
    entity: "employees",
    entity_id: input.employeeId,
    meta: { hours: shift.hours, from: input.startsOn, to: input.endsOn },
  });
  return { ok: true };
}

/** back to the office's (or the department's) hours from today */
export async function endShift(employeeId: string): Promise<Done> {
  const me = await manager();
  if (!me || !UUID.test(employeeId)) return fail("forbidden");
  const today = riyadhDay(Date.now());
  const yesterday = riyadhDay(Date.now() - 86_400_000);
  await db().from("employee_shifts").delete().eq("employee_id", employeeId).gte("starts_on", today);
  const { error } = await db().from("employee_shifts").update({ ends_on: yesterday }).eq("employee_id", employeeId).or(`ends_on.is.null,ends_on.gte.${today}`);
  if (error) return fail("تعذّر الحفظ، أعد المحاولة.");
  await logAudit({ action: "presence.shift_saved", entity: "employees", entity_id: employeeId, meta: { ended: today } });
  return { ok: true };
}

async function tell(employeeId: string, text: string, slot: string): Promise<void> {
  const { data } = await db().from("employees").select("telegram_chat_id").eq("id", employeeId).maybeSingle();
  const chat = Number((data as { telegram_chat_id?: number | string | null } | null)?.telegram_chat_id);
  if (chat) await staffSend(chat, text, undefined, {}, slot).catch(() => undefined);
}

export async function addLeave(input: { employeeId: string; startsOn: string; endsOn: string; reason: string }): Promise<Done> {
  const me = await manager();
  if (!me) return fail("forbidden");
  if (!UUID.test(input.employeeId) || !DAY.test(input.startsOn) || !DAY.test(input.endsOn) || input.endsOn < input.startsOn)
    return fail("اختر الموظف وتاريخ البداية والنهاية.");
  if (input.endsOn < riyadhDay(Date.now())) return fail("لا تُسجَّل إجازة انتهت.");
  const { data: same } = await db().from("employee_leaves").select("starts_on, ends_on").eq("employee_id", input.employeeId).is("cancelled_at", null);
  if (((same ?? []) as { starts_on: string; ends_on: string }[]).some((l) => overlaps(l, { starts_on: input.startsOn, ends_on: input.endsOn })))
    return fail("للموظف إجازة تتقاطع مع هذه الأيام.");
  const reason = (input.reason ?? "").trim().slice(0, 300);
  const { data, error } = await db()
    .from("employee_leaves")
    .insert({ employee_id: input.employeeId, starts_on: input.startsOn, ends_on: input.endsOn, reason, created_by: me })
    .select("id")
    .single();
  if (error || !data) return fail("تعذّر الحفظ، أعد المحاولة.");
  await logAudit({
    action: "presence.leave_added",
    entity: "employees",
    entity_id: input.employeeId,
    meta: { leave: (data as { id: number }).id, from: input.startsOn, to: input.endsOn },
  });
  await tell(
    input.employeeId,
    `🏖️ <b>إجازة</b>\n\nمن ${input.startsOn} إلى ${input.endsOn}${reason ? ` — ${escapeHtml(reason)}` : ""}.\nلن تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تعود.`,
    "leave",
  );
  return { ok: true };
}

export async function cancelLeave(id: number): Promise<Done> {
  const me = await manager();
  if (!me || !Number.isInteger(id)) return fail("forbidden");
  const { data, error } = await db()
    .from("employee_leaves")
    .update({ cancelled_at: new Date().toISOString(), cancelled_by: me })
    .eq("id", id)
    .is("cancelled_at", null)
    .select("employee_id")
    .maybeSingle();
  if (error || !data) return fail("تعذّر الإلغاء، أعد المحاولة.");
  await logAudit({ action: "presence.leave_cancelled", entity: "employees", entity_id: (data as { employee_id: string }).employee_id, meta: { leave: id } });
  return { ok: true };
}

export async function saveStatusLimits(limits: Partial<StatusLimits>): Promise<Done> {
  if (!(await manager())) return fail("forbidden");
  const clean = parseLimits(JSON.stringify(limits));
  const { error } = await db()
    .from("app_settings")
    .upsert({ key: LIMITS_KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() });
  if (error) return fail("تعذّر الحفظ، أعد المحاولة.");
  await logAudit({ action: "presence.limits_saved", entity: "app_settings", entity_id: LIMITS_KEY, meta: clean });
  return { ok: true };
}

/** «اجتماع»: the invitees see the button while it is open, and «تنبيهاتي» tells them */
export async function callMeeting(title: string, invited: string[]): Promise<Done> {
  const me = await manager();
  if (!me) return fail("forbidden");
  const t = (title ?? "").trim().slice(0, 200);
  const ids = [...new Set(invited.filter((id) => UUID.test(id)))];
  if (!t || !ids.length) return fail("اكتب عنوان الاجتماع واختر المدعوّين.");
  const { data, error } = await db().from("staff_meetings").insert({ title: t, called_by: me, invited: ids }).select("id").single();
  if (error || !data) return fail("تعذّر الحفظ، أعد المحاولة.");
  await logAudit({
    action: "presence.meeting_called",
    entity: "staff_meetings",
    entity_id: String((data as { id: number }).id),
    meta: { invited: ids.length },
  });
  for (const id of ids)
    await tell(
      id,
      `📣 <b>اجتماع الآن</b>: ${escapeHtml(t)}\n\nاضغط «${STATUS_BUTTON.meeting}» بجانب مُراد في النظام: لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير أثناءه.`,
      "meeting",
    );
  return { ok: true };
}

export async function endMeeting(id: number): Promise<Done> {
  if (!(await manager()) || !Number.isInteger(id)) return fail("forbidden");
  const now = new Date().toISOString();
  const { data, error } = await db().from("staff_meetings").update({ ends_at: now }).eq("id", id).is("ends_at", null).select("id").maybeSingle();
  if (error || !data) return fail("هذا الاجتماع انتهى من قبل.");
  await db().from("employee_status_events").update({ ended_at: now, ended_by: "manager" }).eq("meeting_id", id).is("ended_at", null);
  await logAudit({ action: "presence.meeting_ended", entity: "staff_meetings", entity_id: String(id), meta: {} });
  return { ok: true };
}

/** the list as kept: plain days or {day, name}; the days only are what the working minutes read */
function holidaysOf(raw: string | null | undefined): { day: string; name: string }[] {
  let named = new Map<string, string>();
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    if (Array.isArray(v))
      named = new Map(
        v.filter((x) => x && typeof x === "object").map((x) => [String((x as { day?: unknown }).day), String((x as { name?: unknown }).name ?? "")]),
      );
  } catch {
    /* none */
  }
  return parseHolidays(raw)
    .map((day) => ({ day, name: named.get(day) ?? "" }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** «العطل الرسمية»: replaced whole, past days dropped */
export async function saveHolidays(list: { day: string; name: string }[]): Promise<Done> {
  if (!(await manager())) return fail("forbidden");
  const today = riyadhDay(Date.now() - 31 * 86_400_000);
  const clean = [...new Map(list.filter((h) => DAY.test(h.day) && h.day >= today).map((h) => [h.day, (h.name ?? "").trim().slice(0, 80)])).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, name]) => ({ day, name }));
  const { error } = await db()
    .from("app_settings")
    .upsert({ key: HOLIDAYS_KEY, value: JSON.stringify(clean), updated_at: new Date().toISOString() });
  if (error) return fail("تعذّر الحفظ، أعد المحاولة.");
  await logAudit({ action: "presence.limits_saved", entity: "app_settings", entity_id: HOLIDAYS_KEY, meta: { days: clean.length } });
  return { ok: true };
}
