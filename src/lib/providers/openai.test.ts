import { describe, expect, it } from "vitest";
import { reconcileDays, type GeneratedDay, type ItineraryPromptDay } from "./openai";

/**
 * The model writes prose; it does NOT get to decide the shape of the program.
 * reconcileDays is the gate that makes a hallucinated or malformed response
 * unable to corrupt the draft.
 */
function requested(...numbers: number[]): ItineraryPromptDay[] {
  return numbers.map((day_number) => ({ day_number, date: null, city_name: "كوالالمبور", marker: "full" }));
}

function gen(day_number: number, title: string, activities: string[] = ["نشاط"]): GeneratedDay {
  return { day_number, title, activities };
}

describe("reconcileDays", () => {
  it("keeps the days we asked for, in OUR order", () => {
    const out = reconcileDays(requested(1, 2, 3), [gen(3, "ثالث"), gen(1, "أول"), gen(2, "ثاني")]);
    expect(out.map((d) => d.day_number)).toEqual([1, 2, 3]);
    expect(out.map((d) => d.title)).toEqual(["أول", "ثاني", "ثالث"]);
  });

  it("DROPS days we never asked for — the model cannot append days to the trip", () => {
    const out = reconcileDays(requested(1, 2), [gen(1, "أول"), gen(2, "ثاني"), gen(9, "يوم مخترع")]);
    expect(out.map((d) => d.day_number)).toEqual([1, 2]);
  });

  it("skips a requested day the model did not answer for", () => {
    const out = reconcileDays(requested(1, 2, 3), [gen(2, "ثاني")]);
    expect(out.map((d) => d.day_number)).toEqual([2]);
  });

  it("drops a day with no usable content at all", () => {
    const out = reconcileDays(requested(1, 2), [gen(1, "   ", ["  ", ""]), gen(2, "ثاني")]);
    expect(out.map((d) => d.day_number)).toEqual([2]);
  });

  it("keeps a day that has activities but no title", () => {
    const out = reconcileDays(requested(1), [gen(1, "", ["زيارة المتحف"])]);
    expect(out).toEqual([{ day_number: 1, title: "", activities: ["زيارة المتحف"] }]);
  });

  it("trims whitespace and removes blank activity lines", () => {
    const out = reconcileDays(requested(1), [gen(1, "  وصول  ", ["  الاستقبال  ", "", "   ", "الفندق"])]);
    expect(out[0]).toEqual({ day_number: 1, title: "وصول", activities: ["الاستقبال", "الفندق"] });
  });

  it("caps a runaway activity list instead of printing 40 bullets", () => {
    const many = Array.from({ length: 40 }, (_, i) => `نشاط ${i}`);
    expect(reconcileDays(requested(1), [gen(1, "يوم", many)])[0].activities).toHaveLength(6);
  });

  it("survives a response whose fields are the wrong type", () => {
    const malformed = [
      { day_number: 1, title: 42, activities: "not an array" },
      { day_number: 2, title: "ثاني", activities: [1, "نشاط", null] },
    ] as unknown as GeneratedDay[];
    const out = reconcileDays(requested(1, 2), malformed);
    expect(out).toEqual([{ day_number: 2, title: "ثاني", activities: ["نشاط"] }]);
  });

  it("returns nothing when the model returns nothing", () => {
    expect(reconcileDays(requested(1, 2), [])).toEqual([]);
  });
});
