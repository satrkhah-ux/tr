import { describe, expect, it } from "vitest";
import { effectiveTerms, quarterStart, type Tier } from "./tiers";

const base = { kind: "markup" as const, pct: 15 };
const ladder: Tier[] = [
  { partner_id: null, min_confirmed: 10, pct: 12 },
  { partner_id: null, min_confirmed: 25, pct: 10 },
];

describe("the commission ladder", () => {
  it("keeps the approved percentage below the first step, and says what the next one needs", () => {
    expect(effectiveTerms(base, ladder, "p1", 7)).toEqual({ terms: base, confirmed: 7, next: { needed: 3, pct: 12 } });
  });

  it("steps down at 10 and 25 confirmed files in the quarter", () => {
    expect(effectiveTerms(base, ladder, "p1", 10).terms.pct).toBe(12);
    expect(effectiveTerms(base, ladder, "p1", 30)).toMatchObject({ terms: { pct: 10 }, next: null });
  });

  it("uses a company's own ladder instead of the default one", () => {
    const own: Tier[] = [...ladder, { partner_id: "p2", min_confirmed: 5, pct: 13 }];
    expect(effectiveTerms(base, own, "p2", 6).terms.pct).toBe(13);
    expect(effectiveTerms(base, own, "p2", 30).terms.pct).toBe(13);
    expect(effectiveTerms(base, own, "p1", 30).terms.pct).toBe(10);
  });

  it("starts the quarter on its first month", () => {
    expect(quarterStart("2026-10-13")).toBe("2026-10-01");
    expect(quarterStart("2026-02-28")).toBe("2026-01-01");
    expect(quarterStart("2026-06-30")).toBe("2026-04-01");
  });
});
