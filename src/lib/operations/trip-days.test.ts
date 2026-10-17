import { describe, expect, it } from "vitest";
import { dayStates } from "./trip-days";

const days = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"];

describe("the programme's open days on the trip page", () => {
  it("on day two: day one folds, today and tomorrow open, the rest folded", () => {
    expect(dayStates(days, "2026-11-01")).toEqual(["past", "today", "next", "later"]);
  });

  it("before the trip: the first two days open", () => {
    expect(dayStates(days, "2026-10-20")).toEqual(["next", "next", "later", "later"]);
  });

  it("after the trip: everything folded", () => {
    expect(dayStates(days, "2026-11-10")).toEqual(["past", "past", "past", "past"]);
  });

  it("on the last day there is no tomorrow to open", () => {
    expect(dayStates(days, "2026-11-03")).toEqual(["past", "past", "past", "today"]);
  });

  it("an undated programme opens its first two days", () => {
    expect(dayStates([null, null, null], "2026-11-01")).toEqual(["next", "next", "later"]);
  });
});
