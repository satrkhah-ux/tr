import { describe, expect, it } from "vitest";
import { dedupeRoutes, parseFlightNumber, toWallClock, type FlightLookupHit } from "./flight-lookup";

function hit(over: Partial<FlightLookupHit>): FlightLookupHit {
  return {
    airline: "Saudia",
    flight_iata: "SV820",
    from_iata: "JED",
    from_airport: "King Abdulaziz International",
    from_tz: "Asia/Riyadh",
    to_iata: "KUL",
    to_airport: "Kuala Lumpur International",
    to_tz: "Asia/Kuala_Lumpur",
    departure_at: "2026-07-20T02:00",
    arrival_at: "2026-07-20T15:30",
    schedule_date: "2026-07-20",
    terminal: "1",
    ...over,
  };
}

describe("parseFlightNumber", () => {
  it("accepts the shapes agents actually type", () => {
    for (const input of ["SV820", "sv820", "SV 820", "sv-820", " SV/820 "]) {
      expect(parseFlightNumber(input)).toEqual({ carrier: "SV", number: "820", code: "SV820", kind: "iata" });
    }
  });

  it("splits on the DESIGNATOR, not greedily — SV820 is SV+820, never SV8+20", () => {
    expect(parseFlightNumber("SV820")?.carrier).toBe("SV");
    expect(parseFlightNumber("XY1234")).toEqual({ carrier: "XY", number: "1234", code: "XY1234", kind: "iata" });
    // a designator may contain a digit (Wizz Air is W6)
    expect(parseFlightNumber("W64501")).toEqual({ carrier: "W6", number: "4501", code: "W64501", kind: "iata" });
  });

  it("reads a 3-letter ICAO designator as ICAO", () => {
    expect(parseFlightNumber("SVA820")).toEqual({ carrier: "SVA", number: "820", code: "SVA820", kind: "icao" });
    expect(parseFlightNumber("UAE123")?.kind).toBe("icao");
  });

  it("rejects input with no airline letters — '1234' is not a flight", () => {
    expect(parseFlightNumber("1234")).toBeNull();
  });

  it("rejects junk instead of burning an API call on it", () => {
    for (const input of ["", "   ", "SV", "820", "SVABC", "SV82055"]) {
      expect(parseFlightNumber(input)).toBeNull();
    }
  });
});

describe("toWallClock", () => {
  it("drops the offset — the provider's local time is what we store", () => {
    expect(toWallClock("2026-07-20T02:00:00+03:00")).toBe("2026-07-20T02:00");
    expect(toWallClock("2026-07-20T15:30:00+00:00")).toBe("2026-07-20T15:30");
  });

  it("is null for missing or malformed stamps", () => {
    expect(toWallClock(null)).toBeNull();
    expect(toWallClock(undefined)).toBeNull();
    expect(toWallClock("not a date")).toBeNull();
  });
});

describe("dedupeRoutes", () => {
  it("collapses the same route flown on many days into one candidate", () => {
    const routes = dedupeRoutes([
      hit({ schedule_date: "2026-07-18" }),
      hit({ schedule_date: "2026-07-19" }),
      hit({ schedule_date: "2026-07-20" }),
    ]);
    expect(routes).toHaveLength(1);
    // the most recent observation wins — it reflects the current schedule
    expect(routes[0].schedule_date).toBe("2026-07-20");
  });

  it("keeps genuinely different routes flown under one number", () => {
    const routes = dedupeRoutes([
      hit({ from_iata: "JED", to_iata: "KUL" }),
      hit({ from_iata: "KUL", to_iata: "JED" }),
    ]);
    expect(routes).toHaveLength(2);
  });

  it("returns nothing for an empty feed", () => {
    expect(dedupeRoutes([])).toEqual([]);
  });
});
