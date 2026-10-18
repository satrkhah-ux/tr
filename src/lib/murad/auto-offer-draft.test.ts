import { describe, expect, it } from "vitest";
import { DEFAULT_OFFERS, offerDraftData, priceOffer } from "./auto-offer";
import { validateDraft } from "@/lib/offer/draft-validation";

describe("«عرض آلي» — the Basic file Murad issues", () => {
  it("passes the issue check as built", () => {
    const c = DEFAULT_OFFERS[0];
    const data = offerDraftData({ name: "محمد", phone: "+966594135050", c, arrival: "2026-11-15", provisional: true, days: 10, adults: 2, price: priceOffer(c, 10, 2, 3.75) });
    const v = validateDraft(data);
    expect(v.blocking.map((b) => b.key)).toEqual([]);
    expect(v.ok).toBe(true);
  });
});
