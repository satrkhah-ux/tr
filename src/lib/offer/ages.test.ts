import { describe, expect, it } from "vitest";
import { AGE_BANDS, clampAge, resizeAges } from "./draft-types";

/**
 * The screenshot that started this: a «طفل» aged 31 and a «رضيع» aged 74, both
 * saved without complaint. These ages are not decoration — they go to the
 * supplier as real passenger ages and decide what the room and the seat cost.
 */
describe("passenger ages", () => {
  it("refuses an adult in a child box", () => {
    expect(clampAge("children", 31)).toBe(11);
    expect(clampAge("children", 12)).toBe(11);
  });

  it("refuses an adult in an infant box", () => {
    expect(clampAge("infants", 74)).toBe(1);
    expect(clampAge("infants", 2)).toBe(1);
  });

  it("refuses a child too young to be one — that is an infant", () => {
    expect(clampAge("children", 0)).toBe(2);
    expect(clampAge("children", 1)).toBe(2);
  });

  it("leaves a legitimate age exactly as typed", () => {
    for (let age = AGE_BANDS.children.min; age <= AGE_BANDS.children.max; age++) {
      expect(clampAge("children", age)).toBe(age);
    }
    expect(clampAge("infants", 0)).toBe(0);
    expect(clampAge("infants", 1)).toBe(1);
  });

  it("survives what a number input can actually produce", () => {
    // An emptied box yields NaN, and a spinner can go negative.
    expect(clampAge("children", Number.NaN)).toBe(AGE_BANDS.children.fallback);
    expect(clampAge("infants", -5)).toBe(0);
    expect(clampAge("children", 7.8)).toBe(7);
  });

  it("seeds a new traveller at a plausible age, not zero", () => {
    // Adding a third child used to append a 0-year-old — an infant, silently
    // filed as a child, on a row nobody had reason to look at again.
    expect(resizeAges([5, 9], 3, AGE_BANDS.children.fallback)).toEqual([5, 9, AGE_BANDS.children.fallback]);
    expect(AGE_BANDS.children.fallback).toBeGreaterThanOrEqual(AGE_BANDS.children.min);
    expect(AGE_BANDS.infants.fallback).toBeLessThanOrEqual(AGE_BANDS.infants.max);
  });
});
