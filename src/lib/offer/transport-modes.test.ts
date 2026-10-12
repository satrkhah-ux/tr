import { describe, expect, it } from "vitest";
import { deriveTransportRows, emptyTransportPlan, hopMode, normalizeDraftData, type TransportPlan } from "./draft-types";

/** Malaysia: a road hop, a flown hop, a train hop — one programme, three modes. */
function plan(): TransportPlan {
  const p = emptyTransportPlan();
  return {
    ...p,
    intercity: {
      ...p.intercity,
      enabled: true,
      car_type: "فان",
      mode: "car",
      modes: ["car", "flight", "train"],
      hop_modes: { "كوالالمبور>لنكاوي": "flight", "لنكاوي>بينانج": "train" },
    },
  };
}
const cities = ["سيلانجور", "كوالالمبور", "لنكاوي", "بينانج"].map((city_name, i) => ({ city_name, check_in: `2026-11-1${i}` }));

describe("intercity — several modes, one per hop", () => {
  it("prints each hop by its own mode, and the vehicle only for the road", () => {
    const rows = deriveTransportRows(plan(), cities).filter((r) => r.from_place !== "المطار" && r.to_place !== "المطار" && r.from_place !== "الجولات السياحية");
    expect(rows.map((r) => [r.from_place, r.to_place, r.car_type])).toEqual([
      ["سيلانجور", "كوالالمبور", "فان"],
      ["لنكاوي", "بينانج", "قطار"],
    ]);
  });

  it("turns a hop by air into the transfers either side of the flight", () => {
    const rows = deriveTransportRows(plan(), cities).map((r) => `${r.from_place} ← ${r.to_place}`);
    expect(rows).toEqual(expect.arrayContaining(["فندق كوالالمبور ← المطار", "المطار ← فندق لنكاوي"]));
    expect(rows).not.toContain("كوالالمبور ← لنكاوي");
  });

  it("falls back to the first mode when a hop's pick is no longer chosen", () => {
    const p = plan();
    p.intercity.modes = ["car"];
    expect(hopMode(p, "كوالالمبور", "لنكاوي")).toBe("car");
  });

  it("reads an older draft's single mode as a one-mode list", () => {
    const old = normalizeDraftData({ transport_plan: { intercity: { enabled: true, mode: "train", car_type: "", cars: 1, note: "" } } });
    expect(old.transport_plan.intercity.modes).toEqual(["train"]);
    expect(old.transport_plan.intercity.mode).toBe("train");
  });
});
