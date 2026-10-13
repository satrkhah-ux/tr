import { describe, expect, it } from "vitest";
import { ageOn, isLatinName, planTravelers, travelerReadiness } from "./travelers";

const MALAYSIA = { travel_start: "2026-11-01", travel_end: "2026-11-08" };
const TODAY = "2026-10-13";

describe("planTravelers", () => {
  it("makes the Malaysia case: two adults, children of 9 and 5, the client first", () => {
    const rows = planTravelers({
      adults: 2,
      children: 2,
      infants: 0,
      children_ages: [9, 5],
      infant_ages: [],
      lead_name: " ترافليون التقني ",
      visa_required: false,
    });
    expect(rows.map((r) => [r.traveler_kind, r.age, r.display_name, r.sort])).toEqual([
      ["adult", null, "ترافليون التقني", 0],
      ["adult", null, "", 1],
      ["child", 9, "", 2],
      ["child", 5, "", 3],
    ]);
    expect(rows.every((r) => r.visa_status === "not_required")).toBe(true);
  });

  it("marks everyone's visa required when the offer sold visas, and never plans nobody", () => {
    const rows = planTravelers({ adults: 0, children: 0, infants: 1, children_ages: [], infant_ages: [1], lead_name: "", visa_required: true });
    expect(rows.map((r) => r.traveler_kind)).toEqual(["adult", "infant"]);
    expect(rows.every((r) => r.visa_status === "required")).toBe(true);
  });
});

describe("ageOn", () => {
  it("counts whole years, turning on the birthday itself", () => {
    expect(ageOn("2017-11-01", "2026-10-31")).toBe(8);
    expect(ageOn("2017-11-01", "2026-11-01")).toBe(9);
    expect(ageOn(null, "2026-11-01")).toBeNull();
  });
});

describe("travelerReadiness", () => {
  const ready = {
    has_passport: true,
    passport_expiry: "2029-01-01",
    visa_status: "not_required" as const,
    birth_date: "1985-03-01",
    age: null,
    traveler_kind: "adult" as const,
  };

  it("is empty for a traveler with everything in order", () => {
    expect(travelerReadiness(ready, MALAYSIA, TODAY)).toEqual([]);
  });

  it("asks for the passport, then for its expiry", () => {
    expect(travelerReadiness({ ...ready, has_passport: false, passport_expiry: null }, MALAYSIA, TODAY)).toEqual(["passport"]);
    expect(travelerReadiness({ ...ready, passport_expiry: null }, MALAYSIA, TODAY)).toEqual(["passport_expiry"]);
  });

  it("wants six months after the RETURN, not after today", () => {
    // fine six months from today, short six months from the 8 Nov return
    expect(travelerReadiness({ ...ready, passport_expiry: "2027-04-20" }, MALAYSIA, TODAY)).toEqual(["passport_short"]);
    expect(travelerReadiness({ ...ready, passport_expiry: "2027-06-01" }, MALAYSIA, TODAY)).toEqual([]);
  });

  it("holds a visa that is required or submitted, passes one issued or not needed", () => {
    expect(travelerReadiness({ ...ready, visa_status: "required" }, MALAYSIA, TODAY)).toEqual(["visa"]);
    expect(travelerReadiness({ ...ready, visa_status: "submitted" }, MALAYSIA, TODAY)).toEqual(["visa"]);
    expect(travelerReadiness({ ...ready, visa_status: "issued" }, MALAYSIA, TODAY)).toEqual([]);
  });

  it("flags a child whose birth date disagrees with the age sold, on the travel day", () => {
    const child = { ...ready, traveler_kind: "child" as const, age: 9 };
    expect(travelerReadiness({ ...child, birth_date: "2017-06-10" }, MALAYSIA, TODAY)).toEqual([]);
    expect(travelerReadiness({ ...child, birth_date: "2015-06-10" }, MALAYSIA, TODAY)).toEqual(["age_mismatch"]);
    // turns 12 before departure: no longer a child at all
    expect(travelerReadiness({ ...child, age: null, birth_date: "2014-10-20" }, MALAYSIA, TODAY)).toEqual(["age_mismatch"]);
    // no birth date yet: nothing to compare, not a mismatch
    expect(travelerReadiness({ ...child, birth_date: null }, MALAYSIA, TODAY)).toEqual([]);
  });
});

describe("isLatinName", () => {
  it("accepts a passport-style name and refuses Arabic or digits", () => {
    expect(isLatinName("AHMED ALI")).toBe(true);
    expect(isLatinName("Mary-Jane O'Neil")).toBe(true);
    expect(isLatinName("ترافليون التقني")).toBe(false);
    expect(isLatinName("0553300417")).toBe(false);
    expect(isLatinName("")).toBe(false);
  });
});
