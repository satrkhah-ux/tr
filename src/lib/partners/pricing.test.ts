import { describe, expect, it } from "vitest";
import {
  emptyDraftData,
  normalizeDraftHotel,
  type DraftData,
  type DraftHotelSourcing,
  type DraftPricingItem,
  type DraftRoomSpec,
} from "@/lib/offer/draft-types";
import type { PriceSource } from "@/lib/offer/pricing-suggest";
import {
  describeTerms,
  keepOurStays,
  keepTheirPrices,
  partnerMargin,
  partnerPrice,
  partnerSeed,
  partnerSheet,
  partnerStays,
  priceForViewer,
} from "./pricing";

/**
 * The percentage management sets per company, in both directions.
 *
 * Worth testing to the corner cases because a wrong sign here does not look
 * wrong on screen — it looks like a price — and is discovered on an invoice.
 */

describe("partnerPrice", () => {
  it("adds a markup on top of our sell", () => {
    expect(partnerPrice(1000, { kind: "markup", pct: 35 })).toBe(1350);
  });

  it("takes a commission off our sell", () => {
    expect(partnerPrice(1000, { kind: "commission", pct: 35 })).toBe(650);
  });

  it("leaves the price alone at zero, and with no terms at all", () => {
    expect(partnerPrice(1000, { kind: "markup", pct: 0 })).toBe(1000);
    expect(partnerPrice(1000, null)).toBe(1000);
  });

  it("refuses a nonsense percentage rather than applying it", () => {
    // A bad number in the settings screen should show our plain price — not a
    // free trip, and not a negative one.
    expect(partnerPrice(1000, { kind: "markup", pct: -20 })).toBe(1000);
    expect(partnerPrice(1000, { kind: "commission", pct: 250 })).toBe(1000);
    expect(partnerPrice(1000, { kind: "commission", pct: Number.NaN })).toBe(1000);
  });

  it("never goes below zero", () => {
    expect(partnerPrice(1000, { kind: "commission", pct: 100 })).toBe(0);
  });

  it("rounds to two places, so the figure quoted is the figure charged", () => {
    expect(partnerPrice(333.33, { kind: "markup", pct: 15 })).toBe(383.33);
  });
});

describe("partnerMargin", () => {
  it("is theirs alone — what their client pays minus what we charge them", () => {
    const m = partnerMargin(2000, 1350);
    expect(m.amount).toBe(650);
    expect(m.pct).toBe(32.5);
  });

  it("goes negative when they undersell, and says so", () => {
    expect(partnerMargin(1200, 1350).amount).toBe(-150);
  });

  it("has no percentage to report against a zero sell", () => {
    expect(partnerMargin(0, 0).pct).toBeNull();
  });
});

describe("describeTerms", () => {
  it("says which direction the percentage moves, in words", () => {
    expect(describeTerms({ kind: "markup", pct: 35 })).toContain("إضافة");
    expect(describeTerms({ kind: "commission", pct: 12 })).toContain("خصم");
    expect(describeTerms({ kind: "markup", pct: 0 })).toContain("بلا إضافة");
  });
});

describe("priceForViewer", () => {
  it("adds a 35% markup for a partner on markup", () => {
    expect(priceForViewer(1000, { kind: "markup", pct: 35 })).toBe(1350);
  });

  it("takes a commission off for a partner on commission", () => {
    expect(priceForViewer(1000, { kind: "commission", pct: 10 })).toBe(900);
  });

  it("shows a partner on 0% our plain price", () => {
    expect(priceForViewer(1000, { kind: "markup", pct: 0 })).toBe(1000);
  });

  it("passes staff through untouched — not even rounded", () => {
    expect(priceForViewer(333.333, null)).toBe(333.333);
  });
});

describe("partnerSheet", () => {
  const line = (over: Partial<DraftPricingItem> & { source?: PriceSource }): DraftPricingItem & { source?: PriceSource } => ({
    item_type: "transport",
    description: "",
    quantity: 1,
    buy_price: 400,
    buy_currency: "SAR",
    sell_price: 400,
    sell_currency: "SAR",
    ...over,
  });
  const NO_MARGIN = { profit: undefined, rates: { SAR: 1 }, quote: "SAR", byPartner: false };
  const MARGIN_20 = { ...NO_MARGIN, profit: { mode: "pct" as const, value: 20 } };
  const MARKUP = { kind: "markup" as const, pct: 35 };

  it("prices our lines at their terms and strips the buy and our profit rule", () => {
    const [out] = partnerSheet([line({ source: "list", profit_pct: 10 })], MARKUP, NO_MARGIN);
    // the line's own profit is our sell (440), then their terms
    expect(out.sell_price).toBe(594);
    expect(out.buy_price).toBeNull();
    expect(out.buy_currency).toBe("");
    expect("profit_pct" in out).toBe(false);
  });

  it("never quotes our cost: with no margin to lay on, a list line goes unpriced", () => {
    expect(partnerSheet([line({ source: "list" })], MARKUP, NO_MARGIN)[0].sell_price).toBeNull();
    expect(partnerSheet([line({ source: "remembered" })], MARKUP, NO_MARGIN)[0].sell_price).toBeNull();
    // a stated 0% is no margin either
    const zero = { ...NO_MARGIN, profit: { mode: "pct" as const, value: 0 } };
    expect(partnerSheet([line({ source: "list" })], MARKUP, zero)[0].sell_price).toBeNull();
  });

  it("keeps a list sell that is above the buy (a service) when there is no margin", () => {
    const [out] = partnerSheet([line({ item_type: "service", source: "list", buy_price: 100, sell_price: 150 })], MARKUP, NO_MARGIN);
    expect(out.sell_price).toBe(202.5);
  });

  it("leaves a figure the partner typed as typed", () => {
    const [out] = partnerSheet([line({ source: "typed", sell_price: 999, buy_price: 999 })], MARKUP, { ...NO_MARGIN, byPartner: true });
    expect(out).toMatchObject({ sell_price: 999, buy_price: null });
  });

  it("treats a figure typed on their file by staff as ours — margin, then their terms", () => {
    const typed = line({ source: "typed", sell_price: 1000, buy_price: 1000 });
    expect(partnerSheet([typed], MARKUP, MARGIN_20)[0].sell_price).toBe(1620);
    expect(partnerSheet([typed], MARKUP, NO_MARGIN)[0].sell_price).toBeNull();
  });

  it("quotes a supplier line from its sell, as the stay card does — not from the net plus our margin", () => {
    const supplier = line({ item_type: "hotel", source: "supplier", buy_price: 800, sell_price: 900 });
    expect(partnerSheet([supplier], MARKUP, MARGIN_20)[0].sell_price).toBe(1215);
    expect(partnerSheet([supplier], MARKUP, NO_MARGIN)[0].sell_price).toBe(1215);
  });

  it("lays our package margin on before the terms, so a commission never sells below cost", () => {
    const [out] = partnerSheet([line({ source: "list" })], { kind: "commission", pct: 10 }, MARGIN_20);
    expect(out.sell_price).toBe(432); // 400 → 480 → −10%
  });

  it("keeps an unpriced line unpriced", () => {
    const [out] = partnerSheet([line({ source: "none", buy_price: null, sell_price: null })], MARKUP, NO_MARGIN);
    expect(out.sell_price).toBeNull();
  });
});

describe("keepTheirPrices", () => {
  const room = (over: Partial<DraftRoomSpec> = {}): DraftRoomSpec => ({
    room_type_id: null,
    room_type_name: "مزدوجة",
    board_type: "BB",
    price: 1000,
    ...over,
  });
  const stored = (): DraftData => {
    const data = emptyDraftData();
    data.hotels = [{ ...normalizeDraftHotel({ city_name: "إسطنبول", hotel_name: "فندق" }), rooms: [room()] }];
    data.flight_booking = { ...data.flight_booking, intl_price: 3000 };
    data.cities = [
      {
        city_name: "إسطنبول",
        nights: 3,
        check_in: null,
        check_out: null,
        tours: 1,
        tour_picks: [{ program_id: null, title: "جولة البوسفور", text: "", price: 200 }],
      },
    ];
    data.pricing.items = [
      { item_type: "transport", description: "نقل", quantity: 1, buy_price: null, buy_currency: "", sell_price: 540, sell_currency: "SAR" },
    ];
    return data;
  };

  it("keeps the partner's own card prices when staff type ours over them", () => {
    const was = stored();
    const sent: Partial<DraftData> = {
      hotels: [{ ...was.hotels[0], rooms: [room({ price: 700 })] }],
      flight_booking: { ...was.flight_booking, intl_price: 2500 },
      cities: [{ ...was.cities[0], tour_picks: [{ ...was.cities[0].tour_picks![0], price: 150 }] }],
    };
    const out = keepTheirPrices(sent, was);
    expect(out.hotels?.[0].rooms[0].price).toBe(1000);
    expect(out.flight_booking?.intl_price).toBe(3000);
    expect(out.cities?.[0].tour_picks?.[0].price).toBe(200);
  });

  it("leaves a changed room or tour unpriced rather than carrying another one's price", () => {
    const was = stored();
    const out = keepTheirPrices(
      {
        hotels: [{ ...was.hotels[0], rooms: [room({ room_type_name: "ثلاثية", price: 900 })] }],
        cities: [{ ...was.cities[0], tour_picks: [{ program_id: null, title: "جولة أخرى", text: "", price: 150 }] }],
      },
      was,
    );
    expect(out.hotels?.[0].rooms[0].price).toBeNull();
    expect(out.cities?.[0].tour_picks?.[0].price).toBeNull();
  });

  it("unprices a sheet line carrying a buy — a cost typed at its source — and keeps a quote", () => {
    const was = stored();
    const typedCost = { item_type: "hotel" as const, description: "فندق", quantity: 1, buy_price: 700, buy_currency: "SAR", sell_price: 700, sell_currency: "SAR" };
    const out = keepTheirPrices({ pricing: { ...was.pricing, items: [...was.pricing.items, typedCost] } }, was);
    expect(out.pricing?.items[0].sell_price).toBe(540);
    expect(out.pricing?.items[1]).toMatchObject({ buy_price: null, sell_price: null });
  });
});

describe("partnerStays / keepOurStays", () => {
  const sourcing = { sell_base: 900 } as unknown as DraftHotelSourcing;
  const stay = normalizeDraftHotel({ city_name: "إسطنبول", hotel_name: "فندق" });

  it("shows a supplier stay's sell at their terms, and puts ours back on their save", () => {
    const stored = [{ ...stay, sourcing }];
    const shown = partnerStays(stored, { kind: "markup", pct: 35 });
    expect(shown[0].sourcing?.sell_base).toBe(1215);
    expect(keepOurStays(shown, stored)[0].sourcing?.sell_base).toBe(900);
  });

  it("drops a supplier rate a partner's browser invented", () => {
    expect(keepOurStays([{ ...stay, sourcing }], [stay])[0].sourcing).toBeNull();
  });
});

describe("partnerSeed", () => {
  it("starts a partner's file from a ready offer at their price", () => {
    const seed = partnerSeed({ pricing: { items: [], display_currency: "SAR", final_total: 4000 } }, { kind: "markup", pct: 10 });
    expect(seed?.pricing?.final_total).toBe(4400);
  });
});
