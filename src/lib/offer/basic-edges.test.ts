import { describe, expect, it } from "vitest";
import { basicDays, chainCities, setEdge, withHotelLines, type BasicCity } from "./basic";
import { advancedDefaults, emptyAdvanced, fillAdvanced } from "./advanced";
import { deriveHotelStays, deriveTransportRows, emptyDraftData, emptyFlight, totalCityNights, type DraftData } from "./draft-types";

/** Istanbul `nights` nights from `from`, home on the flight `homeAt` (the owner's case, 2026-10-18). */
function trip(from: string, nights: number, homeAt: string, landAt = `${from}T15:00`): DraftData {
  const d = emptyDraftData();
  d.trip = { ...d.trip, country: "تركيا", arrival_date: from, nights, days: nights + 1, adults: 2, rooms: 1 };
  d.flights = [
    { ...emptyFlight("outbound"), from_airport: "MED", to_airport: "IST", departure_at: `${from}T09:00`, arrival_at: landAt },
    { ...emptyFlight("inbound"), from_airport: "IST", to_airport: "MED", departure_at: homeAt, arrival_at: homeAt },
  ];
  d.cities = chainCities(d, [{ city_name: "اسطنبول", nights, check_in: null, check_out: null } as BasicCity]);
  d.hotels = withHotelLines(d, "SAR");
  return d;
}
const apply = (d: DraftData, slice: Pick<DraftData, "cities" | "hotels">): DraftData => {
  const next = { ...d, ...slice };
  return { ...next, days: basicDays(next) };
};
const stay = (d: DraftData) => deriveHotelStays(d.cities, d.hotels)[0];

describe("«بكج متقدم» — the trip's edges (the owner, 2026-10-18)", () => {
  it("1. the last day without a hotel: 5 hotel nights out of 6, no error, the car until the airport at 22:30", () => {
    const d = trip("2026-12-07", 6, "2026-12-13T01:30");
    const out = apply(d, setEdge(d, "out", "no_hotel_day"));
    expect(out.cities[0].nights).toBe(5);
    expect(totalCityNights(out.cities)).toBe(out.trip.nights);
    expect([stay(out).check_in, stay(out).check_out, stay(out).nights]).toEqual(["2026-12-07", "2026-12-12", 5]);
    const day12 = out.days.find((x) => x.date === "2026-12-12")!;
    expect(day12.activities[0]).toContain("تسجيل الخروج من الفندق الساعة 12:00");
    expect(day12.activities).toContain("التوجه إلى المطار الساعة 22:30");
    expect(day12.activities).toContain("ليلة 2026-12-12 بدون إقامة حسب طلبكم");
    const farewell = deriveTransportRows(out.transport_plan, out.cities).find((r) => r.to_place.includes("المطار"));
    expect(farewell?.date).toBe("2026-12-12");
    expect(farewell?.note).toContain("من الفندق الساعة 12:00 حتى المطار");
  });

  it("2. a 03:00 landing with the night before booked: the hotel from the 9th, nights still whole", () => {
    const d = trip("2026-12-10", 5, "2026-12-15T18:00", "2026-12-10T03:00");
    const out = apply(d, setEdge(d, "in", "prev_night"));
    expect(out.cities[0].nights).toBe(6);
    expect(totalCityNights(out.cities)).toBe(out.trip.nights);
    expect([stay(out).check_in, stay(out).nights]).toEqual(["2026-12-09", 6]);
    expect(out.days[0].activities.join(" ")).toContain("الغرفة محجوزة من ليلة 2026-12-09");
  });

  it("3. the arrival night spent elsewhere: the hotel from the next day, one night less, said on day 1", () => {
    const d = trip("2026-12-10", 5, "2026-12-15T18:00");
    const out = apply(d, setEdge(d, "in", "no_hotel"));
    expect(out.cities[0].nights).toBe(4);
    expect(totalCityNights(out.cities)).toBe(out.trip.nights);
    expect([stay(out).check_in, stay(out).check_out]).toEqual(["2026-12-11", "2026-12-15"]);
    expect(out.days[0].activities.join(" ")).toContain("الليلة الأولى بدون إقامة حسب طلبكم");
  });

  it("1b. «بكج متقدم»'s farewell follows: the check-out day at 22:30, and back to the flight's day when undone", () => {
    const d = trip("2026-12-07", 6, "2026-12-13T01:30");
    const out = apply(d, setEdge(d, "out", "no_hotel_day"));
    const adv = fillAdvanced({ ...emptyAdvanced(), on: true, parts: { arrival: false, departure: true } }, advancedDefaults(out));
    expect([adv.farewell.date, adv.farewell.time]).toEqual(["2026-12-12", "22:30"]);
    const back = apply(out, setEdge(out, "out", null));
    const again = fillAdvanced(adv, advancedDefaults(back));
    expect([again.farewell.date, again.farewell.time]).toEqual(["2026-12-13", ""]);
  });

  it("4. choosing «as Basic has it» again gives back the nights and the dates", () => {
    const d = trip("2026-12-07", 6, "2026-12-13T01:30");
    const off = apply(d, setEdge(apply(d, setEdge(d, "out", "no_hotel_day")), "out", null));
    expect(off.cities[0].nights).toBe(6);
    expect(off.cities[0].edge_out).toBeUndefined();
    expect([stay(off).check_in, stay(off).check_out]).toEqual(["2026-12-07", "2026-12-13"]);
  });
});
