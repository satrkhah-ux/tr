import { describe, expect, it } from "vitest";
import {
  cityHotelLines,
  deriveCityDates,
  emptyDraftData,
  emptyFlight,
  FLIGHTS_LATER_LINE,
  hopMode,
  normalizeDraftData,
  totalCityNights,
  type DraftData,
  type DraftFlight,
  type LookupAirport,
} from "./draft-types";
import { addCity, chainCities, findAirport, priceAtSource, setCityNights, withDomesticFlights, withHotelLines, withScopeLines } from "./basic";
import { applyFlightHit, changeLeg, domesticTotal, landingAt, newDomesticLeg, withCitiesFromFlights } from "./basic-flights";
import { citiesFromFlights, domesticMismatches } from "./flight-cities";
import { validateDraft } from "./draft-validation";
import { suggestPricing } from "./pricing-suggest";
import { planBookingsFromDraft } from "@/lib/operations/seed-plan";
import type { FlightLookupHit } from "@/lib/providers/flight-lookup";

const IST = "إسطنبول";
const TZX = "طرابزون";
const AIRPORTS: LookupAirport[] = [
  { id: "1", name: "مطار إسطنبول", code: "IST", timezone: "Europe/Istanbul", city: IST, country: "تركيا", name_en: "Istanbul Airport" },
  { id: "2", name: "مطار طرابزون", code: "TZX", timezone: "Europe/Istanbul", city: TZX, country: "تركيا", name_en: "Trabzon Airport" },
  { id: "3", name: "مطار الأمير محمد بن عبدالعزيز", code: "MED", timezone: "Asia/Riyadh", city: "المدينة المنورة", country: "السعودية" },
  { id: "4", name: "مطار كوالالمبور الدولي", code: "KUL", timezone: "Asia/Kuala_Lumpur", city: "كوالالمبور", country: "ماليزيا" },
  { id: "5", name: "مطار أنقرة", code: "ESB", timezone: "Europe/Istanbul", city: "أنقرة", country: "تركيا" },
];
const AIRLINES = [{ iata: "TK", name: "الخطوط التركية", logo_url: null }];

function leg(order: DraftFlight["leg_order"], from: string, to: string, dep: string, arr: string | null = null): DraftFlight {
  const a = AIRPORTS.find((x) => x.code === from);
  const b = AIRPORTS.find((x) => x.code === to);
  return {
    ...emptyFlight(order),
    from_airport: a ? `${a.name} (${a.code})` : from,
    to_airport: b ? `${b.name} (${b.code})` : to,
    from_city: a?.city ?? "",
    to_city: b?.city ?? "",
    from_tz: a?.timezone ?? null,
    to_tz: b?.timezone ?? null,
    departure_at: dep,
    arrival_at: arr,
  };
}

/** The owner's file (03e31898): Istanbul on the 5th, a domestic flight to Trabzon on the 8th, home on the 12th. */
function trabzon(home: "TZX" | "IST" = "TZX"): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "تركيا", destination: "تركيا", arrival_date: "2026-11-05", departure_date: "2026-11-12", nights: 7, days: 8, meal_plan: "breakfast" };
  data.flights = [
    leg("outbound", "MED", "IST", "2026-11-05T09:00", "2026-11-05T12:30"),
    leg("internal", "IST", "TZX", "2026-11-08T10:00", "2026-11-08T12:00"),
    leg("inbound", home, "MED", "2026-11-12T14:00", "2026-11-12T17:00"),
  ];
  return data;
}

/** What the editor's commit does with a slice: the dates chained, a hotel line for every city. */
function settle(data: DraftData, slice: Partial<DraftData>): DraftData {
  const merged = { ...data, ...slice };
  const cities = chainCities(merged, merged.cities);
  const next = { ...merged, cities };
  return { ...next, hotels: withHotelLines(next, "SAR") };
}

const plan = (d: DraftData) => d.cities.map((c) => [c.city_name, c.check_in, c.check_out, c.nights]);

describe("the cities, from the flights (the owner's rules, 2026-10-22)", () => {
  it("lands in Istanbul on the 5th, flies to Trabzon on the 8th, home on the 12th: 3 nights + 4", () => {
    const data = trabzon();
    const next = settle(data, withCitiesFromFlights(data)!);
    expect(plan(next)).toEqual([
      [IST, "2026-11-05", "2026-11-08", 3],
      [TZX, "2026-11-08", "2026-11-12", 4],
    ]);
    // every stop is the flights', and has its hotel line by its key
    expect(next.cities.every((c) => c.from_flight)).toBe(true);
    expect(next.cities.map((_, i) => cityHotelLines(next.cities, next.hotels, i).length)).toEqual([1, 1]);
    // the move is the domestic flight: no second leg written for it, the bookings agree with the cities
    expect(hopMode(next.transport_plan, IST, TZX)).toBe("flight");
    const shaped = withDomesticFlights(next, AIRPORTS);
    expect(shaped.flights.filter((f) => f.leg_order === "internal")).toHaveLength(1);
    expect(domesticMismatches(shaped.flights, next.cities)).toEqual([]);
  });

  it("home from Istanbul with no flight back to it: Istanbul closes the trip by road, a night taken from Trabzon", () => {
    const data = trabzon("IST");
    const next = settle(data, withCitiesFromFlights(data)!);
    expect(plan(next)).toEqual([
      [IST, "2026-11-05", "2026-11-08", 3],
      [TZX, "2026-11-08", "2026-11-11", 3],
      [IST, "2026-11-11", "2026-11-12", 1],
    ]);
    expect(hopMode(next.transport_plan, TZX, IST)).toBe("car");
  });

  it("a domestic flight back to Istanbul on the day home is a connection, not a stop", () => {
    const data = trabzon("IST");
    data.flights.push(leg("internal", "TZX", "IST", "2026-11-12T07:00", "2026-11-12T09:00"));
    expect(plan(settle(data, withCitiesFromFlights(data)!))).toEqual([
      [IST, "2026-11-05", "2026-11-08", 3],
      [TZX, "2026-11-08", "2026-11-12", 4],
    ]);
  });

  it("a same-day connection through Ankara is one move: no night there, and no third leg planned for it", () => {
    const data = trabzon();
    data.flights.splice(1, 1, leg("internal", "IST", "ESB", "2026-11-08T08:00", "2026-11-08T09:10"), leg("internal", "ESB", "TZX", "2026-11-08T11:00", "2026-11-08T12:20"));
    const next = settle(data, withCitiesFromFlights(data)!);
    expect(plan(next).map((c) => [c[0], c[3]])).toEqual([
      [IST, 3],
      [TZX, 4],
    ]);
    expect(hopMode(next.transport_plan, IST, TZX)).toBe("flight");
    expect(withDomesticFlights(next, AIRPORTS).flights.filter((f) => f.leg_order === "internal")).toHaveLength(2);
  });

  it("a domestic flight landing past midnight spends that night in the air — the trip's nights still add up", () => {
    const data = trabzon();
    data.flights[1] = leg("internal", "IST", "TZX", "2026-11-08T23:30", "2026-11-09T01:10");
    const next = settle(data, withCitiesFromFlights(data)!);
    expect(plan(next)).toEqual([
      [IST, "2026-11-05", "2026-11-08", 3],
      [TZX, "2026-11-09", "2026-11-12", 3],
    ]);
    expect(next.cities[1].arrives_next_day).toBe(true);
    expect(totalCityNights(next.cities)).toBe(7);
  });

  it("an outbound landing after midnight starts the first city on the day it lands", () => {
    const data = trabzon();
    data.flights[0] = leg("outbound", "MED", "IST", "2026-11-04T23:00", "2026-11-05T02:30");
    expect(citiesFromFlights(data.flights)?.map((c) => [c.city_name, c.nights])).toEqual([
      [IST, 3],
      [TZX, 4],
    ]);
  });

  it("works from planned legs with only their days (no clock yet)", () => {
    const data = trabzon();
    data.flights = [leg("outbound", "MED", "IST", "2026-11-05T00:00"), leg("internal", "IST", "TZX", "2026-11-08T00:00"), leg("inbound", "TZX", "MED", "2026-11-12T00:00")];
    expect(citiesFromFlights(data.flights)?.map((c) => c.nights)).toEqual([3, 4]);
  });

  it("says nothing while an airport is not linked to a city", () => {
    const data = trabzon();
    data.flights[1] = { ...data.flights[1], to_city: "" };
    expect(withCitiesFromFlights(data)).toBeNull();
  });

  it("again after a flight change: the stops still the flights' follow, keeping their keys and hotels", () => {
    const data = trabzon();
    let next = settle(data, withCitiesFromFlights(data)!);
    const hotelIds = next.hotels.map((h) => h.id);
    next = { ...next, flights: next.flights.map((f) => (f.leg_order === "internal" ? { ...f, departure_at: "2026-11-09T10:00", arrival_at: "2026-11-09T12:00" } : f)) };
    const again = settle(next, withCitiesFromFlights(next)!);
    expect(plan(again)).toEqual([
      [IST, "2026-11-05", "2026-11-09", 4],
      [TZX, "2026-11-09", "2026-11-12", 3],
    ]);
    expect(again.cities.map((c) => c.key)).toEqual(next.cities.map((c) => c.key));
    expect(again.hotels.map((h) => h.id)).toEqual(hotelIds);
  });

  it("never changes a stop the agent edited by hand, nor one they added", () => {
    const data = trabzon();
    let next = settle(data, withCitiesFromFlights(data)!);
    // Istanbul cut to 2 nights by hand, then Bursa added by hand after it
    next = { ...next, ...setCityNights(next, 0, 2) };
    expect(next.cities[0].from_flight).toBeUndefined();
    next = { ...next, cities: [next.cities[0], { city_name: "بورصة", nights: 1, check_in: null, check_out: null }, next.cities[1]] };
    next = settle(next, {});
    // the domestic flight moves to the 9th
    next = { ...next, flights: next.flights.map((f) => (f.leg_order === "internal" ? { ...f, departure_at: "2026-11-09T10:00", arrival_at: "2026-11-09T12:00" } : f)) };
    const again = settle(next, withCitiesFromFlights(next)!);
    expect(again.cities.map((c) => [c.city_name, c.nights])).toEqual([
      [IST, 2],
      ["بورصة", 1],
      [TZX, 3],
    ]);
  });

  it("a city the flights no longer reach goes with its hotel; a new one comes after the stop before it", () => {
    const data = trabzon("IST");
    data.flights.push(leg("internal", "TZX", "IST", "2026-11-12T07:00", "2026-11-12T09:00"));
    let next = settle(data, withCitiesFromFlights(data)!);
    const trabzonKey = next.cities[1].key;
    // Trabzon becomes Kuala Lumpur (another city by air) — an odd trip, but the rule is the rule
    next = {
      ...next,
      flights: next.flights.map((f) =>
        f.to_city === TZX ? { ...f, to_city: "كوالالمبور" } : f.from_city === TZX ? { ...f, from_city: "كوالالمبور" } : f,
      ),
    };
    const again = settle(next, withCitiesFromFlights(next, (c) => (c === "كوالالمبور" ? "ماليزيا" : "تركيا"))!);
    expect(again.cities.map((c) => [c.city_name, c.nights, c.country])).toEqual([
      [IST, 3, undefined],
      ["كوالالمبور", 4, "ماليزيا"],
    ]);
    expect(again.hotels.some((h) => h.city_key === trabzonKey)).toBe(false);
    expect(again.hotels.filter((h) => h.city_name === "كوالالمبور")).toHaveLength(1);
  });

  it("keeps a city added from the bar before the flights were in (an older file) as the agent typed it", () => {
    let data = trabzon();
    data = { ...data, ...addCity(data, { name: IST, nights: 3, tours: 1 }, "SAR") };
    data = { ...data, ...addCity(data, { name: TZX, nights: 4, tours: 1 }, "SAR") };
    const again = withCitiesFromFlights(data)!;
    expect(again.cities.map((c) => [c.city_name, c.nights, c.key])).toEqual(data.cities.map((c) => [c.city_name, c.nights, c.key]));
    expect(again.hotels).toEqual(data.hotels);
  });
});

describe("a leg, edited by its id", () => {
  it("an airport typed as a code, a city or an English name resolves its city and zone", () => {
    expect(findAirport("tzx", AIRPORTS)?.code).toBe("TZX");
    expect(findAirport("اسطنبول", AIRPORTS)?.code).toBe("IST");
    expect(findAirport("Trabzon Airport", AIRPORTS)?.code).toBe("TZX");
    expect(findAirport("طرابزون", AIRPORTS)?.code).toBe("TZX");
  });

  it("stays the same leg whatever changes on it; a new day moves its landing with it", () => {
    const data = trabzon();
    const id = data.flights[1].id!;
    let flights = changeLeg(data, AIRPORTS, id, { to_airport: "KUL" });
    expect(flights[1]).toMatchObject({ id, to_city: "كوالالمبور", to_tz: "Asia/Kuala_Lumpur" });
    expect(flights.filter((f) => f.leg_order === "internal")).toHaveLength(1);
    flights = changeLeg({ ...data, flights }, AIRPORTS, id, { date: "2026-11-09" });
    expect([flights[1].departure_at, flights[1].arrival_at, flights[1].date_user_set]).toEqual(["2026-11-09T10:00", "2026-11-09T12:00", true]);
  });

  it("a domestic leg the cities wrote becomes the agent's once edited", () => {
    const data = trabzon();
    data.flights[1] = { ...data.flights[1], auto: true };
    expect(changeLeg(data, AIRPORTS, data.flights[1].id!, { flight_no: "TK2830" })[1].auto).toBeUndefined();
  });

  it("lands on the day the zones say: MED 23:00 → KUL 13:00 is the next day, IST 10:00 → TZX 12:00 the same", () => {
    expect(landingAt("2026-11-05T23:00", "Asia/Riyadh", "13:00", "Asia/Kuala_Lumpur")).toBe("2026-11-06T13:00");
    expect(landingAt("2026-11-05T10:00", "Europe/Istanbul", "12:00", "Europe/Istanbul")).toBe("2026-11-05T12:00");
    expect(landingAt("2026-11-05T23:30", null, "01:10", null)).toBe("2026-11-06T01:10");
  });

  it("a new domestic leg leaves from where the group last landed", () => {
    const data = trabzon();
    expect(newDomesticLeg(data, emptyFlight("internal")).from_airport).toBe(data.flights[1].to_airport);
  });

  it("adds the legs' prices into the domestic booking; the sheet's total clears them", () => {
    const data = trabzon();
    data.flights[1] = { ...data.flights[1], price: 900 };
    data.flights.push({ ...leg("internal", "TZX", "IST", "2026-11-12T07:00"), price: 650.5 });
    expect(domesticTotal(data.flights)).toBe(1550.5);
    expect(domesticTotal([data.flights[0]])).toBeNull();
    const at = priceAtSource(data, { item_type: "flight", ref: "flight:dom" }, { price: 2000 });
    expect(at?.flight_booking?.dom_price).toBe(2000);
    expect(at?.flights?.filter((f) => f.leg_order === "internal").every((f) => f.price === undefined)).toBe(true);
  });

  it("keeps a leg's id across a save and gives an older one an id from its place", () => {
    const data = trabzon();
    expect(normalizeDraftData(JSON.parse(JSON.stringify(data))).flights.map((f) => f.id)).toEqual(data.flights.map((f) => f.id));
    const old = JSON.parse(JSON.stringify(data));
    for (const f of old.flights) delete f.id;
    expect(normalizeDraftData(old).flights.map((f) => f.id)).toEqual(["leg-0", "leg-1", "leg-2"]);
  });
});

describe("«جلب» — a looked-up flight onto the agent's leg", () => {
  const hit = (over: Partial<FlightLookupHit> = {}): FlightLookupHit => ({
    // the feed answers for today, and may answer with a codeshare's number and airline
    airline: "RwandAir",
    flight_iata: "WB1379",
    from_iata: "IST",
    from_airport: "Istanbul Airport",
    from_tz: "Europe/Istanbul",
    to_iata: "TZX",
    to_airport: "Trabzon",
    to_tz: "Europe/Istanbul",
    departure_at: "2026-10-22T10:05",
    arrival_at: "2026-10-22T12:00",
    schedule_date: "2026-10-22",
    terminal: null,
    ...over,
  });
  const ctx = { airports: AIRPORTS, airlines: AIRLINES, trip: trabzon().trip };

  it("takes the route and the clocks, keeps the agent's day and number, and asks to check the date", () => {
    const mine = { ...emptyFlight("internal"), flight_no: "tk2830", departure_at: "2026-11-08T00:00" };
    const out = applyFlightHit(mine, hit(), ctx);
    expect(out.leg).toMatchObject({
      flight_no: "TK2830",
      airline: "الخطوط التركية",
      airline_iata: "TK",
      from_airport: "مطار إسطنبول (IST)",
      to_airport: "مطار طرابزون (TZX)",
      from_city: IST,
      to_city: TZX,
      departure_at: "2026-11-08T10:05",
      arrival_at: "2026-11-08T12:00",
    });
    expect(out.checkDate).toBe(true);
  });

  it("an overnight outbound still on the trip's day is dated by its landing — the trip's arrival day", () => {
    const outbound = { ...emptyFlight("outbound"), flight_no: "SV2", departure_at: "2026-11-05T00:00" };
    const out = applyFlightHit(outbound, hit({ from_iata: "MED", to_iata: "KUL", departure_at: "2026-10-22T23:00", arrival_at: "2026-10-23T13:00" }), ctx);
    expect([out.leg.departure_at, out.leg.arrival_at, out.leg.date_user_set]).toEqual(["2026-11-04T23:00", "2026-11-05T13:00", true]);
  });

  it("an airport we do not list keeps the provider's name with its code — and no city", () => {
    const out = applyFlightHit({ ...emptyFlight("internal"), flight_no: "TK1", departure_at: "2026-11-08T00:00" }, hit({ to_iata: "JFK", to_airport: "John F Kennedy" }), ctx);
    expect([out.leg.to_airport, out.leg.to_city]).toEqual(["John F Kennedy (JFK)", ""]);
  });
});

describe("«أضف لاحقاً»", () => {
  function later(): DraftData {
    const data = settle(trabzon(), withCitiesFromFlights(trabzon())!);
    return { ...data, flight_booking: { ...data.flight_booking, later_intl: true, later_dom: true } };
  }

  it("is not asked for, not priced, and the offer says the flights are confirmed later", () => {
    const data = later();
    const flightIssues = validateDraft(data).blocking.filter((i) => i.stage === "flights");
    expect(flightIssues).toEqual([]);
    expect(suggestPricing(data, { transfers: [], services: [], rooms: [], fleet: [] }, { hotel: "الفندق", airline: "الطيران" }).some((i) => i.item_type === "flight")).toBe(false);
    expect(withScopeLines(data).includes).toContain(FLIGHTS_LATER_LINE);
    // entered again: the line goes
    const back = { ...data, flight_booking: { ...data.flight_booking, later_intl: undefined, later_dom: undefined } };
    expect(withScopeLines({ ...back, services: withScopeLines(data) }).includes).not.toContain(FLIGHTS_LATER_LINE);
  });

  it("survives a save, and operations still books the flights (their tickets before «جاهز للسفر»)", () => {
    const data = normalizeDraftData(JSON.parse(JSON.stringify(later())));
    expect([data.flight_booking.later_intl, data.flight_booking.later_dom]).toEqual([true, true]);
    const flights = planBookingsFromDraft(data, "").filter((b) => b.kind === "flight");
    expect(flights.map((b) => b.origin_ref)).toEqual(["flight:intl", "flight:dom"]);
    expect(flights.every((b) => b.title.includes("لاحقاً"))).toBe(true);
  });

  it("the cities' dates still chain from the trip when the international flight is left for later", () => {
    const data = later();
    expect(deriveCityDates(data.trip.arrival_date, data.cities)[0].check_in).toBe("2026-11-05");
  });
});
