import { describe, expect, it } from "vitest";
import { typedAsCost, keepDraftCost, redactDraftCost } from "./draft-cost";
import { emptyDraftData, normalizeDraftHotel, type DraftData, type DraftHotelSourcing, type DraftPricingItem } from "./draft-types";

/**
 * The round trip a salesperson's browser makes: the draft goes out without the
 * cost and comes back without it. What must hold is that the STORED cost
 * survives that, and that nothing the browser sends can set it.
 */

const item = (slice: Partial<DraftPricingItem>): DraftPricingItem => ({
  item_type: "service",
  description: "استقبال",
  quantity: 1,
  buy_price: 100,
  buy_currency: "USD",
  sell_price: 150,
  sell_currency: "USD",
  ...slice,
});

const sourcing: DraftHotelSourcing = {
  supplier_id: "tbo",
  supplier_name: "TBO Holidays",
  rate_key: "RK-1",
  net_base: 800,
  net_source_currency: "USD",
  fx_rate: 3.75,
  fx_date: "2026-10-01",
  ref_sell_base: 1100,
  sell_base: 1000,
  markup_amount: 200,
  markup_pct: 25,
  margin_pct: 20,
  min_margin_pct: 10,
  cancellation_policy: "free until 7 days",
  excluded_surcharges: [],
  valid_until: null,
  room_category: "double",
  room_name: "Deluxe Double",
  refundable: true,
  blocked: false,
  image_url: null,
  facilities: [],
  star_rating: 5,
  supplier_hotel_id: "H1",
  rate_fetched_at: null,
};

function stored(): DraftData {
  const data = emptyDraftData();
  data.hotels = [{ ...normalizeDraftHotel({ city_name: "باكو", hotel_name: "فندق" }), id: "stay-1", sourcing }];
  data.pricing.items = [
    item({ item_type: "hotel", description: "باكو — فندق", ref: "stay-1", buy_price: 800, buy_currency: "SAR", sell_price: 1000, sell_currency: "SAR" }),
    item({ description: "استقبال", profit_pct: 20, sell_price: 130 }),
    item({ description: "جولة", buy_price: 50, sell_price: 70 }),
  ];
  return data;
}

const COST_WORDS = /buy_price":(?!null)|net_base|markup|margin_pct|profit_|rate_key|fx_rate|ref_sell/;

describe("redactDraftCost", () => {
  it("removes every cost figure and keeps what the agent quotes from", () => {
    const out = redactDraftCost(stored());
    expect(JSON.stringify(out)).not.toMatch(COST_WORDS);
    expect(out.hotels[0].sourcing).toMatchObject({ sell_base: 1000, supplier_name: "TBO Holidays", room_name: "Deluxe Double" });
  });

  it("shows the sell a profit rule produces, not the one it replaced", () => {
    const out = redactDraftCost(stored());
    expect(out.pricing.items[1].sell_price).toBe(120); // 100 + 20%
  });
});

describe("keepDraftCost", () => {
  it("an untouched round trip stores exactly what was there", () => {
    const back = redactDraftCost(stored());
    const kept = keepDraftCost({ hotels: back.hotels, pricing: back.pricing }, stored());
    expect(kept.pricing).toEqual(stored().pricing);
    expect(kept.hotels).toEqual(stored().hotels);
  });

  it("keeps the buy price when the agent edits a line, renames included", () => {
    const back = redactDraftCost(stored());
    back.pricing.items[2] = { ...back.pricing.items[2], description: "جولة المدينة", quantity: 3 };
    const items = keepDraftCost({ pricing: back.pricing }, stored()).pricing?.items ?? [];
    expect(items[2]).toMatchObject({ buy_price: 50, quantity: 3, sell_price: 70 });
  });

  it("a sell the agent changed drops the profit rule that produced the old one", () => {
    const back = redactDraftCost(stored());
    back.pricing.items[1] = { ...back.pricing.items[1], sell_price: 125 };
    const line = keepDraftCost({ pricing: back.pricing }, stored()).pricing?.items[1];
    expect(line).toMatchObject({ buy_price: 100, sell_price: 125 });
    expect(line?.profit_pct).toBeUndefined();
  });

  it("follows a line that moved, and never takes a buy price from the browser", () => {
    const back = redactDraftCost(stored());
    const moved = [back.pricing.items[2], back.pricing.items[0], item({ item_type: "other", description: "جديد", buy_price: 1 })];
    const items = keepDraftCost({ pricing: { ...back.pricing, items: moved } }, stored()).pricing?.items ?? [];
    expect(items.map((i) => i.buy_price)).toEqual([50, 800, null]);
  });

  it("restores a stay's net, and lets the agent clear a sourcing", () => {
    const back = redactDraftCost(stored());
    expect(keepDraftCost({ hotels: back.hotels }, stored()).hotels?.[0].sourcing?.net_base).toBe(800);
    const cleared = keepDraftCost({ hotels: [{ ...back.hotels[0], sourcing: null }] }, stored());
    expect(cleared.hotels?.[0].sourcing).toBeNull();
  });

  it("a sourcing the store does not know arrives without cost", () => {
    const forged = { ...stored().hotels[0], id: "stay-x" };
    const out = keepDraftCost({ hotels: [forged] }, stored()).hotels?.[0].sourcing;
    expect(out?.net_base).toBeUndefined();
    expect(out?.sell_base).toBe(1000);
  });

  it("leaves slices without cost alone", () => {
    expect(keepDraftCost({ produced_serial: "AD-1" }, stored())).toEqual({ produced_serial: "AD-1" });
  });
});

describe("package margin (DraftPricing.profit)", () => {
  const withMargin = (): DraftData => {
    const d = emptyDraftData();
    d.pricing = { ...d.pricing, profit: { mode: "pct", value: 18 } };
    return d;
  };

  it("is hidden from a viewer without pricing.internal", () => {
    expect(redactDraftCost(withMargin()).pricing.profit).toBeUndefined();
  });

  it("survives a non-internal save that never saw it", () => {
    const stored = withMargin();
    const sent = redactDraftCost(stored).pricing;
    expect(keepDraftCost({ pricing: sent }, stored).pricing?.profit).toEqual({ mode: "pct", value: 18 });
  });

  it("cannot be set or changed by a non-internal save", () => {
    const stored = withMargin();
    const forged = { ...stored.pricing, profit: { mode: "pct" as const, value: 90 } };
    expect(keepDraftCost({ pricing: forged }, stored).pricing?.profit).toEqual({ mode: "pct", value: 18 });
    const none = emptyDraftData();
    expect(keepDraftCost({ pricing: forged }, none).pricing?.profit).toBeUndefined();
  });
});

describe("typedAsCost — a typed figure is our cost at issue", () => {
  const line = (over: Record<string, unknown>) => ({ item_type: "transport", description: "بونشاك ← بالي", quantity: 1, buy_price: null, buy_currency: "", sell_price: 300, sell_currency: "SAR", ...over }) as never;
  it("puts the agent's typed figure on the cost side, so the margin goes on it (AD-4-8573: 300 issued as 300, shown as 345)", () => {
    expect(typedAsCost([line({ overridden: true })])[0]).toMatchObject({ buy_price: 300, buy_currency: "SAR", sell_price: 300 });
  });
  it("leaves a line we priced, and one nobody overrode, as they are", () => {
    expect(typedAsCost([line({ overridden: true, buy_price: 250 })])[0]).toMatchObject({ buy_price: 250 });
    expect(typedAsCost([line({})])[0]).toMatchObject({ buy_price: null });
  });
});
