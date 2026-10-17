/**
 * Which days of the programme the client's trip page shows open (owner,
 * 2026-10-17): today and the day after it — where they are and where they go
 * next — and the rest folded to one line, so the page does not grow into a
 * long read. Before the trip: the first two days. After it: none.
 */
export type DayWhen = "past" | "today" | "next" | "later";

export function dayStates(dates: (string | null)[], today: string): DayWhen[] {
  const known = dates.filter((d): d is string => Boolean(d));
  // undated programme: nothing to measure against — the first two, as before the trip
  let anchor = known.length === 0 ? 0 : dates.findIndex((d) => d === today);
  if (anchor < 0) {
    if (today < known[0]) anchor = 0;
    else if (today > known[known.length - 1]) return dates.map(() => "past");
    // a day the programme skips (a gap): the next dated day
    else anchor = dates.findIndex((d) => Boolean(d) && (d as string) > today);
  }
  const started = known.length > 0 && today >= known[0];
  return dates.map((_, i) =>
    i < anchor ? "past" : i === anchor ? (started ? "today" : "next") : i === anchor + 1 ? "next" : "later",
  );
}
