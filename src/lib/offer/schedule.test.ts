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
