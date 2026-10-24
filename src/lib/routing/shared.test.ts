import { describe, expect, it } from "vitest";
import { DEFAULT_SHARED, isOrphan, parseShared, pickSeller, type Seller } from "./shared";

const NOW = 1_800_000_000;
const s = DEFAULT_SHARED;

describe("«لا طلب بلا صاحب» — who is waiting on nobody", () => {
  it("a client waiting 5 minutes on the shared login, or in its team with no agent", () => {
    expect(isOrphan({ assigneeId: 68, teamId: 28, waitingSince: NOW - 300 }, s, NOW)).toBe(true);
    expect(isOrphan({ assigneeId: null, teamId: 28, waitingSince: NOW - 3600 }, s, NOW)).toBe(true);
  });

  it("not a real seller's client, not reception's queue, not before the minutes, not when we spoke last", () => {
    expect(isOrphan({ assigneeId: 9, teamId: 28, waitingSince: NOW - 3600 }, s, NOW)).toBe(false);
    expect(isOrphan({ assigneeId: null, teamId: 25, waitingSince: NOW - 3600 }, s, NOW)).toBe(false);
    expect(isOrphan({ assigneeId: 68, teamId: 28, waitingSince: NOW - 120 }, s, NOW)).toBe(false);
    expect(isOrphan({ assigneeId: 68, teamId: 28, waitingSince: 0 }, s, NOW)).toBe(false);
  });
});

describe("who takes it", () => {
  const sellers: Seller[] = [
    { id: 71, name: "احمد القدسي", online: true },
    { id: 8, name: "عبد الله علي", online: true },
    { id: 15, name: "محمد الحبيب", online: false },
  ];

  it("online first, then the fewest waiting, then the fewest open", () => {
    const load = new Map([
      [71, { waiting: 2, open: 148 }],
      [8, { waiting: 2, open: 14 }],
      [15, { waiting: 0, open: 1 }],
    ]);
    expect(pickSeller(sellers, load)?.id).toBe(8);
    load.set(8, { waiting: 5, open: 14 });
    expect(pickSeller(sellers, load)?.id).toBe(71);
  });

  it("nobody online: the whole team, by the same order; nobody at all: none", () => {
    const offline = sellers.map((x) => ({ ...x, online: false }));
    expect(pickSeller(offline, new Map([[71, { waiting: 3, open: 9 }]]))?.id).toBe(8);
    expect(pickSeller([], new Map())).toBeNull();
  });
});

it("the switch: off stops it, dry only reports, an object overrides, nonsense keeps the defaults", () => {
  expect(parseShared("off")).toBeNull();
  expect(parseShared("dry")?.mode).toBe("dry");
  expect(parseShared(null)).toEqual(DEFAULT_SHARED);
  expect(parseShared('{"agents":[68,99],"minutes":10}')).toMatchObject({ mode: "on", agents: [68, 99], teams: [28], minutes: 10 });
  expect(parseShared("{broken")).toEqual(DEFAULT_SHARED);
});
