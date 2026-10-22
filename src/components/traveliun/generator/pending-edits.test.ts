import { describe, expect, it } from "vitest";
import { PENDING_MAX_AGE, pendingToReplay } from "./pending-edits";

const saved = "2026-10-22T12:00:00.000Z";
const t = Date.parse(saved);
const slice = { trip: { country: "تركيا" } } as never;
const entry = (e: object) => JSON.stringify({ slice, ...e });

describe("pendingToReplay", () => {
  it("replays edits built on the save the server still has, whatever this PC's clock says", () => {
    // typed 2 s after the last save on a PC 5 s slow: stamped before it
    expect(pendingToReplay(entry({ at: t - 3_000, base: saved }), "2026-10-22T12:00:00+00:00", t)).toEqual(slice);
  });

  it("drops them when someone saved the draft after the save they build on, before they were typed", () => {
    expect(pendingToReplay(entry({ at: t - 60_000, base: "2026-10-22T11:58:00.000Z" }), saved, t)).toBeNull();
  });

  it("keeps the old rule for an entry without a base: typed after the last save", () => {
    expect(pendingToReplay(entry({ at: t + 1_000 }), saved, t + 2_000)).toEqual(slice);
    expect(pendingToReplay(entry({ at: t - 1_000 }), saved, t)).toBeNull();
  });

  it("never replays nothing, garbage, or edits older than twelve hours", () => {
    expect(pendingToReplay(null, saved, t)).toBeNull();
    expect(pendingToReplay("{not json", saved, t)).toBeNull();
    expect(pendingToReplay(JSON.stringify({ at: t, base: saved, slice: {} }), saved, t)).toBeNull();
    expect(pendingToReplay(entry({ at: t, base: saved }), saved, t + PENDING_MAX_AGE)).toBeNull();
  });
});
