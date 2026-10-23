import { describe, expect, it } from "vitest";
import { byLastProgress, lastProgress } from "./last-progress";

describe("«آخر إنجاز»", () => {
  it("the newest moment, whatever its offset; nothing for no moments", () => {
    expect(lastProgress("2026-10-20T10:00:00Z", null, "2026-10-22T08:00:00+03:00", undefined, "2026-10-21T23:00:00Z")).toBe("2026-10-22T08:00:00+03:00");
    expect(lastProgress(null, undefined, "")).toBeNull();
  });

  it("orders cards newest first, a case with nothing done last", () => {
    const rows = [{ id: "a", last_progress_at: "2026-10-20T10:00:00Z" }, { id: "b", last_progress_at: null }, { id: "c", last_progress_at: "2026-10-23T09:00:00Z" }];
    expect(rows.sort(byLastProgress).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
