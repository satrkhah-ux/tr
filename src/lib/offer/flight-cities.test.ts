import { describe, expect, it } from "vitest";
import { deriveCityDates, emptyFlight, type DraftFlight } from "./draft-types";
import { citiesFromFlights, citiesMatchFlights, domesticMismatches } from "./flight-cities";

function leg(order: DraftFlight["leg_order"], from: string, to: string, dep: string, arr: string): DraftFlight {
  return { ...emptyFlight(order), from_city: from, to_city: to, departure_at: dep, arrival_at: arr };
}

// RUH → KUL overnight (dep 15, lands 16), KUL → LGK on the 19th, home from LGK on the 25th
const flights = [
  leg("outbound", "", "كوالالمبور", "2026-10-15T22:00", "2026-10-16T11:00"),
  leg("internal", "كوالالمبور", "لنكاوي", "2026-10-19T10:00", "2026-10-19T11:00"),
  leg("inbound", "لنكاوي", "", "2026-10-25T14:00", "2026-10-25T18:00"),
];

describe("citiesFromFlights", () => {
  it("lands in the first city, moves with each domestic flight, ends with the flight home", () => {
    expect(citiesFromFlights(flights)).toEqual([
      { city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null, from_flight: true },
      { city_name: "لنكاوي", nights: 6, check_in: null, check_out: null, from_flight: true },
    ]);
  });

  it("says nothing until every airport is linked to a city", () => {
    const unlinked = flights.map((f, i) => (i === 1 ? { ...f, to_city: "" } : f));
    expect(citiesFromFlights(unlinked)).toBeNull();
  });

  it("needs both the way in and the way out", () => {
    expect(citiesFromFlights(flights.slice(0, 2))).toBeNull();
  });

  it("knows when the draft's cities already match", () => {
    const derived = citiesFromFlights(flights)!;
    expect(citiesMatchFlights(derived, derived)).toBe(true);
    expect(citiesMatchFlights([{ ...derived[0], nights: 4 }, derived[1]], derived)).toBe(false);
  });
});

describe("domesticMismatches", () => {
  const cities = deriveCityDates("2026-10-16", citiesFromFlights(flights)!);

  it("accepts a hop between consecutive cities on the day they change", () => {
    expect(domesticMismatches(flights, cities)).toEqual([]);
  });

  it("flags a hop on a different day than the change", () => {
    const moved = flights.map((f) => (f.leg_order === "internal" ? { ...f, departure_at: "2026-10-18T10:00" } : f));
    expect(domesticMismatches(moved, cities)).toHaveLength(1);
  });

  it("treats a same-day connection through a city with no night as one move", () => {
    const viaPenang = [
      flights[0],
      leg("internal", "كوالالمبور", "بينانج", "2026-10-19T08:00", "2026-10-19T09:00"),
      leg("internal", "بينانج", "لنكاوي", "2026-10-19T10:00", "2026-10-19T10:40"),
      flights[2],
    ];
    const chain = citiesFromFlights(viaPenang)!;
    expect(chain.map((c) => c.city_name)).toEqual(["كوالالمبور", "لنكاوي"]);
    expect(domesticMismatches(viaPenang, deriveCityDates("2026-10-16", chain))).toEqual([]);
  });

  it("flags a hop between cities that do not follow each other", () => {
    const wrong = flights.map((f) => (f.leg_order === "internal" ? { ...f, to_city: "بينانج" } : f));
    expect(domesticMismatches(wrong, cities)).toHaveLength(1);
  });
});
