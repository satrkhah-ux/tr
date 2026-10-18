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
