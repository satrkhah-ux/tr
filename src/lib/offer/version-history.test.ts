import { describe, expect, it } from "vitest";
import { versionHistory } from "./version-history";

const doc = (hotel: string, total: number) => ({ hotels: [{ hotel_name: hotel, city_name: "باتومي" }], total, currency: "SAR", arrival_date: "2026-11-10", departure_date: "2026-11-14", flights: [], adults: 2, children: 0, infants: 0 });

describe("«سجل النسخ»", () => {
  it("first issue, an update, then a restore of v1 — newest first, each with what it changed", () => {
    const h = versionHistory(
      [
        { version: 1, rendered_at: "2026-10-16T08:00:00Z", snapshot_json: doc("فندق أ", 3000) },
        { version: 2, rendered_at: "2026-10-16T09:00:00Z", snapshot_json: doc("فندق ب", 3600) },
        { version: 3, rendered_at: "2026-10-16T10:00:00Z", snapshot_json: doc("فندق أ", 3000) },
      ],
      [1, 2, 3],
      [
        { action: "offer.reissued", actor_email: "sara@x.com", meta: { version: 2 } },
        { action: "offer.reissued", actor_email: "ali@x.com", meta: { version: 3 } },
        { action: "offer.version_restored", actor_email: "ali@x.com", meta: { version: 3, restored_from: 1 } },
      ],
    );
    expect(h.map((v) => [v.version, v.kind, v.restored_from, v.by, v.current])).toEqual([
      [3, "restored", 1, "ali", true],
      [2, "reissued", null, "sara", false],
      [1, "issued", null, null, false],
    ]);
    expect(h[1].changes.map((c) => c.kind)).toEqual(expect.arrayContaining(["hotel", "price"]));
    expect(h[0].changes.map((c) => [c.before, c.after])).toEqual(expect.arrayContaining([["فندق ب", "فندق أ"]]));
    expect(h.every((v) => v.restorable)).toBe(true);
  });

  it("a plain re-publish (no frozen draft) restores from the issue before it; an offer from before drafts were kept cannot", () => {
    const h = versionHistory(
      [
        { version: 1, rendered_at: "a", snapshot_json: doc("أ", 1) },
        { version: 2, rendered_at: "b", snapshot_json: doc("أ", 1) },
      ],
      [1],
      [],
    );
    expect(h.map((v) => [v.version, v.kind, v.restorable])).toEqual([
      [2, "republished", true],
      [1, "issued", true],
    ]);
    expect(versionHistory([{ version: 1, rendered_at: "a", snapshot_json: doc("أ", 1) }], [], [])[0].restorable).toBe(false);
  });
});
