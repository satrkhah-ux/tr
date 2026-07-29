import { describe, expect, it } from "vitest";
import {
  LONG_LAYOVER_MINUTES,
  MIN_CONNECTION_MINUTES,
  buildJourneys,
  formatWaitAr,
  layoverMinutes,
} from "./journey";
import type { ScheduleFlight } from "./schedule";

/**
 * The layover is the one number on this screen nobody can check by eye, because
 * the two clocks belong to different timezones. Every test here exists to prove
 * we do the zone maths rather than subtracting the printed times.
 */

function leg(over: Partial<ScheduleFlight> = {}): ScheduleFlight {
  return {
    leg_order: "outbound",
    departure_at: null,
    arrival_at: null,
    from_tz: null,
    to_tz: null,
    ...over,
  };
}

describe("layoverMinutes", () => {
  it("does the timezone maths instead of subtracting wall clocks", () => {
    // lands 14:00 in Istanbul (UTC+3), leaves 15:00 the same clock in Istanbul
    const a = leg({ arrival_at: "2026-08-01T14:00", to_tz: "Europe/Istanbul" });
    const b = leg({ departure_at: "2026-08-01T15:00", from_tz: "Europe/Istanbul" });
    expect(layoverMinutes(a, b)).toBe(60);
  });

  it("gets a cross-zone connection right where the clocks lie", () => {
    // lands 23:00 in Riyadh (UTC+3) = 20:00Z; leaves 22:00 in Istanbul (UTC+3)
    // the printed times suggest "minus one hour"; the truth is +59 minutes… no:
    // 23:00 Riyadh = 20:00Z, 22:00 Istanbul = 19:00Z → the next flight leaves
    // BEFORE the first lands, which is exactly the mistake we want surfaced.
    const a = leg({ arrival_at: "2026-08-01T23:00", to_tz: "Asia/Riyadh" });
    const b = leg({ departure_at: "2026-08-01T22:00", from_tz: "Europe/Istanbul" });
    expect(layoverMinutes(a, b)).toBe(-60);
  });

  it("spans midnight correctly", () => {
    const a = leg({ arrival_at: "2026-08-01T23:30", to_tz: "Europe/Istanbul" });
    const b = leg({ departure_at: "2026-08-02T02:00", from_tz: "Europe/Istanbul" });
    expect(layoverMinutes(a, b)).toBe(150);
  });

  it("returns null rather than a plausible wrong number when a zone is unknown", () => {
    const a = leg({ arrival_at: "2026-08-01T14:00", to_tz: null });
    const b = leg({ departure_at: "2026-08-01T18:00", from_tz: "Europe/Istanbul" });
    expect(layoverMinutes(a, b)).toBeNull();
  });

  it("returns null when a time is missing", () => {
    expect(layoverMinutes(leg({ to_tz: "Asia/Riyadh" }), leg({ from_tz: "Asia/Riyadh" }))).toBeNull();
  });
});

describe("buildJourneys", () => {
  const RUH_IST = leg({
    leg_order: "outbound",
    departure_at: "2026-08-01T01:00",
    arrival_at: "2026-08-01T04:30",
    from_tz: "Asia/Riyadh",
    to_tz: "Europe/Istanbul",
  });
  const IST_GYD = leg({
    leg_order: "outbound",
    departure_at: "2026-08-01T09:00",
    arrival_at: "2026-08-01T12:30",
    from_tz: "Europe/Istanbul",
    to_tz: "Asia/Baku",
  });

  it("chains the outbound legs and marks it a transit", () => {
    const [outbound] = buildJourneys([RUH_IST, IST_GYD]);
    expect(outbound.isTransit).toBe(true);
    expect(outbound.legs.map((l) => l.segment)).toEqual([1, 2]);
  });

  it("has no layover on the first leg of a chain", () => {
    const [outbound] = buildJourneys([RUH_IST, IST_GYD]);
    expect(outbound.legs[0].layoverMinutes).toBeNull();
  });

  it("computes the wait at the transit airport", () => {
    const [outbound] = buildJourneys([RUH_IST, IST_GYD]);
    // lands 04:30 Istanbul, leaves 09:00 Istanbul → 4h30
    expect(outbound.legs[1].layoverMinutes).toBe(270);
  });

  it("flags a connection too tight to make", () => {
    const tight = { ...IST_GYD, departure_at: "2026-08-01T05:00" };
    const [outbound] = buildJourneys([RUH_IST, tight]);
    expect(outbound.legs[1].layoverMinutes).toBe(30);
    expect(outbound.legs[1].layoverTooShort).toBe(true);
    expect(MIN_CONNECTION_MINUTES).toBe(60);
  });

  it("flags a wait long enough to really be an overnight", () => {
    const late = { ...IST_GYD, departure_at: "2026-08-01T19:00" };
    const [outbound] = buildJourneys([RUH_IST, late]);
    expect(outbound.legs[1].layoverMinutes).toBe(870);
    expect(outbound.legs[1].layoverLong).toBe(true);
    expect(LONG_LAYOVER_MINUTES).toBe(480);
  });

  it("treats an impossible connection as too short, not as a valid short one", () => {
    // the next flight leaves before this one lands
    const impossible = { ...IST_GYD, departure_at: "2026-08-01T03:00" };
    const [outbound] = buildJourneys([RUH_IST, impossible]);
    expect(outbound.legs[1].layoverMinutes).toBeLessThan(0);
    expect(outbound.legs[1].layoverTooShort).toBe(true);
  });

  it("adds legs AND waits into the gate-to-gate total", () => {
    const [outbound] = buildJourneys([RUH_IST, IST_GYD]);
    // 150 (leg 1) + 270 (wait) + 210 (leg 2)
    expect(outbound.totalMinutes).toBe(150 + 270 + 210);
  });

  it("refuses a partial total — a half-known sum reads as a real answer", () => {
    const noZone = { ...IST_GYD, from_tz: null };
    const [outbound] = buildJourneys([RUH_IST, noZone]);
    expect(outbound.totalMinutes).toBeNull();
  });

  it("keeps outbound, inbound and domestic in separate chains", () => {
    const back = leg({ leg_order: "inbound", departure_at: "2026-08-10T10:00", arrival_at: "2026-08-10T13:00" });
    const hop = leg({ leg_order: "internal", departure_at: "2026-08-05T08:00", arrival_at: "2026-08-05T09:00" });
    const journeys = buildJourneys([RUH_IST, back, IST_GYD, hop]);

    expect(journeys.map((j) => j.leg_order)).toEqual(["outbound", "inbound", "internal"]);
    expect(journeys[0].legs).toHaveLength(2);
    expect(journeys[1].isTransit).toBe(false);
  });

  it("returns nothing for no flights", () => {
    expect(buildJourneys([])).toEqual([]);
  });
});

describe("formatWaitAr", () => {
  it("reads as prose, not as a stat line", () => {
    expect(formatWaitAr(60)).toBe("ساعة واحدة");
    expect(formatWaitAr(120)).toBe("ساعتان");
    expect(formatWaitAr(180)).toBe("3 ساعات");
    expect(formatWaitAr(45)).toBe("45 دقيقة");
    expect(formatWaitAr(270)).toBe("4 س 30 د");
  });

  it("says nothing for an unknown or impossible wait", () => {
    expect(formatWaitAr(null)).toBeNull();
    expect(formatWaitAr(-30)).toBeNull();
  });
});
