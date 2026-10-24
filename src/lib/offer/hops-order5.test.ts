import { describe, expect, it } from "vitest";
import { emptyDraftData, emptyFlight, normalizeDraftData, type DraftData, type DraftFlight, type LookupAirport } from "./draft-types";
import { addCity, basicDays, chainCities, cityServices, withDomesticFlights } from "./basic";
import { applyFlightHit, changeLeg, flightHops, legGaps, withCitiesFromFlights, withLegFares } from "./basic-flights";
import { withFlightTotals } from "./flight-fare";
import { draftTransportNote } from "./itinerary";
import { suggestPricing, type PricingReference } from "./pricing-suggest";
import { syncDepartureDates } from "./schedule";

/**
 * The evaluator's Thailand file (Order 5, 2026-10-24), anonymised: two adults, Bangkok one night, Phuket seven
 * over three hotels, Bangkok again for the last night, the two moves by air — and nothing else from the file.
 */
const BKK = "بانكوك";
const HKT = "فوكيت";
const AIRPORTS: LookupAirport[] = [
  { id: "1", name: "مطار سوفارنابومي", code: "BKK", timezone: "Asia/Bangkok", city: BKK, country: "تايلاند" },
  { id: "2", name: "مطار بوكيت", code: "HKT", timezone: "Asia/Bangkok", city: HKT, country: "تايلاند" },
  { id: "3", name: "مطار الأمير محمد بن عبدالعزيز", code: "MED", timezone: "Asia/Riyadh", city: "المدينة المنورة", country: "السعودية" },
];
const BKK_AIRPORT = "مطار سوفارنابومي (BKK)";
const HKT_AIRPORT = "مطار بوكيت (HKT)";

function thailand(): DraftData {
  let data = emptyDraftData();
  data.trip = { ...data.trip, country: "تايلاند", destination: "تايلاند", arrival_date: "2026-11-25", departure_date: "2026-12-04", nights: 9, days: 10, adults: 2, meal_plan: "breakfast" };
  data.scope = { ...data.scope, transport: true, flights_domestic: true, flights_intl: false };
  data.flights = [];
  const plan = data.transport_plan;
  data.transport_plan = {
    ...plan,
    airport: { ...plan.airport, car_type: "سيارة صغيرة" },
    tours: { ...plan.tours, enabled: false },
    intercity: { ...plan.intercity, enabled: true, modes: ["car", "flight"], mode: "car" },
  };
  for (const [name, nights, hotel] of [
    [BKK, 1, "فندق ألف"],
    [HKT, 7, "منتجع باء"],
    [BKK, 1, "فندق دال"],
  ] as const) {
    data = { ...data, ...addCity(data, { name, nights, tours: 0, hotel: { id: hotel, name: hotel } }, "SAR") };
  }
  // Phuket's seven nights over three hotels: 1 + 3 + 3
  const phuket = data.hotels.find((h) => h.city_key === data.cities[1].key)!;
  const stay = (id: string, name: string, nights: number) => ({ ...phuket, id, hotel_id: id, hotel_name: name, nights });
  data.hotels = data.hotels.flatMap((h) => (h === phuket ? [stay("stay-b1", "منتجع باء", 1), stay("stay-b2", "فندق جيم", 3), stay("stay-b3", "فندق هاء", 3)] : [h]));
  return commit(data);
}

/** What the editor's commit does with the flights: dates synced, the cities chained, the hops' legs written, the fare from the legs. */
function commit(data: DraftData, slice: Partial<DraftData> = {}): DraftData {
  const merged = { ...data, ...slice };
  const flights = syncDepartureDates(merged.trip, merged.flights);
  const cities = chainCities({ trip: merged.trip, flights }, merged.cities);
  const domestic = withDomesticFlights({ ...merged, flights, cities }, AIRPORTS);
  const next = { ...merged, cities, ...domestic, flight_booking: withLegFares(merged.flight_booking, merged.trip, domestic.flights, data.flights) };
  return { ...next, days: basicDays(next) };
}

const dom = (d: DraftData) => d.flights.filter((f) => f.leg_order === "internal");
const route = (f: DraftFlight) => [f.from_airport, f.to_airport, f.departure_at, f.flight_no];
const legTo = (d: DraftData, city: string) => dom(d).find((f) => f.to_city === city)!;

describe("1b — a domestic leg is its hop's: seeded from it, listed in travel order, edited in place", () => {
  it("seeds each leg from its hop — the day the city changes, from A's airport to B's, no number", () => {
    const data = thailand();
    expect(dom(data).map(route)).toEqual([
      [BKK_AIRPORT, HKT_AIRPORT, "2026-11-26T00:00", ""],
      [HKT_AIRPORT, BKK_AIRPORT, "2026-12-03T00:00", ""],
    ]);
    // and each sits on its own hop between the two city cards
    expect(flightHops(data).hops.map((h) => [h.from, h.to, h.day, h.before, h.legs.map((f) => f.departure_at)])).toEqual([
      [BKK, HKT, "2026-11-26", 1, ["2026-11-26T00:00"]],
      [HKT, BKK, "2026-12-03", 2, ["2026-12-03T00:00"]],
    ]);
  });

  it("(3) keeps them in travel order whatever is edited — the evaluator's 03/12 listed above 26/11", () => {
    let data = thailand();
    const first = legTo(data, HKT).id!;
    // a price typed on the first leg used to make it «the agent's» and send it to the end of the list
    data = commit(data, { flights: changeLeg(data, AIRPORTS, first, { price: 300 }, { from: BKK, to: HKT }) });
    expect(dom(data).map((f) => f.departure_at)).toEqual(["2026-11-26T00:00", "2026-12-03T00:00"]);
    // a file saved upside down (the agent's own legs, the later one first) comes back in order
    const upside = { ...data, flights: [...dom(data)].reverse().map((f) => ({ ...f, auto: undefined })) };
    expect(dom(commit(upside)).map((f) => f.departure_at)).toEqual(["2026-11-26T00:00", "2026-12-03T00:00"]);
    expect(flightHops(commit(upside)).hops.map((h) => h.legs.map((f) => f.to_city))).toEqual([[HKT], [BKK]]);
  });

  it("(1) its day and both clocks are edited on the hop, and stay through the next change", () => {
    let data = thailand();
    const id = legTo(data, HKT).id!;
    const hop = { from: BKK, to: HKT };
    for (const change of [{ dep: "09:30" }, { arr: "10:55" }]) data = commit(data, { flights: changeLeg(data, AIRPORTS, id, change, hop) });
    expect([legTo(data, HKT).departure_at, legTo(data, HKT).arrival_at]).toEqual(["2026-11-26T09:30", "2026-11-26T10:55"]);
    // another change anywhere (a night more in Phuket) leaves the clocks — and the leg still follows its hop's day
    data = commit(data, { trip: { ...data.trip, nights: 10 }, cities: data.cities.map((c, i) => (i === 0 ? { ...c, nights: 2 } : c)) });
    expect([legTo(data, HKT).departure_at, legTo(data, HKT).arrival_at]).toEqual(["2026-11-27T09:30", "2026-11-27T10:55"]);
    // a day typed by hand is the agent's: it stays where they put it
    data = commit(data, { flights: changeLeg(data, AIRPORTS, id, { date: "2026-11-28" }, hop) });
    data = commit(data, { cities: data.cities.map((c, i) => (i === 0 ? { ...c, nights: 1 } : c)) });
    expect(legTo(data, HKT).departure_at).toBe("2026-11-28T09:30");
    // and is said on the hop as a day that is not the move's
    expect(legGaps(legTo(data, HKT), false, [legTo(data, HKT)])).toEqual(["day"]);
  });

  it("(2) a number — typed or looked up — is its own leg's; none is copied from another leg or the international flights", () => {
    let data = thailand();
    // the international flights ticketed: the domestic legs written after still carry no number
    data = commit(data, {
      scope: { ...data.scope, flights_intl: true },
      flights: [
        { ...emptyFlight("outbound"), flight_no: "SV100", from_airport: "MED", to_airport: BKK_AIRPORT, to_city: BKK, departure_at: "2026-11-25T01:00" },
        ...data.flights,
        { ...emptyFlight("inbound"), flight_no: "SV101", from_airport: BKK_AIRPORT, from_city: BKK, to_airport: "MED", departure_at: "2026-12-04T15:00" },
      ],
    });
    expect(dom(data).map((f) => f.flight_no)).toEqual(["", ""]);
    // typed on one leg
    const [a, b] = dom(data);
    data = commit(data, { flights: changeLeg(data, AIRPORTS, a.id!, { flight_no: "TG201" }, { from: BKK, to: HKT }) });
    expect(dom(data).map((f) => f.flight_no)).toEqual(["TG201", ""]);
    // looked up on the other
    const hit = { airline: "", flight_iata: "PG272", from_iata: "HKT", from_airport: "", from_tz: null, to_iata: "BKK", to_airport: "", to_tz: null, departure_at: "2026-10-24T13:00", arrival_at: "2026-10-24T14:25", schedule_date: "2026-10-24", terminal: null };
    const out = applyFlightHit({ ...dom(data)[1], flight_no: "PG272" }, hit, { airports: AIRPORTS, airlines: [], trip: data.trip });
    data = commit(data, { flights: data.flights.map((f) => (f.id === b.id ? out.leg : f)) });
    expect(dom(data).map((f) => f.flight_no)).toEqual(["TG201", "PG272"]);
    // two legs that came back from a save under one id are two legs: a number typed on one stays on it
    const twins = normalizeDraftData(JSON.parse(JSON.stringify({ ...data, flights: data.flights.map((f) => (f.leg_order === "internal" ? { ...f, id: "leg-1", flight_no: "" } : f)) })));
    expect(new Set(twins.flights.map((f) => f.id)).size).toBe(twins.flights.length);
    const typed = changeLeg(twins, AIRPORTS, dom(twins)[0].id!, { flight_no: "TG201" });
    expect(typed.filter((f) => f.leg_order === "internal").map((f) => f.flight_no)).toEqual(["TG201", ""]);
  });

  it("a hop by air from a city with no airport of its own still gets its leg — the airport asked for, not the flight dropped", () => {
    let data = thailand();
    // «طيران» picked from a city the airport list does not link (Selangor, flown from KUL, in the Malaysia file)
    data = commit(data, { cities: data.cities.map((c, i) => (i === 1 ? { ...c, city_name: "كرابي" } : c)), hotels: data.hotels.map((h) => (h.city_name === HKT ? { ...h, city_name: "كرابي", city_key: "كرابي#1" } : h)) });
    const hops = { ...data.transport_plan.intercity.hop_modes, [`${BKK}>كرابي`]: "flight" as const, [`كرابي>${BKK}`]: "flight" as const };
    data = commit(data, { transport_plan: { ...data.transport_plan, intercity: { ...data.transport_plan.intercity, hop_modes: hops } } });
    const leg = dom(data)[0];
    expect([leg.from_airport, leg.to_airport, leg.departure_at]).toEqual([BKK_AIRPORT, "", "2026-11-26T00:00"]);
    expect(legGaps(leg, true)).toEqual(["to", "price"]);
    // picked on the hop, it stays that hop's leg
    data = commit(data, { flights: changeLeg(data, AIRPORTS, leg.id!, { to_airport: HKT_AIRPORT }, { from: BKK, to: "كرابي" }) });
    expect(dom(data).map((f) => [f.from_airport, f.to_airport, f.to_city, f.auto])).toEqual([
      [BKK_AIRPORT, HKT_AIRPORT, "كرابي", true],
      ["", BKK_AIRPORT, BKK, true],
    ]);
  });
});

describe("1c — a leg's price is «للفرد», times the travellers", () => {
  const priced = (data: DraftData, prices: number[]) =>
    prices.reduce((d, price, k) => commit(d, { flights: changeLeg(d, AIRPORTS, dom(d)[k].id!, { price }) }), data);

  it("300 + 300 for two adults is 1,200 — and follows the travellers", () => {
    const data = priced(thailand(), [300, 300]);
    expect([data.flight_booking.dom_price, data.flight_booking.dom_fare.price_mode, data.flight_booking.dom_fare.adult_price]).toEqual([1200, "per_person", 600]);
    expect(withFlightTotals(data.flight_booking, { ...data.trip, adults: 3 }).dom_price).toBe(1800);
    // the pricing sheet says how
    const line = suggestPricing(data, { transfers: [], services: [], rooms: [], fleet: [] }, { hotel: "فندق", airline: "طيران" }).find((i) => i.ref === "flight:dom")!;
    expect([line.sell_price, line.description]).toEqual([1200, "تذاكر داخلية: 2 بالغ × 600"]);
  });

  it("a hop switched to road takes its leg's ticket with it; the last one gone leaves the booking unpriced", () => {
    let data = priced(thailand(), [300, 250]);
    const road = (d: DraftData, key: string) => ({ ...d.transport_plan, intercity: { ...d.transport_plan.intercity, hop_modes: { ...d.transport_plan.intercity.hop_modes, [key]: "car" as const } } });
    data = commit(data, { transport_plan: road(data, `${HKT}>${BKK}`) });
    expect(data.flight_booking.dom_price).toBe(600);
    data = commit(data, { transport_plan: road(data, `${BKK}>${HKT}`) });
    expect([dom(data).length, data.flight_booking.dom_price]).toEqual([0, null]);
  });

  it("a file from before keeps its total until a leg's price is typed again", () => {
    const old = thailand();
    old.flights = old.flights.map((f) => (f.leg_order === "internal" ? { ...f, price: 300 } : f));
    old.flight_booking = { ...old.flight_booking, dom_price: 600 };
    expect(commit(old).flight_booking.dom_price).toBe(600);
    expect(priced(old, [350]).flight_booking.dom_price).toBe(1300);
  });
});

describe("2a — a move by air: seen off from A's hotel, met at B's airport", () => {
  it("in the plan (the transfer rows) and on the day the PDF prints, naming both cities", () => {
    const data = normalizeDraftData(JSON.parse(JSON.stringify(thailand())));
    const rows = data.transport.map((r) => `${r.date} ${r.from_place} → ${r.to_place}`);
    expect(rows).toEqual(
      expect.arrayContaining([`2026-11-26 فندق ${BKK} → المطار`, `2026-11-26 المطار → فندق ${HKT}`, `2026-12-03 فندق ${HKT} → المطار`, `2026-12-03 المطار → فندق ${BKK}`]),
    );
    const note = (date: string) => draftTransportNote(data, data.days, data.days.findIndex((d) => d.date === date));
    // the day is printed under Phuket: «من الفندق» alone read as Phuket's hotel
    expect(note("2026-11-26")).toMatch(new RegExp(`^التوصيل من فندق ${BKK} إلى المطار — سيارة صغيرة · .*الاستقبال في مطار ${HKT} والتوصيل إلى الفندق`));
    expect(note("2026-12-03")).toMatch(new RegExp(`^التوصيل من فندق ${HKT} إلى المطار`));
  });

  it("«بكج متقدم» rewords the trip's farewell, never the last flight hop's", () => {
    const data = thailand();
    const adv = normalizeDraftData({ advanced: { on: true } }).advanced!;
    const on = { ...data, advanced: { ...adv, on: true, parts: { arrival: false, departure: true }, farewell: { ...adv.farewell, kind: "self" as const } } };
    const rows = normalizeDraftData(JSON.parse(JSON.stringify(on))).transport.map((r) => `${r.from_place} → ${r.to_place} ${r.date ?? ""}`.trim());
    // Phuket's hotel to the airport on the 3rd stays; the way home (by the client) goes
    expect(rows).toContain(`فندق ${HKT} → المطار 2026-12-03`);
    expect(rows.filter((r) => r === `فندق ${BKK} → المطار`)).toEqual([]);
  });
});

describe("2b — several hotels in one city: a transfer on each hotel-change day", () => {
  it("Phuket's three hotels: a move on the 27th and on the 30th, priced from the transfer list, said on the day", () => {
    const data = normalizeDraftData(JSON.parse(JSON.stringify(thailand())));
    const moves = cityServices(data, 1).filter((s) => s.id.startsWith("hotel:"));
    expect(moves.map((s) => [s.kind, s.date, s.text, s.car_type])).toEqual([
      ["transfer", "2026-11-27", "الانتقال من فندق منتجع باء إلى فندق جيم", "سيارة صغيرة"],
      ["transfer", "2026-11-30", "الانتقال من فندق جيم إلى فندق هاء", "سيارة صغيرة"],
    ]);
    // the same price source as every transfer: the list's ride inside the city
    const reference: PricingReference = { transfers: [{ from_city: HKT, to_city: HKT, car_type: "سيارة صغيرة", price: 500, currency: "THB" }], services: [], rooms: [], fleet: [] };
    const lines = suggestPricing(data, reference, { hotel: "فندق", airline: "طيران" }).filter((i) => i.ref?.startsWith("transport:hotel:"));
    expect(lines.map((i) => [i.sell_price, i.sell_currency, i.description])).toEqual([
      [500, "THB", "الانتقال من فندق منتجع باء إلى فندق جيم (سيارة صغيرة)"],
      [500, "THB", "الانتقال من فندق جيم إلى فندق هاء (سيارة صغيرة)"],
    ]);
    const note = (date: string) => draftTransportNote(data, data.days, data.days.findIndex((d) => d.date === date));
    expect(note("2026-11-27")).toContain("الانتقال من فندق منتجع باء إلى فندق جيم — سيارة صغيرة");
    expect(note("2026-11-28")).toBeNull();
  });

  it("no move for a room change in the same hotel, nor for a city of one hotel", () => {
    const data = thailand();
    const same = { ...data, hotels: data.hotels.map((h) => (h.id === "stay-b2" ? { ...h, hotel_name: "منتجع باء" } : h)) };
    expect(cityServices(same, 1).filter((s) => s.id.startsWith("hotel:")).map((s) => s.date)).toEqual(["2026-11-30"]);
    expect(cityServices(data, 0).some((s) => s.id.startsWith("hotel:"))).toBe(false);
  });
});

describe("the cities rebuilt from the flights keep their tours to their nights − 1 (the arrival day is free)", () => {
  it("a city cut to one night by the flights keeps no tour on its arrival day", () => {
    const data = thailand();
    const outbound = { ...emptyFlight("outbound"), from_airport: "MED", to_airport: BKK_AIRPORT, to_city: BKK, departure_at: "2026-11-25T01:00", arrival_at: "2026-11-25T09:00" };
    const inbound = { ...emptyFlight("inbound"), from_airport: BKK_AIRPORT, from_city: BKK, to_airport: "MED", departure_at: "2026-12-04T15:00" };
    const cities = data.cities.map((c, i) => (i === 1 ? { ...c, from_flight: true, tours: 3 } : c));
    // the flights now leave Phuket on the 27th: one night there
    const flights = [outbound, ...dom(data).map((f) => (f.to_city === BKK ? { ...f, departure_at: "2026-11-27T10:00" } : f)), inbound];
    const built = withCitiesFromFlights({ ...data, cities, flights })!;
    expect(built.cities.find((c) => c.city_name === HKT)).toMatchObject({ nights: 1, tours: 0 });
  });
});
