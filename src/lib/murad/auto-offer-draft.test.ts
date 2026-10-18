import { describe, expect, it } from "vitest";
import { DEFAULT_OFFERS, offerDraftData, priceOffer } from "./auto-offer";
import { validateDraft } from "@/lib/offer/draft-validation";
import { deriveCityDates, deriveHotelStays } from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";

describe("«عرض آلي» — the Basic file Murad issues", () => {
  it("passes the issue check as built", () => {
    const c = DEFAULT_OFFERS[0];
    const data = offerDraftData({ name: "محمد", phone: "+966594135050", c, arrival: "2026-11-15", provisional: true, days: 10, adults: 2, price: priceOffer(c, 10, 2, 3.75) });
    const v = validateDraft(data);
    expect(v.blocking.map((b) => b.key)).toEqual([]);
    expect(v.ok).toBe(true);
  });
});

describe("«عرض آلي» — a city the route returns to", () => {
  it("Tbilisi at the start and at the end is two stays, each in its own visit (AD-1-6202 printed four)", () => {
    const c = DEFAULT_OFFERS[0];
    const price = priceOffer(c, 10, 2, 3.75);
    const data = offerDraftData({ name: "محمد", phone: "+966594135050", c, arrival: "2026-11-01", provisional: false, days: 10, adults: 2, price });
    const stays = deriveHotelStays(deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities), data.hotels);
    expect(stays.map((s) => `${s.city_name} ${s.nights} ${s.check_in}`)).toEqual([
      "تبليسي 3 2026-11-01",
      "باكورياني 2 2026-11-04",
      "باتومي 3 2026-11-06",
      "تبليسي 1 2026-11-09",
    ]);
  });
});

describe("«عرض آلي» — the days, as Basic writes them (the evaluator on AD-1-6202, 2026-10-19)", () => {
  const prog = (city: string, n: number) =>
    Array.from({ length: n }, (_, k) => ({ id: `${city}${k}`, city_name: city, title: `جولة ${k + 1} في ${city}`, description: `معالم ${city} ${k + 1}`, is_free_day: false, sort_order: k }));
  const programs = [...prog("تبليسي", 5), ...prog("باكورياني", 2), ...prog("باتومي", 4)];
  const c = DEFAULT_OFFERS[0];
  const data = offerDraftData({ name: "محمد", phone: "+966594135050", c, arrival: "2026-11-01", provisional: false, days: 10, adults: 2, price: priceOffer(c, 10, 2, 3.75), programs });

  it("a tour a day but the arrival, Tbilisi's second visit never repeating the first's, and still issuable", () => {
    expect(data.cities.map((x) => `${x.city_name} ${x.tours}`)).toEqual(["تبليسي 2", "باكورياني 1", "باتومي 2", "تبليسي 0"]);
    expect(data.days).toHaveLength(10);
    const titles = data.days.map((d) => d.title);
    expect(titles.filter((t) => t.startsWith("جولة"))).toEqual(["جولة 1 في تبليسي", "جولة 2 في تبليسي", "جولة 1 في باكورياني", "جولة 1 في باتومي", "جولة 2 في باتومي"]);
    expect(data.days.every((d) => d.title.trim())).toBe(true);
    expect(validateDraft(data).blocking.map((b) => b.key)).toEqual([]);
  });

  it("«يشمل» once: the hotels, the breakfast and the airport are the file's own lines, the car stays", () => {
    expect(data.services.includes).toEqual(["سيارة خاصة مع سائق طوال أيام الرحلة"]);
  });
});
