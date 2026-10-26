import { describe, expect, it } from "vitest";
import { candidateSpots, FAB_SIZE, intersects, pickSpot, settleSpot } from "./fab-placement";

const view = { width: 1280, height: 800 };
const box = (left: number, top: number, w = 40, h = 40) => ({ left, top, right: left + w, bottom: top + h });

describe("مُراد's floating button stays off buttons, links and fields", () => {
  it("offers spots down the end edge, the bottom corner first (left edge in RTL, right in LTR)", () => {
    const rtl = candidateSpots(view, true);
    expect(rtl[0]).toEqual({ left: 8, top: 800 - 20 - FAB_SIZE });
    expect(rtl.every((s) => s.left === 8 && s.top >= 70)).toBe(true);
    expect(candidateSpots(view, false)[0].left).toBe(1280 - FAB_SIZE - 8);
    expect(rtl.length).toBeGreaterThan(8);
  });
  it("takes the corner when nothing is under it", () => {
    expect(pickSpot(candidateSpots(view, true), [box(600, 400)])).toEqual(candidateSpots(view, true)[0]);
  });
  it("moves up the edge past a button that sits in the corner", () => {
    const spots = candidateSpots(view, true);
    const corner = spots[0];
    const picked = pickSpot(spots, [box(corner.left + 10, corner.top + 10)]);
    expect(picked).not.toBeNull();
    expect(picked).not.toEqual(corner);
    expect(intersects({ left: picked!.left, top: picked!.top, right: picked!.left + FAB_SIZE, bottom: picked!.top + FAB_SIZE }, box(corner.left + 10, corner.top + 10), 6)).toBe(false);
  });
  it("keeps air around a field next to it", () => {
    const corner = candidateSpots(view, true)[0];
    // a field whose edge is 3px from the button counts as covered (the pad is 6px)
    expect(pickSpot([corner], [box(corner.left + FAB_SIZE + 3, corner.top, 200, 40)])).toBeNull();
    expect(pickSpot([corner], [box(corner.left + FAB_SIZE + 30, corner.top, 200, 40)])).toEqual(corner);
  });
  it("docks (null) when the whole edge is busy", () => {
    const wall = box(0, 0, 80, 800);
    expect(pickSpot(candidateSpots(view, true), [wall])).toBeNull();
  });
  it("does not jump: it stays where it is while that spot is still free", () => {
    const spots = candidateSpots(view, true);
    const here = spots[3];
    expect(settleSpot(here, spots, [box(600, 300)])).toEqual(here);
    expect(settleSpot(here, spots, [box(here.left, here.top)])).not.toEqual(here);
  });
});
