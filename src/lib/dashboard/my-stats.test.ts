import { describe, expect, it } from "vitest";
import { clientsOf, countryResolver, lastMonths, riyadhMonth, summarizeMine, type MyOffer } from "./my-stats";

/**
 * «لوحتي»: the owner asked for each account's issued / unfinished / confirmed
 * counts, its clients and its most frequent country. These pin the rules that
 * are easy to get quietly wrong: the Riyadh month, the country an agent typed
 * as a city, and a confirmation counted from either of its two records.
 */

function offer(over: Partial<MyOffer> = {}): MyOffer {
  return {
    id: "o1",
    serial: "AD-1-0001-20261001",
    customerId: null,
    client: null,
    phone: null,
    destination: "ماليزيا",
    country: "ماليزيا",
    cities: [],
    start: null,
    end: null,
    total: 1000,
    currency: "SAR",
    totalSar: 1000,
    status: "sent",
    createdAt: "2026-10-05T10:00:00Z",
    updatedAt: "2026-10-05T10:00:00Z",
    operation: null,
    ...over,
  };
}

describe("countryResolver", () => {
  const resolve = countryResolver(
    ["ماليزيا", "تايلاند", "اندونيسيا", "جورجيا"],
    [
      { name: "كوالالمبور", country: "ماليزيا" },
      { name: "تبليسي", country: "جورجيا" },
    ],
  );

  it("reads a country, however its alef is written", () => {
    expect(resolve({ destination: "إندونيسيا", cities: [] })).toBe("اندونيسيا");
  });
  it("folds a dropped long vowel by skeleton", () => {
    expect(resolve({ destination: "تايلند", cities: [] })).toBe("تايلاند");
  });
  it("puts a city typed as the destination in its country", () => {
    expect(resolve({ destination: "كوالالمبور", cities: [] })).toBe("ماليزيا");
  });
  it("falls back to the offer's cities when the text is compound", () => {
    expect(resolve({ destination: "تبليسي +باكورياني+باتومي", cities: ["باكورياني", "تبليسي"] })).toBe("جورجيا");
  });
  it("keeps what it cannot place, as typed", () => {
    expect(resolve({ destination: " لندن ", cities: [] })).toBe("لندن");
    expect(resolve({ destination: null, cities: [] })).toBeNull();
  });
});

describe("months", () => {
  it("counts a file issued at 01:30 Riyadh on the 1st in the new month", () => {
    expect(riyadhMonth("2026-09-30T22:30:00Z")).toBe("2026-10");
  });
  it("lists twelve months across a year boundary, oldest first", () => {
    const months = lastMonths("2026-02", 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-03");
    expect(months.at(-1)).toBe("2026-02");
  });
});

describe("summarizeMine", () => {
  const op = (live: boolean) => ({ id: "op", clientStatus: "confirmed", executionStatus: live ? "pending_bookings" : "travelled", live });
  const offers = [
    offer({ id: "a", customerId: "c1", createdAt: "2026-10-02T08:00:00Z", operation: op(true), status: "confirmed", cities: ["بانكوك", "فوكيت", "بانكوك"], country: "تايلاند", totalSar: 9000 }),
    offer({ id: "b", customerId: "c1", createdAt: "2026-08-02T08:00:00Z", status: "confirmed", operation: op(false), country: "تايلاند", cities: ["بانكوك"], totalSar: 3000 }),
    offer({ id: "c", customerId: "c2", createdAt: "2026-09-30T22:30:00Z", country: "ماليزيا", totalSar: 0 }),
    offer({ id: "d", createdAt: "2025-01-10T08:00:00Z", country: null }),
  ];
  const s = summarizeMine(offers, 3, "2026-10-17");

  it("counts issued, this month (Riyadh), unfinished and confirmed", () => {
    expect(s.issued).toBe(4);
    expect(s.issuedThisMonth).toBe(2);
    expect(s.incomplete).toBe(3);
    expect(s.confirmed).toBe(2);
    expect(s.openOperations).toBe(1);
    expect(s.conversion).toBe(50);
  });
  it("averages only priced offers", () => {
    expect(s.avgSar).toBe((9000 + 3000 + 1000) / 3);
  });
  it("ranks countries and counts a city once per trip", () => {
    expect(s.topCountries[0]).toEqual({ label: "تايلاند", value: 2 });
    expect(s.topCities).toEqual([{ label: "بانكوك", value: 2 }, { label: "فوكيت", value: 1 }]);
  });
  it("buckets twelve months, zeros kept, older files out of the window", () => {
    expect(s.monthly).toHaveLength(12);
    expect(s.monthly.at(-1)).toEqual({ month: "2026-10", value: 2 });
    expect(s.monthly.find((m) => m.month === "2026-09")?.value).toBe(0);
    expect(s.monthly.reduce((n, m) => n + m.value, 0)).toBe(3);
  });
  it("counts clients by their first file with me", () => {
    expect(s.clients).toBe(2);
    expect(s.newClientsThisMonth).toBe(1); // c2; c1 first came in August
  });
  it("is all zeros with nothing issued", () => {
    const empty = summarizeMine([], 0, "2026-10-17");
    expect(empty).toMatchObject({ issued: 0, confirmed: 0, conversion: 0, avgSar: null, topCountries: [] });
  });
});

describe("clientsOf", () => {
  it("merges a client's files, latest first, and skips offers without one", () => {
    const list = clientsOf([
      offer({ id: "1", customerId: "x", client: "سارة", createdAt: "2026-09-01T00:00:00Z", country: "جورجيا" }),
      offer({ id: "2", customerId: "y", client: "خالد", createdAt: "2026-10-01T00:00:00Z" }),
      offer({ id: "3", customerId: "x", client: "سارة", createdAt: "2026-10-09T00:00:00Z", status: "confirmed", country: "تركيا" }),
      offer({ id: "4" }),
    ]);
    expect(list.map((c) => c.id)).toEqual(["x", "y"]);
    expect(list[0]).toMatchObject({ offers: 2, confirmed: 1, firstAt: "2026-09-01T00:00:00Z", countries: ["جورجيا", "تركيا"] });
  });
});
