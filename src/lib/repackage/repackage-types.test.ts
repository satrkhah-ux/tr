import { describe, expect, it } from "vitest";
import {
  emptyExtractedPackage,
  emptyRepackageData,
  keyHotels,
  normalizeRepackageData,
  packageStays,
  packageStops,
  splitVisitNights,
  visitNightsGaps,
  withArrival,
  withDeparture,
  type ExtractedHotel,
  type ExtractedPackage,
  type RepackageData,
} from "./repackage-types";
import { validateRepackage } from "./repackage-validation";

const hotel = (city_name: string, hotel_name: string): ExtractedHotel => ({
  city_name, hotel_name, room_type: "", board: "", nights: null, check_in: null, check_out: null,
});

/** تبليسي → كازبيجي → تبليسي, a different hotel on each visit — as the reader stores it (no keys). */
function georgia(over: Partial<ExtractedPackage> = {}): ExtractedPackage {
  return {
    ...emptyExtractedPackage(),
    customer_name: "خالد",
    customer_phone: "0551234567",
    country: "جورجيا",
    destination: "جورجيا",
    cities: [
      { city_name: "تبليسي", nights: 2 },
      { city_name: "كازبيجي", nights: 1 },
      { city_name: "تبليسي", nights: 2 },
    ],
    trip_nights: 5,
    arrival_date: "2026-10-19",
    departure_date: "2026-10-24",
    hotels: [hotel("تبليسي", "Twenties"), hotel("كازبيجي", "Rooms Kazbegi"), hotel("تبليسي", "High Garden")],
    ...over,
  };
}

const stayRows = (pkg: ExtractedPackage) =>
  packageStays(pkg).map((s) => [s.city_name, s.hotel?.hotel_name ?? null, s.check_in, s.check_out]);

describe("a city visited twice keeps a hotel per visit", () => {
  const expected = [
    ["تبليسي", "Twenties", "2026-10-19", "2026-10-21"],
    ["كازبيجي", "Rooms Kazbegi", "2026-10-21", "2026-10-22"],
    ["تبليسي", "High Garden", "2026-10-22", "2026-10-24"],
  ];

  it("pairs the second تبليسي with the second hotel, not the first", () => {
    expect(stayRows(georgia())).toEqual(expected);
  });

  it("holds when the supplier lists a city's hotels together", () => {
    const grouped = georgia({
      hotels: [hotel("تبليسي", "Twenties"), hotel("تبليسي", "High Garden"), hotel("كازبيجي", "Rooms Kazbegi")],
    });
    expect(stayRows(grouped)).toEqual(expected);
  });

  it("follows the employee's choice of visit over the order", () => {
    const keyed = normalizeRepackageData({ extracted: georgia() } as unknown as Record<string, unknown>).extracted!;
    const [first, kaz, second] = keyed.hotels;
    // swapped on purpose in review: High Garden first, Twenties on the way back
    const swapped = { ...keyed, hotels: [{ ...first, city_key: second.city_key }, kaz, { ...second, city_key: first.city_key }] };
    expect(stayRows(swapped).map((r) => r[1])).toEqual(["High Garden", "Rooms Kazbegi", "Twenties"]);
  });

  it("keeps the old positional pairing for a hotel whose city is not on the list", () => {
    const keys = keyHotels([{ city_name: "أ", nights: 1 }, { city_name: "ب", nights: 1 }], [hotel("", "x"), hotel("", "y")]);
    expect(keys.map((h) => h.city_key)).toEqual(["أ#1", "ب#1"]);
  });
});

describe("normalize — an old stored package opens as it was", () => {
  const stored = { extracted: georgia() } as unknown as Record<string, unknown>;
  const once = normalizeRepackageData(stored);

  it("writes a key per stop and per hotel without touching the facts", () => {
    expect(once.extracted!.cities.map((c) => c.key)).toEqual(["تبليسي#1", "كازبيجي#1", "تبليسي#2"]);
    expect(once.extracted!.hotels.map((h) => h.city_key)).toEqual(["تبليسي#1", "كازبيجي#1", "تبليسي#2"]);
    expect(once.extracted!.hotels.map((h) => h.hotel_name)).toEqual(["Twenties", "Rooms Kazbegi", "High Garden"]);
  });

  it("is stable when read again (saved and reloaded)", () => {
    const twice = normalizeRepackageData(once as unknown as Record<string, unknown>);
    expect(twice).toEqual(once);
  });

  it("reads a package saved before the client fields existed", () => {
    const { customer_name, customer_phone, ...old } = georgia();
    void customer_name; void customer_phone;
    const pkg = normalizeRepackageData({ extracted: old } as unknown as Record<string, unknown>).extracted!;
    expect([pkg.customer_name, pkg.customer_phone]).toEqual(["", ""]);
  });
});

describe("the travel dates", () => {
  it("a new arrival moves the departure and the supplier's flights with it", () => {
    const pkg = georgia({
      flights: [{ airline: "X", flight_no: "X1", from_airport: "MED", to_airport: "TBS", departure_at: "2026-10-19T04:20", arrival_at: "2026-10-19T08:00" }],
    });
    const moved = withArrival(pkg, "2026-11-02");
    expect(moved.departure_date).toBe("2026-11-07");
    expect(moved.flights![0].departure_at).toBe("2026-11-02T04:20");
    expect(moved.flights![0].arrival_at).toBe("2026-11-02T08:00");
  });

  it("a typed departure re-measures the nights", () => {
    expect(withDeparture(georgia(), "2026-10-26")).toEqual({ departure_date: "2026-10-26", trip_nights: 7 });
  });
});

describe("validation — the client's details come first", () => {
  const ready = (pkg: ExtractedPackage): RepackageData => ({
    ...emptyRepackageData(),
    extracted: pkg,
    confidence: { country: 1, cities: 1, trip_nights: 1, hotels: 1, supplier_total: 1 },
    final_total: 5000,
  });
  const reviewKeys = (pkg: ExtractedPackage) =>
    validateRepackage(ready(pkg)).blocking.filter((i) => i.stage === "review").map((i) => i.key);

  it("passes a complete package", () => {
    const v = validateRepackage(ready(georgia()));
    expect(v.ok).toBe(true);
    expect(v.reviewClear).toBe(true);
  });

  it("stops on /review without the name, phone, arrival or departure", () => {
    const empty = georgia({ customer_name: " ", customer_phone: "", arrival_date: null, departure_date: null });
    expect(reviewKeys(empty)).toEqual(["pg.warn.noName", "pg.warn.noPhone", "pg.err.noArrival", "rp.err.noDeparture"]);
    expect(validateRepackage(ready(empty)).reviewClear).toBe(false);
  });

  it("blocks a departure that is not arrival + the package's nights", () => {
    expect(reviewKeys(georgia({ departure_date: "2026-10-25" }))).toEqual(["rp.err.datesNights"]);
    expect(reviewKeys(georgia({ departure_date: "2026-10-18" }))).toEqual(["rp.err.departureBeforeArrival"]);
  });
});

/** The London import (dea0143d): one 5-night stop, two hotels — the second used to be dropped. */
function london(nights: [number | null, number | null], over: Partial<ExtractedPackage> = {}): ExtractedPackage {
  return {
    ...emptyExtractedPackage(),
    customer_name: "خالد",
    customer_phone: "0551234567",
    country: "المملكة المتحدة",
    destination: "لندن",
    cities: [{ city_name: "لندن", nights: 5 }],
    trip_nights: 5,
    arrival_date: "2026-12-26",
    departure_date: "2026-12-31",
    hotels: [
      { ...hotel("لندن", "DoubleTree by Hilton Hotel London ExCel"), board: "شامل الافطار", nights: nights[0] },
      { ...hotel("لندن", "Park Plaza London Waterloo"), board: "شامل الافطار", nights: nights[1] },
    ],
    ...over,
  };
}

describe("several hotels in one visit", () => {
  it("shares a visit's nights evenly, the remainder on the last", () => {
    expect(splitVisitNights(5, [null, null])).toEqual([2, 3]);
    expect(splitVisitNights(7, [null, null, null])).toEqual([2, 2, 3]);
    expect(splitVisitNights(5, [1, null])).toEqual([1, 4]);
    expect(splitVisitNights(5, [3, 2])).toEqual([3, 2]);
  });

  it("publishes every hotel, chained inside the visit by its own nights", () => {
    expect(stayRows(london([3, 2]))).toEqual([
      ["لندن", "DoubleTree by Hilton Hotel London ExCel", "2026-12-26", "2026-12-29"],
      ["لندن", "Park Plaza London Waterloo", "2026-12-29", "2026-12-31"],
    ]);
    expect(packageStays(london([3, 2])).map((s) => [s.nights, s.board_type, s.stop])).toEqual([[3, "BB", 0], [2, "BB", 0]]);
  });

  it("splits the visit when the hotels do not say their nights", () => {
    expect(packageStays(london([null, null])).map((s) => [s.nights, s.check_in, s.check_out])).toEqual([
      [2, "2026-12-26", "2026-12-28"],
      [3, "2026-12-28", "2026-12-31"],
    ]);
    expect(visitNightsGaps(london([null, null]))).toEqual([]);
  });

  it("flags hotels whose nights do not fill the visit — the import as read (4 + 2 for 5)", () => {
    expect(visitNightsGaps(london([4, 2]))).toEqual([{ city_name: "لندن", nights: 5, sum: 6 }]);
    const v = validateRepackage({
      ...emptyRepackageData(),
      extracted: london([4, 2]),
      confidence: { country: 1, cities: 1, trip_nights: 1, hotels: 1, supplier_total: 1 },
      final_total: 5000,
    });
    expect(v.blocking.map((i) => [i.key, i.params])).toEqual([["rp.err.visitHotelNights", { city: "لندن", nights: 5, sum: 6 }]]);
    expect(v.reviewClear).toBe(false);
  });

  it("starts the next visit when this one's nights end, whatever its hotels add up to", () => {
    const pkg = london([4, 2], {
      cities: [{ city_name: "لندن", nights: 5 }, { city_name: "مانشستر", nights: 2 }],
      trip_nights: 7,
      hotels: [...london([4, 2]).hotels, hotel("مانشستر", "Midland")],
    });
    expect(stayRows(pkg).at(-1)).toEqual(["مانشستر", "Midland", "2026-12-31", "2027-01-02"]);
  });

  it("tells the review each hotel's place and nights", () => {
    expect(packageStops(london([null, null])).map((s) => [s.city_name, s.nights, s.hotels.map((h) => [h.index, h.nights])])).toEqual([
      ["لندن", 5, [[0, 2], [1, 3]]],
    ]);
  });

  it("leaves a one-hotel visit on the visit's nights, as before", () => {
    const one = london([4, null], { hotels: [london([4, null]).hotels[0]] });
    expect(packageStays(one).map((s) => [s.nights, s.check_out])).toEqual([[5, "2026-12-31"]]);
    expect(visitNightsGaps(one)).toEqual([]);
  });
});
