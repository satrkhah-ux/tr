/**
 * A colleague's own shift (the owner, 2026-10-29: «دوام خاص لكل موظف: ليلي، مقسّم، أيام أخرى»): it overrides the
 * department's or the office's hours for them. Kept in employee_shifts as مُراد's hours text, so murad/reception.ts
 * parses both. The page edits it day by day (Saturday first), each day its windows: «10:30-12:30 16:00-00:00», empty =
 * off. Pure.
 */

import { hoursText, parseHours, type Hours, type Window } from "@/lib/murad/reception";

export type ShiftRow = { employee_id: string; hours: string; starts_on: string; ends_on: string | null; note?: string };

/** the shift that covers `day` ("YYYY-MM-DD"): the newest started on or before it and not ended before it */
export function activeShift<T extends ShiftRow>(rows: T[], day: string): T | null {
  return rows.filter((r) => r.starts_on <= day && (!r.ends_on || r.ends_on >= day)).sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0] ?? null;
}

/** the editor's order: Saturday … Friday, as JS weekdays */
export const SAT_FIRST_DAYS = [6, 0, 1, 2, 3, 4, 5] as const;
export const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;

const WINDOW = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
const pad = (h: string, m: string) => `${String(Number(h) % 24).padStart(2, "0")}:${m}`;

/** one day's windows typed as «10:30-12:30 16:00-00:00» (Arabic digits and «–» welcome); null = unreadable */
export function readWindows(text: string): Window[] | null {
  const clean = text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .trim();
  if (!clean) return [];
  const out: Window[] = [];
  for (const token of clean.split(/[\s،,]+/).filter(Boolean)) {
    const m = WINDOW.exec(token);
    if (!m || Number(m[1]) > 24 || Number(m[3]) > 24 || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
    const w = { open: pad(m[1], m[2]), close: pad(m[3], m[4]) };
    if (w.open === w.close) return null;
    out.push(w);
  }
  return out.sort((a, b) => a.open.localeCompare(b.open));
}

/** the seven days (Saturday first) → the stored text; the day that does not read is named */
export function shiftFromDays(days: string[]): { ok: true; hours: string } | { ok: false; error: string } {
  if (days.length !== 7) return { ok: false, error: "أدخل الأيام السبعة." };
  const week: Window[][] = Array.from({ length: 7 }, () => []);
  for (let i = 0; i < 7; i++) {
    const w = readWindows(days[i] ?? "");
    if (w === null) return { ok: false, error: `لم أفهم دوام «${DAY_NAMES[SAT_FIRST_DAYS[i]]}». اكتبه هكذا: 16:00-00:00 أو 10:30-12:30 16:00-00:00` };
    week[SAT_FIRST_DAYS[i]] = w;
  }
  if (week.every((d) => !d.length)) return { ok: false, error: "الدوام بلا أي يوم عمل — اترك الموظف على دوام المكتب بدلاً من ذلك." };
  const first = week.find((d) => d.length)![0];
  return { ok: true, hours: hoursText({ open: first.open, close: first.close, week }) };
}

/** the stored text back to the seven inputs (Saturday first) */
export function daysFromShift(hours: string): string[] {
  const h: Hours = parseHours(hours);
  const week = h.week ?? Array.from({ length: 7 }, () => [{ open: h.open, close: h.close }]);
  return SAT_FIRST_DAYS.map((d) => week[d].map((w) => `${w.open}-${w.close}`).join(" "));
}
