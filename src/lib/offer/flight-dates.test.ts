import { describe, expect, it } from "vitest";
import {
  deriveCityDates,
  emptyDraftData,
  emptyFlight,
  withCityKeys,
  type DraftCity,
  type DraftData,
  type DraftFlight,
  type LookupAirport,
} from "./draft-types";
import { hotelForCity } from "./basic";
import { applyFlightHit, alignTripToFlights } from "./basic-flights";
import { flightEnds, hotelsOffFlights } from "./flight-cities";
import { validateDraft } from "./draft-validation";
import { withRequiredAnswers } from "./draft-test-helpers";
import type { FlightLookupHit } from "@/lib/providers/flight-lookup";

// The administration's file of 2026-10-25 (Indonesia), rebuilt with synthetic names: the card said
// 1/11 → 10/11 (9 nights), the flight landed on 31/10, the cities ran 31/10 → 9/11 and the flight home left
// on 10/11 — and the outbound's clocks (04:50 Riyadh → 08:20 Jakarta) land before they take off.
const MED = { airport: "مطار المدينة (MED)", city: "المدينة المنورة", tz: "Asia/Riyadh" };
const CGK = { airport: "مطار جاكرتا (CGK)", city: "جاكرتا", tz: "Asia/Jakarta" };
const JAKARTA = "جاكرتا";
const PUNCAK = "بونشاك";
const IMPOSSIBLE = "2026-10-31T08:20";

const flight = (order: DraftFlight["leg_order"], from: typeof MED, to: typeof MED, dep: string, arr: string | null): DraftFlight => ({
  ...emptyFlight(order),
  flight_no: order === "outbound" ? "XX100" : "XX101",
  from_airport: from.airport,
  from_city: from.city,
  from_tz: from.tz,
  to_airport: to.airport,
  to_city: to.city,
  to_tz: to.tz,
  departure_at: dep,
  arrival_at: arr,
  date_user_set: true,
});

const stop = (city_name: string, nights: number, over: Partial<DraftCity> = {}): DraftCity => ({ city_name, nights, check_in: null, check_out: null, ...over });

/** The file as it was made: cities by hand (2 + 6 + 1 = 9 nights), the card 1/11 → 10/11. */
function indonesia(landing = "2026-10-31T16:00", cities = [stop(JAKARTA, 2), stop(PUNCAK, 6), stop(JAKARTA, 1)]): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "إندونيسيا", destination: "إندونيسيا", arrival_date: "2026-11-01", departure_date: "2026-11-10", nights: 9, days: 10, adults: 2 };
  data.flights = [flight("outbound", MED, CGK, "2026-10-31T04:50", landing), flight("inbound", CGK, MED, "2026-11-10T12:00", "2026-11-10T16:30")];
  data.cities = withCityKeys(deriveCityDates("2026-10-31", cities));
  data.hotels = data.cities.map((c, i) => ({ ...hotelForCity(data, c.city_name, "SAR", c.key), hotel_name: `فندق ${i + 1}` }));
  return withRequiredAnswers(data);
}

const keys = (d: DraftData, opts?: Parameters<typeof validateDraft>[1]) => {
  const v = validateDraft(d, opts);
  return { blocking: v.blocking.map((i) => i.key ?? i.invariant?.code), warnings: v.warnings.map((i) => i.key) };
};

describe("the file's flight times are read on one clock (the owner, 2026-10-26)", () => {
  it("blocks an outbound that lands before it takes off, and says so on the flights", () => {
    const v = validateDraft(indonesia(IMPOSSIBLE));
    const issue = v.blocking.find((i) => i.key === "pg.warn.flightArrivalBeforeDeparture");
    expect(issue).toMatchObject({ severity: "blocking", stage: "flights" });
    expect(keys(indonesia(IMPOSSIBLE)).warnings).not.toContain("pg.warn.flightArrivalBeforeDeparture");
  });

  it("lets the same flight through once its clocks are possible", () => {
    expect(keys(indonesia("2026-10-31T16:00")).blocking).not.toContain("pg.warn.flightArrivalBeforeDeparture");
  });

  it("judges nothing while an airport's zone is unknown", () => {
    const data = indonesia(IMPOSSIBLE);
    data.flights = data.flights.map((f) => (f.leg_order === "outbound" ? { ...f, to_tz: null } : f));
    expect(keys(data).blocking).not.toContain("pg.warn.flightArrivalBeforeDeparture");
    data.flights = data.flights.map((f) => (f.leg_order === "outbound" ? { ...f, to_tz: "Not/AZone" } : f));
    expect(keys(data).blocking).not.toContain("pg.warn.flightArrivalBeforeDeparture");
  });
});

describe("«جلب» never fills clocks that land before they take off", () => {
  const AIRPORTS: LookupAirport[] = [
    { id: "1", name: "مطار المدينة", code: "MED", timezone: "Asia/Riyadh", city: MED.city, country: "السعودية" },
    { id: "2", name: "مطار جاكرتا", code: "CGK", timezone: "Asia/Jakarta", city: CGK.city, country: "إندونيسيا" },
  ];
  const hit = (over: Partial<FlightLookupHit> = {}): FlightLookupHit => ({
    airline: "Test Air",
    flight_iata: "XX100",
    from_iata: "MED",
    from_airport: "Madinah",
    from_tz: "Asia/Riyadh",
    to_iata: "CGK",
    to_airport: "Jakarta",
    to_tz: "Asia/Jakarta",
    departure_at: "2026-10-22T04:50",
    arrival_at: "2026-10-22T08:20",
    schedule_date: "2026-10-22",
    terminal: null,
    ...over,
  });
  const mine = { ...emptyFlight("outbound"), flight_no: "XX100", departure_at: "2026-10-31T00:00", arrival_at: null };
  const ctx = { airports: AIRPORTS, airlines: [], trip: { arrival_date: "2026-10-31", departure_date: "2026-11-10" } };

  it("takes the airline and the airports, leaves the day and the clocks to the agent, and says why", () => {
    const out = applyFlightHit(mine, hit(), ctx);
    expect(out.badTimes).toBe(true);
    expect(out.leg).toMatchObject({ from_airport: "مطار المدينة (MED)", to_airport: "مطار جاكرتا (CGK)", to_tz: "Asia/Jakarta" });
    expect([out.leg.departure_at, out.leg.arrival_at, out.leg.date_user_set]).toEqual([mine.departure_at, null, false]);
  });

  it("fills a possible flight — 23:00 out of Madinah lands at 12:30 the next day in Jakarta", () => {
    const out = applyFlightHit(mine, hit({ departure_at: "2026-10-22T23:00", arrival_at: "2026-10-23T12:30" }), ctx);
    expect(out.badTimes).toBe(false);
    // an overnight outbound still on the trip's own day is dated by its landing: the 31st is the day it lands
    expect([out.leg.departure_at, out.leg.arrival_at]).toEqual(["2026-10-30T23:00", "2026-10-31T12:30"]);
  });

  it("does not judge an airport whose zone nobody knows", () => {
    const out = applyFlightHit(mine, hit({ to_iata: "ZZZ", to_airport: "Elsewhere", to_tz: null }), ctx);
    expect(out.badTimes).toBe(false);
    expect([out.leg.departure_at, out.leg.arrival_at]).toEqual(["2026-10-31T04:50", "2026-10-31T08:20"]);
  });
});

describe("the hotels against the flights' span", () => {
  it("blocks the file's last night: the cities end on 9/11 and the flight home leaves on 10/11", () => {
    const v = validateDraft(indonesia());
    expect(v.blocking.find((i) => i.key === "pg.err.nightNoHotel")).toMatchObject({ severity: "blocking", stage: "hotels" });
    // the cities start on the day the flight lands: nothing starts before it
    expect(keys(indonesia()).blocking).not.toContain("pg.err.hotelBeforeArrival");
  });

  it("passes when the cities run to the day the flight home leaves", () => {
    const data = indonesia("2026-10-31T16:00", [stop(JAKARTA, 2), stop(PUNCAK, 6), stop(JAKARTA, 2)]);
    data.trip = { ...data.trip, arrival_date: "2026-10-31", nights: 10, days: 11 };
    const k = keys(data);
    expect(k.blocking).not.toContain("pg.err.nightNoHotel");
    expect(k.blocking).not.toContain("pg.err.hotelBeforeArrival");
  });

  it("blocks a hotel that starts before the landing — the night before is booked while the group is still home", () => {
    const data = indonesia("2026-10-31T16:00", [stop(JAKARTA, 3, { edge_in: "prev_night" }), stop(PUNCAK, 6)]);
    data.trip = { ...data.trip, nights: 8 };
    expect(validateDraft(data).blocking.find((i) => i.key === "pg.err.hotelBeforeArrival")).toMatchObject({ severity: "blocking", stage: "hotels" });
  });

  const dated = (landing: string, leaving: string, cities: DraftCity[]) => {
    const flights = [
      flight("outbound", MED, CGK, "2026-10-30T20:00", landing),
      flight("inbound", CGK, MED, leaving, null),
    ];
    return { flights, cities: deriveCityDates(landing.slice(0, 10), cities) };
  };

  it("allows the night before a landing under 06:00, and a last night short before a home flight under 06:00", () => {
    // lands 03:00 on the 31st, the first hotel from the 30th; the flight home at 02:00 on the 10th, out on the 9th
    const early = dated("2026-10-31T03:00", "2026-11-10T02:00", [stop(JAKARTA, 11, { edge_in: "prev_night" })]);
    expect(hotelsOffFlights(early.flights, early.cities)).toEqual([]);
    const late = dated("2026-10-31T14:00", "2026-11-10T14:00", [stop(JAKARTA, 11, { edge_in: "prev_night" })]);
    expect(hotelsOffFlights(late.flights, late.cities)).toEqual(["hotel_before_arrival"]);
    const home = dated("2026-10-31T14:00", "2026-11-10T02:00", [stop(JAKARTA, 9)]);
    expect(hotelsOffFlights(home.flights, home.cities)).toEqual([]);
    const noon = dated("2026-10-31T14:00", "2026-11-10T12:00", [stop(JAKARTA, 9)]);
    expect(hotelsOffFlights(noon.flights, noon.cities)).toEqual(["night_no_hotel"]);
  });

  it("never judges what the agent chose or the client booked", () => {
    const out = dated("2026-10-31T14:00", "2026-11-10T14:00", [stop(JAKARTA, 8, { edge_out: "no_hotel_day" })]);
    expect(hotelsOffFlights(out.flights, out.cities)).toEqual([]);
    const elsewhere = dated("2026-10-31T14:00", "2026-11-10T14:00", [stop(JAKARTA, 9, { edge_in: "no_hotel" })]);
    expect(hotelsOffFlights(elsewhere.flights, elsewhere.cities)).toEqual([]);
    const booked = dated("2026-10-31T14:00", "2026-11-10T14:00", [stop(JAKARTA, 8, { client_hotel: { name: "فندق العميل" } })]);
    expect(hotelsOffFlights(booked.flights, booked.cities)).toEqual([]);
  });

  it("says nothing until the flights state both ends", () => {
    const { flights, cities } = dated("2026-10-31T14:00", "2026-11-10T14:00", [stop(JAKARTA, 5)]);
    expect(hotelsOffFlights([flights[0]], cities)).toEqual([]);
    expect(hotelsOffFlights([flights[0], { ...flights[1], departure_at: null }], cities)).toEqual([]);
    expect(hotelsOffFlights(flights, [])).toEqual([]);
  });

  it("is quiet in a sale without hotels, with the flights left for later, and only advises a partner's file", () => {
    const noHotels = indonesia();
    noHotels.scope = { ...noHotels.scope, hotels: false };
    const k = keys(noHotels);
    expect([...k.blocking, ...k.warnings]).not.toContain("pg.err.nightNoHotel");

    const later = indonesia();
    later.flight_booking = { ...later.flight_booking, later_intl: true };
    expect(keys(later).blocking).not.toContain("pg.err.nightNoHotel");

    const partner = keys(indonesia(), { partnerFile: true });
    expect(partner.blocking).not.toContain("pg.err.nightNoHotel");
    expect(partner.warnings).toContain("pg.err.nightNoHotel");
  });

  it("reads the two ends the way the cities do: the last outbound landing, the first leg home", () => {
    const transit = [
      flight("outbound", MED, { airport: "مطار الدوحة (DOH)", city: "الدوحة", tz: "Asia/Qatar" }, "2026-10-30T20:00", "2026-10-30T22:00"),
      flight("outbound", { airport: "مطار الدوحة (DOH)", city: "الدوحة", tz: "Asia/Qatar" }, CGK, "2026-10-30T23:30", "2026-10-31T11:30"),
      flight("inbound", CGK, MED, "2026-11-10T12:00", "2026-11-10T16:30"),
    ];
    expect(flightEnds(transit)).toMatchObject({ landing: "2026-10-31", landingTime: "11:30", leaving: "2026-11-10", leavingTime: "12:00" });
  });
});

describe("«اعتمد تواريخ الطيران» — one tap to unify the file", () => {
  it("takes the trip's dates from the flights and gives the missing night to the last city, saying so", () => {
    const data = indonesia();
    const fit = alignTripToFlights(data)!;
    expect(fit).toMatchObject({ arrival_date: "2026-10-31", departure_date: "2026-11-10", lastCity: { city: JAKARTA, delta: 1 } });
    expect(fit.patch.trip).toMatchObject({ arrival_date: "2026-10-31", departure_date: "2026-11-10", nights: 10, days: 11 });
    expect(fit.patch.cities?.map((c) => c.nights)).toEqual([2, 6, 2]);
    expect([fit.patch.cities?.[0].check_in, fit.patch.cities?.[2].check_out]).toEqual(["2026-10-31", "2026-11-10"]);
    // what the agent typed is not touched: the hotels, the flights' numbers and times
    expect(fit.patch.hotels?.map((h) => h.hotel_name)).toEqual(["فندق 1", "فندق 2", "فندق 3"]);
    expect(fit.patch.flights.map((f) => [f.flight_no, f.departure_at, f.arrival_at])).toEqual(data.flights.map((f) => [f.flight_no, f.departure_at, f.arrival_at]));
  });

  it("leaves the file with nothing to block on its dates", () => {
    const data = indonesia();
    const after = { ...data, ...alignTripToFlights(data)!.patch };
    const k = keys(after);
    expect(k.blocking).not.toContain("pg.err.nightNoHotel");
    expect(k.blocking).not.toContain("pg.err.hotelBeforeArrival");
    expect(k.blocking).not.toContain("nights_sum_mismatch");
    expect(k.warnings).not.toContain("pg.warn.landingDateDiffers");
    // and says nothing more once adopted
    expect(alignTripToFlights(after)).toBeNull();
  });

  it("pins the international legs so the trip's new day never moves them again", () => {
    const data = indonesia();
    data.flights = [...data.flights.map((f) => ({ ...f, date_user_set: false })), { ...emptyFlight("internal"), departure_at: "2026-11-03T09:00" }];
    const flights = alignTripToFlights(data)!.patch.flights;
    expect(flights.map((f) => [f.leg_order, f.date_user_set])).toEqual([["outbound", true], ["inbound", true], ["internal", false]]);
  });

  it("lets a city still marked from the flights follow them, with no night to move", () => {
    const data = indonesia("2026-10-31T16:00", [stop(JAKARTA, 9, { from_flight: true })]);
    const fit = alignTripToFlights(data)!;
    expect(fit.patch.cities?.map((c) => c.nights)).toEqual([10]);
    expect(fit.lastCity).toBeNull();
  });

  it("takes extra nights back from the last city", () => {
    const data = indonesia("2026-10-31T16:00", [stop(JAKARTA, 4), stop(PUNCAK, 8)]);
    data.trip = { ...data.trip, nights: 12 };
    const fit = alignTripToFlights(data)!;
    expect(fit.patch.cities?.map((c) => c.nights)).toEqual([4, 6]);
    expect(fit.lastCity).toEqual({ city: PUNCAK, delta: -2 });
  });

  it("never takes a city under one night — it moves nothing and says nothing", () => {
    const data = indonesia("2026-10-31T16:00", [stop(JAKARTA, 5), stop(PUNCAK, 1)]);
    data.flights = data.flights.map((f) => (f.leg_order === "inbound" ? { ...f, departure_at: "2026-11-03T12:00", arrival_at: "2026-11-03T16:30" } : f));
    const fit = alignTripToFlights(data)!;
    expect(fit.patch.cities?.map((c) => c.nights)).toEqual([5, 1]);
    expect(fit.lastCity).toBeNull();
  });

  it("with no city yet, writes only the dates — the cities step builds them from the flights", () => {
    const data = { ...indonesia(), cities: [], hotels: [] };
    const fit = alignTripToFlights(data)!;
    expect(Object.keys(fit.patch).sort()).toEqual(["flights", "trip"]);
    expect(fit.lastCity).toBeNull();
  });

  it("asks nothing when the flights do not state both ends, or already say what the card says", () => {
    const data = indonesia();
    expect(alignTripToFlights({ ...data, flights: data.flights.slice(0, 1) })).toBeNull();
    expect(alignTripToFlights({ ...data, flights: data.flights.map((f) => (f.leg_order === "inbound" ? { ...f, departure_at: "2026-10-30T12:00" } : f)) })).toBeNull();
    expect(alignTripToFlights({ ...data, trip: { ...data.trip, arrival_date: "2026-10-31" } })).toBeNull();
  });
});
