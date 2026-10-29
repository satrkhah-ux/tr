/**
 * «معذور الآن» — the windows in which a colleague is away for a reason the company accepts (the owner, 2026-10-29): a
 * leave (whole Riyadh days), or a status button — «لدي عميل», «لدي اتصال», «صلاة», «اجتماع». Inside a window no request
 * is routed to them and no delay or conversation is counted against them.
 *
 * Pure: the rows, the limits and the clock are parameters (availability.ts reads them; the tests feed them).
 */

export type StatusKind = "client" | "call" | "prayer" | "meeting";
export type ExcuseReason = "leave" | StatusKind;
export const STATUS_KINDS: StatusKind[] = ["client", "call", "prayer", "meeting"];
export const EXCUSE_LABEL: Record<ExcuseReason, string> = { leave: "إجازة", client: "لديه عميل", call: "لديه اتصال", prayer: "صلاة", meeting: "اجتماع" };
/** the button's own words */
export const STATUS_BUTTON: Record<StatusKind, string> = { client: "لدي عميل", call: "لدي اتصال", prayer: "صلاة", meeting: "اجتماع" };

export type Window = { from: number; to: number; reason: ExcuseReason };
export type LeaveRow = { employee_id: string; starts_on: string; ends_on: string; cancelled_at: string | null };
export type StatusRow = { employee_id: string; kind: StatusKind; started_at: string; cap_at: string; ended_at: string | null };

const DAY = 86_400_000;
/** 00:00 of a Riyadh day ("YYYY-MM-DD") */
export const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00+03:00`);
export const riyadhDay = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

export const leaveWindow = (l: Pick<LeaveRow, "starts_on" | "ends_on">): Window => ({
  from: dayStartMs(l.starts_on),
  to: dayStartMs(l.ends_on) + DAY,
  reason: "leave",
});
/** a status lasts until it was ended, and never past its cap — a forgotten button stops counting at the cap */
export const statusWindow = (s: Pick<StatusRow, "kind" | "started_at" | "cap_at" | "ended_at">): Window => {
  const cap = Date.parse(s.cap_at);
  const end = s.ended_at ? Math.min(Date.parse(s.ended_at), cap) : cap;
  return { from: Date.parse(s.started_at), to: end, reason: s.kind };
};

export function windowsOf(leaves: LeaveRow[], statuses: StatusRow[]): Window[] {
  return [...leaves.filter((l) => !l.cancelled_at).map(leaveWindow), ...statuses.map(statusWindow)].filter((w) => w.to > w.from);
}

/** the window that covers `at`, a leave before a button */
export function excuseAt(windows: Window[], at: number): Window | null {
  const covering = windows.filter((w) => w.from <= at && at < w.to);
  return covering.find((w) => w.reason === "leave") ?? covering[0] ?? null;
}

/** minutes of [from, to) covered by any window — to take out of a wait or a delay; overlaps count once */
export function excusedMinutes(windows: Window[], from: number, to: number): number {
  const parts = windows
    .map((w) => [Math.max(w.from, from), Math.min(w.to, to)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of parts) {
    const start = Math.max(a, end);
    if (b > start) total += b - start;
    end = Math.max(end, b);
  }
  return total / 60_000;
}

/** the longest a button may stay on, in minutes (app_settings presence_status_limits) */
export type StatusLimits = Record<StatusKind, number>;
export const DEFAULT_LIMITS: StatusLimits = { client: 90, call: 30, prayer: 25, meeting: 120 };
export const LIMITS_KEY = "presence_status_limits";

export function parseLimits(raw: string | null | undefined): StatusLimits {
  let v: Partial<Record<StatusKind, unknown>> = {};
  try {
    v = JSON.parse(raw ?? "{}") as typeof v;
  } catch {
    /* defaults */
  }
  const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 5 && x <= 600 ? Math.round(x) : d);
  return {
    client: n(v.client, DEFAULT_LIMITS.client),
    call: n(v.call, DEFAULT_LIMITS.call),
    prayer: n(v.prayer, DEFAULT_LIMITS.prayer),
    meeting: n(v.meeting, DEFAULT_LIMITS.meeting),
  };
}

/** a client's phone as digits, Saudi local forms made international: 05xxxxxxxx / 5xxxxxxxx / 00966… → 966… */
export function phoneDigits(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = `966${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `966${d}`;
  return /^\d{6,15}$/.test(d) ? d : null;
}

export const WANTS = ["تأشيرة", "بكج", "تذكرة", "غيره"] as const;
export type Want = (typeof WANTS)[number];
export type ClientDetails = { want: Want; destination: string; name: string; phone: string; note: string };

/** «لدي عميل» / «لدي اتصال»: what the short form must hold — the name and a phone we can find them by again */
export function cleanClient(
  input: Partial<Record<keyof ClientDetails, unknown>>,
): { ok: true; details: ClientDetails; phone: string } | { ok: false; error: string } {
  const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const want = WANTS.find((w) => w === input.want);
  const name = text(input.name, 80);
  const phone = phoneDigits(text(input.phone, 30));
  if (!want) return { ok: false, error: "اختر ماذا يريد العميل." };
  if (!name) return { ok: false, error: "اكتب اسم العميل." };
  if (!phone) return { ok: false, error: "اكتب رقم هاتف صحيحاً." };
  return { ok: true, details: { want, destination: text(input.destination, 80), name, phone, note: text(input.note, 200) }, phone };
}

/** a leave of `days` whole days from a Riyadh day */
export function leaveRange(startDay: string, days: number): { starts_on: string; ends_on: string } {
  return { starts_on: startDay, ends_on: riyadhDay(dayStartMs(startDay) + Math.max(0, Math.round(days) - 1) * DAY + DAY / 2) };
}

/** two leaves of one colleague that share a day */
export const overlaps = (a: Pick<LeaveRow, "starts_on" | "ends_on">, b: Pick<LeaveRow, "starts_on" | "ends_on">) =>
  a.starts_on <= b.ends_on && b.starts_on <= a.ends_on;
