import { describe, expect, it } from "vitest";
import {
  deriveHotelStays,
  hotelCoverage,
  normalizeDraftHotel,
  pricingRefFor,
  type DraftCity,
  type DraftHotel,
} from "./draft-types";

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
