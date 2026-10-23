/**
 * «آخر إنجاز» of a case (the owner, 2026-10-23: «اول البطاقات هي اخر الانجاز»):
 * the newest moment anything was done on it — the case itself changing, a
 * booking added, requested, answered, confirmed or paid, a paper issued, a
 * payment recorded, a passport read. Pure: the board sorts its cards by it.
 */
export function lastProgress(...moments: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const m of moments) {
    if (!m) continue;
    const ms = Date.parse(m);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = m;
    }
  }
  return best;
}

/** Newest first; a case with no moment at all goes last. */
export function byLastProgress(a: { last_progress_at: string | null }, b: { last_progress_at: string | null }): number {
  return (b.last_progress_at ? Date.parse(b.last_progress_at) : 0) - (a.last_progress_at ? Date.parse(a.last_progress_at) : 0);
}
