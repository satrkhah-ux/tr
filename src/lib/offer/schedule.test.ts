import { describe, it, expect } from "vitest";
import {
  autoDepartureDate,
  flightTiming,
  formatDurationAr,
  itineraryEndDate,
  itineraryStartDate,
  nightsStatus,
  syncDepartureDates,
  toInstant,
  withDatePart,
  type ScheduleFlight,
} from "./schedule";

const RIYADH = "Asia/Riyadh"; // UTC+3, no DST
const KL = "Asia/Kuala_Lumpur"; // UTC+8, no DST
const PARIS = "Europe/Paris"; // UTC+2 in June (CEST)

function leg(over: Partial<ScheduleFlight>): ScheduleFlight {
  return { leg_order: "outbound", departure_at: null, arrival_at: null, from_tz: null, to_tz: null, ...over };
}

describe("toInstant (tz-correct)", () => {
  it("resolves a local wall clock in its IANA zone to a real UTC instant", () => {
    // 02:00 in Riyadh (UTC+3) == 23:00 the previous day UTC
    expect(toInstant("2026-06-10T02:00", RIYADH)?.toISOString()).toBe("2026-06-09T23:00:00.000Z");
    // 15:30 in Kuala Lumpur (UTC+8) == 07:30 UTC
    expect(toInstant("2026-06-10T15:30", KL)?.toISOString()).toBe("2026-06-10T07:30:00.000Z");
  });
  it("returns null without a timezone (never guesses server/browser tz)", () => {
    expect(toInstant("2026-06-10T02:00", null)).toBeNull();
  });
});

describe("flightTiming", () => {
  it("SAME-DAY arrival: GCC→Asia (destination ahead), tz-correct duration", () => {
    const t = flightTiming(leg({ from_tz: RIYADH, to_tz: KL, departure_at: "2026-06-10T02:00", arrival_at: "2026-06-10T15:30" }));
    expect(t.durationMinutes).toBe(510); // 8h30 (23:00Z → 07:30Z), NOT the naive 13h30
    expect(t.dayOffset).toBe(0);
    expect(t.arrivalBeforeDeparture).toBe(false);
  });

  it("OVERNIGHT arrival: +1 day badge when the local arrival date is after departure", () => {
    const t = flightTiming(leg({ from_tz: RIYADH, to_tz: KL, departure_at: "2026-06-10T23:00", arrival_at: "2026-06-11T12:00" }));
    expect(t.dayOffset).toBe(1); // renders "+1 يوم"
    // 23:00 Riyadh = 20:00Z (10th); 12:00 KL = 04:00Z (11th) → 8h
    expect(t.durationMinutes).toBe(480);
  });

  it("GCC→Europe (destination BEHIND): uses tz, not naive clock difference", () => {
    // 08:00 Riyadh = 05:00Z; 13:00 Paris(CEST/UTC+2) = 11:00Z → 6h. Naive clock diff would be 5h (wrong).
    const t = flightTiming(leg({ from_tz: RIYADH, to_tz: PARIS, departure_at: "2026-06-10T08:00", arrival_at: "2026-06-10T13:00" }));
    expect(t.durationMinutes).toBe(360);
    expect(t.dayOffset).toBe(0);
  });

  it("flags an impossible flight (arrival before departure)", () => {
    const t = flightTiming(leg({ from_tz: RIYADH, to_tz: RIYADH, departure_at: "2026-06-10T10:00", arrival_at: "2026-06-10T08:00" }));
    expect(t.arrivalBeforeDeparture).toBe(true);
    expect((t.durationMinutes ?? 0) < 0).toBe(true);
  });

  it("returns null duration (not a naive one) when a tz is missing", () => {
    const t = flightTiming(leg({ from_tz: null, to_tz: KL, departure_at: "2026-06-10T02:00", arrival_at: "2026-06-10T15:30" }));
    expect(t.durationMinutes).toBeNull();
  });
});

// The impossible-flight check reads both clocks on ONE clock, each in its own airport's zone (the owner,
// 2026-10-26). Real pairs, never a naive clock difference.
describe("flightTiming on each airport's own zone", () => {
  const MED = "Asia/Riyadh"; // UTC+3
  const CGK = "Asia/Jakarta"; // UTC+7
  const LHR = "Europe/London"; // BST (UTC+1) until 2026-10-25 01:00Z, then GMT
  const AKL = "Pacific/Auckland"; // NZST UTC+12 in June
  const HNL = "Pacific/Honolulu"; // UTC−10, no DST
  const timing = (from_tz: string | null, departure_at: string, to_tz: string | null, arrival_at: string) =>
    flightTiming(leg({ from_tz, to_tz, departure_at, arrival_at }));

  it("flags MED → CGK 04:50 → 08:20: it lands (01:20Z) before it leaves (01:50Z)", () => {
    const t = timing(MED, "2026-10-31T04:50", CGK, "2026-10-31T08:20");
    expect(t.durationMinutes).toBe(-30);
    expect(t.arrivalBeforeDeparture).toBe(true);
  });

  it("passes a real MED → CGK: 23:00 → 12:30 the next day is 9h30", () => {
    const t = timing(MED, "2026-10-30T23:00", CGK, "2026-10-31T12:30");
    expect(t.durationMinutes).toBe(570);
    expect(t.arrivalBeforeDeparture).toBe(false);
  });

  it("passes an east → west flight: CGK → MED 12:00 → 18:15 is 10h15, not 6h15", () => {
    const t = timing(CGK, "2026-11-10T12:00", MED, "2026-11-10T18:15");
    expect(t.durationMinutes).toBe(615);
    expect(t.arrivalBeforeDeparture).toBe(false);
  });

  it("passes a flight that lands EARLIER on the clock the same day: Auckland 18:00 → Honolulu 07:00 is 11h", () => {
    const t = timing(AKL, "2026-06-10T18:00", HNL, "2026-06-10T07:00");
    expect(t.durationMinutes).toBe(660);
    expect(t.arrivalBeforeDeparture).toBe(false);
  });

  it("follows daylight saving: London is BST before 25 Oct 2026 and GMT after", () => {
    // 22:00 Riyadh on the 23rd = 19:00Z; 02:30 BST on the 24th = 01:30Z → 6h30
    expect(timing(MED, "2026-10-23T22:00", LHR, "2026-10-24T02:30").durationMinutes).toBe(390);
    // the clocks went back at 02:00 BST on the 25th: 22:00 Riyadh on the 24th = 19:00Z; 02:30 GMT on the 25th = 02:30Z → 7h30
    expect(timing(MED, "2026-10-24T22:00", LHR, "2026-10-25T02:30").durationMinutes).toBe(450);
    // 05:00 Riyadh = 02:00Z; 02:30 London that morning is GMT (02:30Z) — after the take-off (read as BST it would be 01:30Z, before it)
    expect(timing(MED, "2026-10-25T05:00", LHR, "2026-10-25T02:30").arrivalBeforeDeparture).toBe(false);
    expect(timing(MED, "2026-10-25T05:00", LHR, "2026-10-25T03:30").durationMinutes).toBe(90);
    expect(timing(LHR, "2026-10-25T03:00", MED, "2026-10-25T05:30").durationMinutes).toBe(-30);
  });

  it("never judges a leg whose zone is missing or unknown", () => {
    expect(timing(null, "2026-10-31T04:50", CGK, "2026-10-31T01:00").arrivalBeforeDeparture).toBe(false);
    expect(timing(MED, "2026-10-31T04:50", null, "2026-10-31T01:00").arrivalBeforeDeparture).toBe(false);
    expect(timing(MED, "2026-10-31T04:50", "Not/AZone", "2026-10-31T01:00")).toMatchObject({ durationMinutes: null, arrivalBeforeDeparture: false });
    expect(timing(MED, "2026-10-31T04:50", "", "2026-10-31T01:00").arrivalBeforeDeparture).toBe(false);
  });
});

describe("formatDurationAr", () => {
  it("formats hours + minutes in Arabic", () => {
    expect(formatDurationAr(510)).toBe("8 س 30 د");
    expect(formatDurationAr(null)).toBeNull();
  });
});

describe("auto-fill + user-set", () => {
  const trip = { arrival_date: "2026-06-10", departure_date: "2026-06-20" };

  it("outbound departure auto-fills to trip start; inbound to trip end", () => {
    expect(autoDepartureDate(trip, "outbound")).toBe("2026-06-10");
    expect(autoDepartureDate(trip, "inbound")).toBe("2026-06-20");
    expect(autoDepartureDate(trip, "internal")).toBeNull();
  });

  it("syncDepartureDates fills the DATE and keeps the TIME", () => {
    const flights = [leg({ leg_order: "outbound", departure_at: "2000-01-01T02:00" }), leg({ leg_order: "inbound", departure_at: null })];
    const synced = syncDepartureDates(trip, flights);
    expect(synced[0].departure_at).toBe("2026-06-10T02:00"); // date moved, 02:00 kept
    expect(synced[1].departure_at).toBe("2026-06-20T00:00");
  });

  it("moves the landing with the take-off, keeping the flight's length (the evaluator, 2026-10-22)", () => {
    const [back] = syncDepartureDates(trip, [leg({ leg_order: "inbound", departure_at: "2026-06-18T23:00", arrival_at: "2026-06-19T03:00" })]);
    expect([back.departure_at, back.arrival_at]).toEqual(["2026-06-20T23:00", "2026-06-21T03:00"]);
  });

  it("a MANUAL edit is never auto-overwritten (date_user_set)", () => {
    const flights = [leg({ leg_order: "outbound", departure_at: "2026-06-09T23:45", date_user_set: true })];
    const synced = syncDepartureDates(trip, flights);
    expect(synced[0].departure_at).toBe("2026-06-09T23:45"); // untouched
    // clearing the flag restores auto-sync (the "استعادة التلقائي" action)
    const restored = syncDepartureDates(trip, [{ ...flights[0], date_user_set: false }]);
    expect(restored[0].departure_at).toBe("2026-06-10T23:45");
  });

  it("withDatePart keeps time and no-ops on a null date", () => {
    expect(withDatePart("2026-06-10T14:00", "2026-07-01")).toBe("2026-07-01T14:00");
    expect(withDatePart(null, "2026-07-01")).toBe("2026-07-01T00:00");
    expect(withDatePart("2026-06-10T14:00", null)).toBe("2026-06-10T14:00");
  });
});

describe("itinerary derivation (hotel dates follow the flights)", () => {
  const trip = { arrival_date: "2026-06-10", departure_date: "2026-06-20" };

  it("first check-in = LOCAL arrival date of the outbound flight (after-midnight landing)", () => {
    const flights = [leg({ leg_order: "outbound", arrival_at: "2026-06-11T00:40" })]; // lands after midnight
    expect(itineraryStartDate(trip, flights)).toBe("2026-06-11"); // NOT the trip start 06-10
  });

  it("falls back to the trip start when there is no outbound flight", () => {
    expect(itineraryStartDate(trip, [])).toBe("2026-06-10");
  });

  it("last check-out = LOCAL departure date of the inbound flight", () => {
    const flights = [leg({ leg_order: "inbound", departure_at: "2026-06-20T06:00" })];
    expect(itineraryEndDate(trip, flights)).toBe("2026-06-20");
  });
});

describe("nightsStatus (blocks publishing on mismatch)", () => {
  it("complete / remaining / excess", () => {
    expect(nightsStatus(5, 5)).toEqual({ status: "complete", diff: 0 });
    expect(nightsStatus(3, 5)).toEqual({ status: "remaining", diff: 2 });
    expect(nightsStatus(6, 5)).toEqual({ status: "excess", diff: 1 });
  });
});
