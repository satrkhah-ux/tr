import { describe, expect, it } from "vitest";
import { addUsage, backgroundSpent, budgetAllows, DEFAULT_BUDGET, mergeUsage, modelClass, parseBudget } from "./ai-usage-core";

describe("the background AI budget", () => {
  it("tells the strong models from the cheap ones", () => {
    expect(modelClass("gpt-5.5")).toBe("strong");
    expect(modelClass("o3-mini")).toBe("strong");
    expect(modelClass("gpt-4o-mini")).toBe("cheap");
  });
  it("counts only the background features, per class", () => {
    let day = addUsage({}, "murad_knowledge", "gpt-5.5", { input: 24_000, output: 9_000 });
    day = addUsage(day, "murad_lessons", "gpt-4o-mini", { input: 3_000, output: 300 });
    day = addUsage(day, "passport_page", "gpt-5.5", { input: 900_000, output: 10 });
    expect(backgroundSpent(day, "strong")).toBe(33_000);
    expect(backgroundSpent(day, "cheap")).toBe(3_300);
  });
  it("pauses a background call once its class is spent, and never a foreground one", () => {
    const day = addUsage({}, "murad_knowledge", "gpt-5.5", { input: DEFAULT_BUDGET.strong, output: 0 });
    expect(budgetAllows(day, "murad_knowledge", "gpt-5.5")).toBe(false);
    expect(budgetAllows(day, "followup_summary", "gpt-5.5")).toBe(false);
    expect(budgetAllows(day, "murad_lessons", "gpt-4o-mini")).toBe(true);
    expect(budgetAllows(day, "murad_reply", "gpt-5.5")).toBe(true);
    expect(budgetAllows(day, "paper", "gpt-5.5")).toBe(true);
  });
  it("adds two counters and reads a stored budget, the default when it is broken", () => {
    const a = addUsage({}, "murad_knowledge", "gpt-5.5", { input: 1, output: 2 });
    expect(mergeUsage(a, a)["murad_knowledge|gpt-5.5"]).toEqual({ calls: 2, input: 2, output: 4 });
    expect(parseBudget('{"strong":500000}')).toEqual({ strong: 500_000, cheap: DEFAULT_BUDGET.cheap });
    expect(parseBudget("not json")).toEqual(DEFAULT_BUDGET);
  });
});
