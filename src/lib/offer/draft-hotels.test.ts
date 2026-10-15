import { describe, expect, it } from "vitest";
import {
  addStay,
  cityKeys,
  deriveCityDates,
  deriveHotelStays,
  hotelCoverage,
  newCityKey,
  normalizeDraftData,
  normalizeDraftHotel,
  pricingRefFor,
  resizeRooms,
  stayOutsideCity,
  type DraftCity,
  type DraftHotel,
} from "./draft-types";
import { suggestPricing } from "./pricing-suggest";

/**
 * Splitting a city's nights across hotels.
 *
 * The thing worth testing is the arithmetic nobody does out loud: which hotel
 * gets which dates, and whether the nights add up. A stay whose check-out does
 * not equal the next stay's check-in is a guest standing in a lobby with no
 * room, and it looks completely fine in the UI.
 */

const city = (city_name: string, nights: number, check_in: string | null): DraftCity => ({
  city_name,
  nights,
  check_in,
  check_out: null,
});

const hotel = (city_name: string, hotel_name: string, nights = 0): DraftHotel =>
  normalizeDraftHotel({ city_name, hotel_name, nights });

describe("deriveHotelStays", () => {
  it("chains dates inside a city — check-out is the next check-in, exactly", () => {
    const cities = [city("باكو", 4, "2026-08-01")];
    const hotels = [hotel("باكو", "فندق أ", 2), hotel("باكو", "فندق ب", 2)];

    const stays = deriveHotelStays(cities, hotels);

    expect(stays).toHaveLength(2);
    expect(stays[0]).toMatchObject({ check_in: "2026-08-01", check_out: "2026-08-03", nights: 2 });
    expect(stays[1]).toMatchObject({ check_in: "2026-08-03", check_out: "2026-08-05", nights: 2 });
  });

  it("gives a line with no nights of its own whatever the city has left", () => {
    // This is every pre-existing single-hotel line: nights was never a field.
    const stays = deriveHotelStays([city("تبليسي", 5, "2026-09-10")], [hotel("تبليسي", "قديم")]);
    expect(stays[0]).toMatchObject({ nights: 5, check_in: "2026-09-10", check_out: "2026-09-15" });
  });

  it("splits the remainder rather than losing it — 3 nights over 2 blanks is 2 + 1", () => {
    const stays = deriveHotelStays([city("باكو", 3, "2026-08-01")], [hotel("باكو", "أ"), hotel("باكو", "ب")]);
    expect(stays.map((s) => s.nights)).toEqual([1, 2]);
    expect(stays[0].nights + stays[1].nights).toBe(3);
    expect(stays[1].check_out).toBe("2026-08-04");
  });

  it("keeps cities in sequence, so the second city starts where the first ended", () => {
    const cities = [city("باكو", 2, "2026-08-01"), city("قبالا", 2, "2026-08-03")];
    const stays = deriveHotelStays(cities, [hotel("باكو", "أ"), hotel("قبالا", "ب")]);
    expect(stays[0].check_out).toBe("2026-08-03");
    expect(stays[1].check_in).toBe("2026-08-03");
  });

  it("still yields the stays when the trip has no dates yet", () => {
    // The stage has to render before a flight is entered.
    const stays = deriveHotelStays([city("باكو", 3, null)], [hotel("باكو", "أ")]);
    expect(stays).toHaveLength(1);
    expect(stays[0].check_in).toBeNull();
    expect(stays[0].nights).toBe(3);
  });
});

describe("hotelCoverage", () => {
  it("reports a short city instead of calling it complete", () => {
    const [cov] = hotelCoverage([city("باكو", 4, "2026-08-01")], [hotel("باكو", "أ", 2)]);
    expect(cov).toMatchObject({ needed: 4, covered: 2 });
  });

  it("counts a city with no hotel at all as zero, not as missing data", () => {
    const [cov] = hotelCoverage([city("باكو", 3, "2026-08-01")], []);
    expect(cov).toMatchObject({ needed: 3, covered: 0, stays: [] });
  });

  it("reports over-allocation too — 5 nights booked into a 4-night city", () => {
    const [cov] = hotelCoverage([city("باكو", 4, "2026-08-01")], [hotel("باكو", "أ", 3), hotel("باكو", "ب", 2)]);
    expect(cov.covered).toBe(5);
    expect(cov.covered).toBeGreaterThan(cov.needed);
  });
});

describe("pricingRefFor", () => {
  it("uses the stay id once there is one", () => {
    const line = hotel("باكو", "فندق أ", 2);
    expect(pricingRefFor({ line, city_name: "باكو" })).toBe(line.id);
  });

  it("falls back to the old description so pre-existing items keep matching", () => {
    const legacy = { ...hotel("باكو", "فندق أ", 2), id: "" };
    expect(pricingRefFor({ line: legacy, city_name: "باكو" })).toBe("باكو — فندق أ");
  });
});

describe("normalizeDraftHotel", () => {
  it("gives an old line an id and leaves its nights unclaimed", () => {
    const line = normalizeDraftHotel({ city_name: "باكو", hotel_name: "قديم", rooms_count: 2 });
    expect(line.id).toMatch(/^stay-/);
    expect(line.nights).toBe(0);
    expect(line.rooms).toHaveLength(2);
  });

  it("does not renumber a line that already has an id", () => {
    const line = normalizeDraftHotel({ id: "stay-keepme", city_name: "باكو", nights: 3 });
    expect(line.id).toBe("stay-keepme");
    expect(line.nights).toBe(3);
  });
});

// ---------- order 1 (v4): two or more hotels in one city ----------

const keyed = (key: string, city_name: string, nights: number, check_in: string | null): DraftCity => ({ ...city(city_name, nights, check_in), key });
const line = (over: Partial<DraftHotel>): DraftHotel => normalizeDraftHotel({ city_name: "كوالالمبور", nights: 0, ...over });
const span = (s: { check_in: string | null; check_out: string | null; nights: number }) => [s.check_in, s.check_out, s.nights];

describe("deriveHotelStays — after, same, custom", () => {
  it("A three nights then B two (acceptance أ): 5/5, chained dates", () => {
    const cities = [city("كوالالمبور", 5, "2026-10-20")];
    const a = line({ hotel_name: "A", nights: 3 });
    const added = addStay(cities, [a], 0, "after");
    const stays = deriveHotelStays(cities, added.hotels);
    expect(stays.map(span)).toEqual([
      ["2026-10-20", "2026-10-23", 3],
      ["2026-10-23", "2026-10-25", 2],
    ]);
    expect(hotelCoverage(cities, added.hotels)[0]).toMatchObject({ needed: 5, covered: 5, extra: 0 });
  });

  it("A two rooms and B one on the same dates (acceptance ب): 4/4, not 8/4", () => {
    const cities = [city("كوالالمبور", 4, "2026-10-20")];
    const a = resizeRooms(line({ hotel_name: "A", refundable: false }), 2);
    const { hotels, id } = addStay(cities, [a], 0, "same");
    const b = hotels.find((h) => h.id === id)!;
    expect([b.dates, b.rooms.length, b.refundable, b.rooms[0].price]).toEqual(["same", 1, false, null]);
    const stays = deriveHotelStays(cities, hotels);
    expect(stays.map(span)).toEqual([
      ["2026-10-20", "2026-10-24", 4],
      ["2026-10-20", "2026-10-24", 4],
    ]);
    expect(stays[1].same_as?.id).toBe(a.id);
    expect(hotelCoverage(cities, hotels)[0]).toMatchObject({ needed: 4, covered: 4, extra: 0 });
  });

  it("a same-dates stay follows the stay before it, and moves nothing after it", () => {
    const cities = [city("كوالالمبور", 5, "2026-10-20")];
    const hotels = [line({ hotel_name: "A", nights: 3 }), line({ hotel_name: "B", dates: "same" }), line({ hotel_name: "C" })];
    expect(deriveHotelStays(cities, hotels).map(span)).toEqual([
      ["2026-10-20", "2026-10-23", 3],
      ["2026-10-20", "2026-10-23", 3],
      ["2026-10-23", "2026-10-25", 2],
    ]);
  });

  it("reads «same» with nothing before it as «after», and «custom» without a date as «after»", () => {
    const cities = [city("كوالالمبور", 4, "2026-10-20")];
    const [first] = deriveHotelStays(cities, [line({ hotel_name: "A", dates: "same" })]);
    expect([first.dates, ...span(first)]).toEqual(["after", "2026-10-20", "2026-10-24", 4]);
    const [undated] = deriveHotelStays(cities, [line({ hotel_name: "A", dates: "custom", nights: 2 })]);
    expect(undated.dates).toBe("after");
  });

  it("puts a custom stay on its own dates inside the city (acceptance ج), and calls a night outside it «زائد»", () => {
    const cities = [city("كوالالمبور", 5, "2026-10-20")];
    const inside = [line({ hotel_name: "A" }), line({ hotel_name: "B", dates: "custom", check_in: "2026-10-21", nights: 2 })];
    const stays = deriveHotelStays(cities, inside);
    expect(span(stays[1])).toEqual(["2026-10-21", "2026-10-23", 2]);
    expect(stayOutsideCity(stays[1], cities[0])).toBe(false);
    expect(hotelCoverage(cities, inside)[0]).toMatchObject({ covered: 5, extra: 0 });

    const outside = [line({ hotel_name: "A" }), line({ hotel_name: "B", dates: "custom", check_in: "2026-10-24", nights: 2 })];
    const late = deriveHotelStays(cities, outside)[1];
    expect(stayOutsideCity(late, cities[0])).toBe(true);
    expect(hotelCoverage(cities, outside)[0]).toMatchObject({ covered: 6, extra: 1 });
    const early = deriveHotelStays(cities, [line({ hotel_name: "B", dates: "custom", check_in: "2026-10-19", nights: 1 })])[0];
    expect(stayOutsideCity(early, cities[0])).toBe(true);
  });

  it("adds a custom stay on the city's dates for the agent to narrow", () => {
    const cities = [city("كوالالمبور", 5, "2026-10-20")];
    const { hotels, id } = addStay(cities, [line({ hotel_name: "A" })], 0, "custom");
    expect(hotels.find((h) => h.id === id)).toMatchObject({ dates: "custom", check_in: "2026-10-20", nights: 5 });
  });

  it("gives each visit of a repeated city its own hotels (acceptance د)", () => {
    const cities = [
      keyed("كوالالمبور#1", "كوالالمبور", 2, "2026-10-20"),
      keyed("لنكاوي#1", "لنكاوي", 3, "2026-10-22"),
      keyed("كوالالمبور#2", "كوالالمبور", 2, "2026-10-25"),
    ];
    const hotels = [
      line({ hotel_name: "أول", city_key: "كوالالمبور#1" }),
      line({ city_name: "لنكاوي", hotel_name: "منتجع", city_key: "لنكاوي#1" }),
      line({ hotel_name: "آخر", city_key: "كوالالمبور#2" }),
    ];
    const stays = deriveHotelStays(cities, hotels);
    expect(stays.map((s) => [s.city_index, s.line.hotel_name, s.check_in])).toEqual([
      [0, "أول", "2026-10-20"],
      [1, "منتجع", "2026-10-22"],
      [2, "آخر", "2026-10-25"],
    ]);
    expect(hotelCoverage(cities, hotels).map((c) => [c.covered, c.needed])).toEqual([
      [2, 2],
      [3, 3],
      [2, 2],
    ]);
  });

  it("keeps an older line (no key) on every visit of its city by name, and a line whose stop is gone too", () => {
    const cities = [keyed("كوالالمبور#1", "كوالالمبور", 2, "2026-10-20"), keyed("كوالالمبور#2", "كوالالمبور", 2, "2026-10-22")];
    expect(deriveHotelStays(cities, [line({ hotel_name: "قديم" })]).map((s) => s.city_index)).toEqual([0, 1]);
    expect(deriveHotelStays(cities, [line({ hotel_name: "يتيم", city_key: "gone" })]).map((s) => s.city_index)).toEqual([0, 1]);
  });
});

describe("city keys", () => {
  it("are made from the name and the visit, the same on every read, and kept once written", () => {
    const raw = { cities: [{ city_name: "كوالالمبور", nights: 2 }, { city_name: "لنكاوي", nights: 2 }, { city_name: "كوالالمبور", nights: 1 }] };
    const keys = normalizeDraftData(raw as never).cities.map((c) => c.key);
    expect(keys).toEqual(["كوالالمبور#1", "لنكاوي#1", "كوالالمبور#2"]);
    expect(normalizeDraftData(raw as never).cities.map((c) => c.key)).toEqual(keys);
    // a renamed stop keeps its key; a new stop of that name never takes it
    const renamed = [{ key: "كوالالمبور#1", city_name: "بينانج" }, { city_name: "كوالالمبور" }];
    expect(cityKeys(renamed)).toEqual(["كوالالمبور#1", "كوالالمبور#2"]);
    expect(newCityKey(renamed, "كوالالمبور")).toBe("كوالالمبور#3");
    // a key written twice by mistake is the first stop's only
    expect(cityKeys([{ key: "x", city_name: "أ" }, { key: "x", city_name: "أ" }])).toEqual(["x", "أ#1"]);
  });
});

/**
 * The rule before order 1, kept here verbatim as the reference: an older draft
 * (no keys, no `dates`) must derive exactly what it always did.
 */
function legacyStays(cities: DraftCity[], hotels: DraftHotel[]) {
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const out: { id: string; city_name: string; nights: number; check_in: string | null; check_out: string | null }[] = [];
  for (const c of cities) {
    const lines = hotels.filter((h) => h.city_name === c.city_name);
    const explicit = lines.reduce((sum, l) => sum + Math.max(0, l.nights), 0);
    const blanks = lines.filter((l) => l.nights <= 0).length;
    let remaining = Math.max(0, c.nights - explicit);
    let cursor = c.check_in;
    lines.forEach((l, i) => {
      let nights = Math.max(0, l.nights);
      if (nights === 0 && blanks > 0) {
        const share = Math.floor(remaining / blanks);
        nights = lines.filter((x, j) => x.nights <= 0 && j > i).length === 0 ? remaining : share;
        remaining -= nights;
      }
      const check_in = cursor;
      const check_out = check_in ? addDays(check_in, nights) : null;
      cursor = check_out;
      out.push({ id: l.id, city_name: c.city_name, nights, check_in, check_out });
    });
  }
  return out;
}

describe("an older draft (acceptance هـ)", () => {
  const raw = {
    trip: { country: "ماليزيا", arrival_date: "2026-11-11", nights: 13, days: 14, adults: 2 },
    cities: [
      { city_name: "كوالالمبور", nights: 3 },
      { city_name: "لنكاوي", nights: 3 },
      { city_name: "بينانج", nights: 4 },
      { city_name: "كوالالمبور", nights: 2 },
      { city_name: "جنتنج", nights: 1 },
    ],
    hotels: [
      { id: "s1", city_name: "كوالالمبور", hotel_name: "أ", nights: 0, rooms: [{ room_type_name: "ديلوكس", board_type: "BB", price: 900 }] },
      { id: "s2", city_name: "لنكاوي", hotel_name: "ب", nights: 1, rooms: [{ room_type_name: "ديلوكس", board_type: "BB", price: 300 }] },
      { id: "s3", city_name: "لنكاوي", hotel_name: "ب", nights: 0, rooms: [{ room_type_name: "جناح", board_type: "BB", price: 800 }] },
      { id: "s4", city_name: "بينانج", hotel_name: "ج", nights: 0, manual_price: 500 },
      { id: "s5", city_name: "بينانج", hotel_name: "د", nights: 0, manual_price: 400 },
      { id: "s6", city_name: "جنتنج", hotel_name: "هـ", nights: 3, rooms: [{ room_type_name: "ديلوكس", board_type: "BB", price: 100 }] },
    ],
  };

  it("derives the same stays, the same coverage and the same pricing lines as before", () => {
    const data = normalizeDraftData(raw as never);
    const cities = deriveCityDates("2026-11-11", data.cities);
    const stays = deriveHotelStays(cities, data.hotels);
    expect(stays.map((s) => ({ id: s.line.id, city_name: s.city_name, nights: s.nights, check_in: s.check_in, check_out: s.check_out }))).toEqual(
      legacyStays(cities, data.hotels),
    );
    // the old coverage was the sum of each city's stays — كوالالمبور's line on both visits, جنتنج over by two
    expect(hotelCoverage(cities, data.hotels).map((c) => c.covered)).toEqual(
      cities.map((c) => legacyStays([c], data.hotels).reduce((sum, s) => sum + s.nights, 0)),
    );
    expect(hotelCoverage(cities, data.hotels).map((c) => c.extra)).toEqual([0, 0, 0, 0, 2]);

    const lines = suggestPricing(data, { transfers: [], services: [], rooms: [], fleet: [] }, { hotel: "فندق", airline: "" }).filter(
      (i) => i.item_type === "hotel",
    );
    expect(lines.map((i) => [i.ref, i.quantity, i.sell_price, i.buy_price])).toEqual([
      ["s1", 1, 900, 900],
      ["s2", 1, 300, 300],
      ["s3", 1, 800, 800],
      ["s4", 1, 500, 500],
      ["s5", 1, 400, 400],
      ["s1", 1, 900, 900],
      ["s6", 1, 100, 100],
    ]);
    // a city holding one stay reads as it did; two stays in a city now say which dates each is
    expect(lines.map((i) => i.description)).toEqual([
      "كوالالمبور — أ",
      "لنكاوي — ب (14/11 – 15/11)",
      "لنكاوي — ب (15/11 – 17/11)",
      "بينانج — ج (17/11 – 19/11)",
      "بينانج — د (19/11 – 21/11)",
      "كوالالمبور — أ",
      "جنتنج — هـ",
    ]);
  });
});
