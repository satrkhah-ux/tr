import { describe, expect, it } from "vitest";
import { __testables } from "./ai-extract";

/**
 * The guards around the model's output. A model asked for a date will happily
 * produce a plausible-looking one, and a travel date read off artwork is the
 * easiest thing to misread. A WRONG date is worse than a missing one: it flows
 * silently into the client's offer, while a blank field stops at the review
 * gate. These tests pin that behaviour.
 */
const { plausibleTripDate, plausibleRange } = __testables;

// a fixed "now" so the window never drifts with the calendar
const NOW = Date.parse("2026-07-28T00:00:00Z");

describe("plausibleTripDate", () => {
  it("keeps a date in the sellable window", () => {
    expect(plausibleTripDate("2026-09-10", NOW)).toBe("2026-09-10");
    expect(plausibleTripDate("2027-03-01", NOW)).toBe("2027-03-01");
  });

  it("drops the year a vision model invents from Eastern digits", () => {
    // the real failure: «٢٠٢٦-٠٩-١٠» on a slide came back as 2023-09-26
    expect(plausibleTripDate("2023-09-26", NOW)).toBeNull();
  });

  it("drops a date too far ahead to be a real supplier package", () => {
    expect(plausibleTripDate("2031-01-01", NOW)).toBeNull();
  });

  it("allows a trip that started days ago but not one from last year", () => {
    expect(plausibleTripDate("2026-07-20", NOW)).toBe("2026-07-20");
    expect(plausibleTripDate("2025-01-01", NOW)).toBeNull();
  });

  it("passes null and rubbish straight through as null", () => {
    expect(plausibleTripDate(null, NOW)).toBeNull();
    expect(plausibleTripDate("not-a-date", NOW)).toBeNull();
  });
});

describe("plausibleRange", () => {
  it("keeps a range that runs forwards", () => {
    expect(plausibleRange("2026-09-10", "2026-09-16", NOW)).toEqual(["2026-09-10", "2026-09-16"]);
  });

  it("drops BOTH ends when they run backwards — that means a misread", () => {
    expect(plausibleRange("2026-09-16", "2026-09-10", NOW)).toEqual([null, null]);
  });

  it("keeps one end when the other is missing", () => {
    expect(plausibleRange("2026-09-10", null, NOW)).toEqual(["2026-09-10", null]);
  });
});
