import type { PartnerTerms } from "./pricing";

/**
 * The commission ladder (partner order 9) — pure. After `min_confirmed`
 * confirmed files in the current quarter, the company's percentage becomes
 * `pct`. A company's own ladder wins over the default one (partner_id null);
 * with no ladder at all, its approved percentage stands.
 */

export type Tier = { partner_id: string | null; min_confirmed: number; pct: number };

export type TierState = {
  terms: PartnerTerms;
  /** the files confirmed this quarter, and the next step if there is one. */
  confirmed: number;
  next: { needed: number; pct: number } | null;
};

export function effectiveTerms(base: PartnerTerms, tiers: Tier[], partnerId: string, confirmed: number): TierState {
  const own = tiers.filter((t) => t.partner_id === partnerId);
  const ladder = (own.length ? own : tiers.filter((t) => t.partner_id === null)).slice().sort((a, b) => a.min_confirmed - b.min_confirmed);
  const reached = ladder.filter((t) => confirmed >= t.min_confirmed).pop();
  const upcoming = ladder.find((t) => confirmed < t.min_confirmed);
  return {
    terms: reached ? { ...base, pct: Number(reached.pct) } : base,
    confirmed,
    next: upcoming ? { needed: upcoming.min_confirmed - confirmed, pct: Number(upcoming.pct) } : null,
  };
}

/** The first day of the quarter `day` (YYYY-MM-DD, Riyadh) falls in. */
export function quarterStart(day: string): string {
  const [y, m] = day.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(q).padStart(2, "0")}-01`;
}
