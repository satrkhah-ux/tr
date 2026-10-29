/**
 * Working time (the coordinator's seam for sessions A and C, 2026-10-29): how many minutes of [from, to) were the
 * colleague's to answer in — inside the office's working windows (مُراد's reception hours, or a department's own),
 * outside public holidays, leaves and status buttons. A delay is judged on these minutes, not on the clock.
 *
 * Pure: the hours, the holidays and the excused windows are parameters (availability.ts reads them).
 */

import type { Hours } from "@/lib/murad/reception";
import { dayStartMs, riyadhDay, type Window } from "./excuse";

export type Span = { from: number; to: number };
const DAY = 86_400_000;
const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** the working spans touching [from, to): each Riyadh day's windows, a close at or before the open running past midnight */
export function workingSpans(hours: Hours, from: number, to: number): Span[] {
  const spans: Span[] = [];
  // a window that opened the evening before may still run past midnight into `from`
  for (let d = dayStartMs(riyadhDay(from)) - DAY; d < to; d += DAY) {
    const weekday = new Date(d + 3 * 3_600_000).getUTCDay();
    const windows = hours.week ? hours.week[weekday] : [{ open: hours.open, close: hours.close }];
    for (const w of windows) {
      const open = d + minutesOf(w.open) * 60_000;
      let close = d + minutesOf(w.close) * 60_000;
      if (close <= open) close += DAY;
      if (close > from && open < to) spans.push({ from: Math.max(open, from), to: Math.min(close, to) });
    }
  }
  return merge(spans);
}

/** overlapping or touching spans as one */
export function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].filter((x) => x.to > x.from).sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** the parts of `a` not covered by `b` */
export function subtract(a: Span[], b: Span[]): Span[] {
  const cut = merge(b);
  const out: Span[] = [];
  for (const s of merge(a)) {
    let start = s.from;
    for (const c of cut) {
      if (c.to <= start || c.from >= s.to) continue;
      if (c.from > start) out.push({ from: start, to: c.from });
      start = Math.max(start, c.to);
      if (start >= s.to) break;
    }
    if (start < s.to) out.push({ from: start, to: s.to });
  }
  return out;
}

export const holidaySpans = (days: string[]): Span[] => days.map((d) => ({ from: dayStartMs(d), to: dayStartMs(d) + DAY }));

/** the minutes of [from, to) that were working time: the office's windows, less holidays and the colleague's excused windows */
export function businessMinutes(i: { from: number; to: number; hours: Hours; holidays: string[]; excused: Window[] }): number {
  if (i.to <= i.from) return 0;
  const left = subtract(workingSpans(i.hours, i.from, i.to), [...holidaySpans(i.holidays), ...i.excused]);
  return left.reduce((t, s) => t + (s.to - s.from), 0) / 60_000;
}

/** app_settings public_holidays: ["YYYY-MM-DD", …] (or {day, name} objects); anything unreadable is no holiday */
export const HOLIDAYS_KEY = "public_holidays";
export function parseHolidays(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === "string" ? x : (x as { day?: unknown })?.day))
      .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch {
    return [];
  }
}
