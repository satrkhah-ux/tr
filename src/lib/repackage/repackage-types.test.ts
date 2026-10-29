import { describe, expect, it } from "vitest";
import {
  addedFlights,
  additionLine,
  additionsTotal,
  clientTotal,
  emptyExtractedPackage,
  emptyRepackageData,
  hasCustomer,
  keyHotels,
  normalizeRepackageData,
  packageStays,
  packageStops,
  printableAdditions,
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

const CLIENT = { customer_name: "خالد", customer_phone: "0551234567" };

describe("validation — the client's details come first", () => {
  const ready = (pkg: ExtractedPackage, customer = CLIENT): RepackageData => ({
    ...emptyRepackageData(),
    customer,
    extracted: pkg,
    confidence: { country: 1, cities: 1, trip_nights: 1, hotels: 1, supplier_total: 1 },
    final_total: 5000,
  });
  const reviewKeys = (pkg: ExtractedPackage, customer = CLIENT) =>
    validateRepackage(ready(pkg, customer)).blocking.filter((i) => i.stage === "review").map((i) => i.key);

  it("passes a complete package", () => {
    const v = validateRepackage(ready(georgia()));
    expect(v.ok).toBe(true);
    expect(v.reviewClear).toBe(true);
  });

  it("stops on /review without the name, phone, arrival or departure", () => {
    const empty = georgia({ arrival_date: null, departure_date: null });
    const none = { customer_name: " ", customer_phone: "" };
    expect(reviewKeys(empty, none)).toEqual(["pg.warn.noName", "pg.warn.noPhone", "pg.err.noArrival", "rp.err.noDeparture"]);
    expect(validateRepackage(ready(empty, none)).reviewClear).toBe(false);
  });

  it("the client is the file's own (data.customer): what the supplier's file named does not stand in for it", () => {
    // the package carries a name from the file, the file itself has no client linked: the issue still waits for one
    const v = validateRepackage({ ...ready(georgia(), { customer_name: "", customer_phone: "" }), extracted: georgia({ customer_name: "من ملف المورّد", customer_phone: "0500000000" }) });
    expect(v.blocking.map((i) => i.key)).toEqual(["pg.warn.noName", "pg.warn.noPhone"]);
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
      customer: CLIENT,
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

describe("the client of a repackage — known from the start, one place", () => {
  it("a new file carries an empty client, and a typed one survives a save and a reload", () => {
    expect(emptyRepackageData().customer).toEqual({ customer_name: "", customer_phone: "" });
    const typed = { ...emptyRepackageData(), customer: CLIENT };
    const again = normalizeRepackageData(JSON.parse(JSON.stringify(typed)));
    expect(again.customer).toEqual(CLIENT);
    expect(normalizeRepackageData(again as unknown as Record<string, unknown>)).toEqual(again);
  });

  it("a file saved before the client was asked up front keeps the one its import carried", () => {
    const old = { extracted: georgia() } as unknown as Record<string, unknown>;
    expect(normalizeRepackageData(old).customer).toEqual(CLIENT);
    // …and once a client is stored, the package's own fields no longer decide
    const stored = { customer: { customer_name: "سالم", customer_phone: "0500000001" }, extracted: georgia() } as unknown as Record<string, unknown>;
    expect(normalizeRepackageData(stored).customer).toEqual({ customer_name: "سالم", customer_phone: "0500000001" });
  });

  it("hasCustomer: a name or a phone is enough to be linked", () => {
    expect(hasCustomer({ customer_name: "", customer_phone: "" })).toBe(false);
    expect(hasCustomer({ customer_name: " ", customer_phone: " " })).toBe(false);
    expect(hasCustomer({ customer_name: "خالد", customer_phone: "" })).toBe(true);
    expect(hasCustomer({ customer_name: "", customer_phone: "055" })).toBe(true);
  });
});

describe("«إضافات» — the agent's additions, sell-only", () => {
  const withAdditions = (additions: RepackageData["additions"], over: Partial<RepackageData> = {}): RepackageData => ({
    ...emptyRepackageData(),
    customer: CLIENT,
    extracted: georgia(),
    confidence: { country: 1, cities: 1, trip_nights: 1, hotels: 1, supplier_total: 1 },
    final_total: 5000,
    additions,
    ...over,
  });
  const line = (title: string, sell_price: number | null, detail = "") => ({ id: `a-${title}`, title, detail, sell_price });

  it("prints «عنوان — تفصيل», and only the lines that have a title", () => {
    expect(additionLine({ title: " جولة المدينة ", detail: " نصف يوم " })).toBe("جولة المدينة — نصف يوم");
    expect(additionLine({ title: "شريحة اتصال", detail: "" })).toBe("شريحة اتصال");
    expect(printableAdditions(withAdditions([line("جولة", 100), line(" ", null)])).map((a) => a.title)).toEqual(["جولة"]);
  });

  it("the client pays the package's price plus the priced additions — an unpriced one adds nothing", () => {
    const data = withAdditions([line("جولة", 150.5), line("شريحة", null), line("تأمين", 49.5)]);
    expect(additionsTotal(data)).toBe(200);
    expect(clientTotal(data)).toBe(5200);
    // no package price yet → no total to add to
    expect(clientTotal(withAdditions([line("جولة", 100)], { final_total: null }))).toBeNull();
    // cents never drift
    expect(clientTotal(withAdditions([line("أ", 0.1), line("ب", 0.2)], { final_total: 1 }))).toBe(1.3);
  });

  it("a price with no title blocks the issue on /edit; a priced addition never touches the supplier-cost floor", () => {
    const v = validateRepackage(withAdditions([line("", 100)]));
    expect(v.blocking.map((i) => [i.stage, i.key])).toEqual([["edit", "rp.err.additionNoTitle"]]);
    // the floor is the package's own: 5000 against a 5000 cost passes, with or without additions
    const floor = validateRepackage(withAdditions([line("جولة", 100)], { extracted: georgia({ supplier_total: 5000 }) }));
    expect(floor.ok).toBe(true);
    expect(validateRepackage(withAdditions([], { extracted: georgia({ supplier_total: 5001 }) })).blocking.map((i) => i.key)).toEqual(["rp.err.priceBelowCost"]);
  });

  it("survives a save and a reload; a negative price is no price; a missing id is given one", () => {
    const stored = normalizeRepackageData({ additions: [{ title: "جولة", detail: "x", sell_price: -5 }, { id: "keep", title: "تأمين", sell_price: 20 }, null] } as unknown as Record<string, unknown>);
    expect(stored.additions.map((a) => [a.id, a.title, a.sell_price])).toEqual([["add-1", "جولة", null], ["keep", "تأمين", 20], ["add-3", "", null]]);
    expect(normalizeRepackageData(stored as unknown as Record<string, unknown>)).toEqual(stored);
  });

  it("flights the agent typed are told apart from the supplier's, and stay told apart", () => {
    const own = { airline: "SV", flight_no: "SV123", from_airport: "RUH", to_airport: "TBS", departure_at: "2026-10-19T04:20", arrival_at: null, added: true as const };
    const theirs = { ...own, flight_no: "X1", added: undefined };
    const pkg = normalizeRepackageData({ extracted: georgia({ flights: [theirs as never, own] }) } as unknown as Record<string, unknown>).extracted!;
    expect(addedFlights(pkg).map((f) => f.flight_no)).toEqual(["SV123"]);
    expect("added" in pkg.flights[0]).toBe(false);
  });
});
