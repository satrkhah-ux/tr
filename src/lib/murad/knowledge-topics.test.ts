import { describe, expect, it } from "vitest";
import { foldDue } from "./knowledge-topics";

const H = 3600_000;
const now = Date.parse("2026-10-26T12:00:00Z");
const was = (hoursAgo: number, lessons = 1000) => ({ at: new Date(now - hoursAgo * H).toISOString(), lessons });

describe("foldDue — the strong model re-reads a subject rarely, not every minute", () => {
  it("folds a subject never folded before, but not one with no lessons", () => {
    expect(foldDue(5, undefined, now)).toBe(true);
    expect(foldDue(0, undefined, now)).toBe(false);
  });
  it("waits three hours even when the sweep has added a thousand lessons", () => {
    expect(foldDue(2000, was(1), now)).toBe(false);
    expect(foldDue(2000, was(2.9), now)).toBe(false);
  });
  it("then folds when 300 new lessons have come, not before", () => {
    expect(foldDue(1250, was(4), now)).toBe(false);
    expect(foldDue(1300, was(4), now)).toBe(true);
  });
  it("refreshes a reference twelve hours old whatever came", () => {
    expect(foldDue(1001, was(12.5), now)).toBe(true);
    expect(foldDue(1001, was(11), now)).toBe(false);
  });
});
