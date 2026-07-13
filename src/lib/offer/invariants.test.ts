import { describe, it, expect } from "vitest";
import { validateInvariants, daysBetween, type InvariantInput } from "./invariants";

const base: InvariantInput = {
  trip_nights: 5,
  cities: [
    { city_name: "كوالالمبور", nights: 3, check_in: "2026-06-01", check_out: "2026-06-04" },
    { city_name: "لنكاوي", nights: 2, check_in: "2026-06-04", check_out: "2026-06-06" },
  ],
  hotels: [
    { hotel_name: "H1", room_type_id: "rt-1", board_type: "BB", nights: 3, check_in: "2026-06-01", check_out: "2026-06-04" },
    { hotel_name: "H2", room_type_id: "rt-2", board_type: "HB", nights: 2, check_in: "2026-06-04", check_out: "2026-06-06" },
  ],
};

describe("daysBetween", () => {
  it("counts whole calendar nights", () => {
    expect(daysBetween("2026-06-01", "2026-06-04")).toBe(3);
    expect(daysBetween("2026-06-04", "2026-06-04")).toBe(0);
  });
  it("returns null for unparseable input", () => {
    expect(daysBetween("nope", "2026-06-04")).toBeNull();
  });
});

describe("validateInvariants", () => {
  it("passes a fully consistent offer", () => {
    const result = validateInvariants(base);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("catches a nights-sum mismatch", () => {
    const result = validateInvariants({ ...base, trip_nights: 7 });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("nights_sum_mismatch");
    // carries the two numbers as subjects for the UI
    const v = result.violations.find((x) => x.code === "nights_sum_mismatch");
    expect(v?.subjects).toEqual(["5", "7"]);
  });

  it("catches a per-city date/nights mismatch", () => {
    const result = validateInvariants({
      ...base,
      trip_nights: 4,
      cities: [
        // 3 calendar nights but nights=2 → mismatch; also breaks the sum
        { city_name: "كوالالمبور", nights: 2, check_in: "2026-06-01", check_out: "2026-06-04" },
        { city_name: "لنكاوي", nights: 2, check_in: "2026-06-04", check_out: "2026-06-06" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("city_date_mismatch");
  });

  it("catches a per-hotel date/nights mismatch", () => {
    const result = validateInvariants({
      ...base,
      hotels: [
        { hotel_name: "H1", room_type_id: "rt-1", board_type: "BB", nights: 9, check_in: "2026-06-01", check_out: "2026-06-04" },
      ],
    });
    expect(result.violations.map((v) => v.code)).toContain("hotel_date_mismatch");
  });

  it("catches a hotel missing room type or board type", () => {
    const result = validateInvariants({
      ...base,
      hotels: [
        { hotel_name: "H1", room_type_id: null, board_type: "BB", nights: 3, check_in: "2026-06-01", check_out: "2026-06-04" },
        { hotel_name: "H2", room_type_id: "rt-2", board_type: null, nights: 2, check_in: "2026-06-04", check_out: "2026-06-06" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain("hotel_missing_room_or_board");
  });
});
