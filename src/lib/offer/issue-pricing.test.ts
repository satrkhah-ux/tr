import { describe, expect, it } from "vitest";
import { adoptedPin, issuePricing, priceMoved } from "./issue-pricing";
import type { DraftData, DraftPricingItem } from "./draft-types";

const line = (over: Partial<DraftPricingItem>): DraftPricingItem => ({
  item_type: "service",
  description: "جولة",
  quantity: 1,
  buy_price: 1000,
  buy_currency: "SAR",
  sell_price: 1000,
  sell_currency: "SAR",
  ...over,
});
const priced = (items: DraftPricingItem[], extra: Partial<DraftData["pricing"]> = {}): Pick<DraftData, "pricing"> => ({
  pricing: { items, display_currency: "SAR", final_total: null, ...extra },
});
const none = new Set<string>();

describe("issue pricing", () => {
  it("adds the lines, lays the default margin on, and rounds the total up", () => {
    const p = issuePricing([line({}), line({ buy_price: 500.4, sell_price: 500.4 })], priced([]), none, 10, { SAR: 1 });
    // 1000 + 500.4 = 1500.4 → +10% = 1650.44 → up to a whole riyal
    expect(p.totals.total).toBe(1651);
    expect(p.pinned).toBe(false);
  });

  it("drops a hotel line whose stay is gone", () => {
    const hotel = line({ item_type: "hotel", description: "فوكيت — فندق قديم", ref: "stay-old" });
    expect(issuePricing([line({}), hotel], priced([]), new Set(["stay-new"]), null, { SAR: 1 }).totals.total).toBe(1000);
    expect(issuePricing([line({}), hotel], priced([]), new Set(["stay-old"]), null, { SAR: 1 }).totals.total).toBe(2000);
  });

  it("keeps an adopted version's own total while the file still prices as it did when adopted", () => {
    const items = [line({})];
    const adopted = { version: 2, total: 950, base: 1000 };
    const p = issuePricing(items, priced(items, { adopted }), none, null, { SAR: 1 });
    expect([p.totals.total, p.unpinned, p.pinned]).toEqual([950, 1000, true]);
    // a hotel or a tour added after the adoption: the file prices on its own again
    const more = issuePricing([...items, line({ buy_price: 300, sell_price: 300 })], priced(items, { adopted }), none, null, { SAR: 1 });
    expect([more.totals.total, more.pinned]).toEqual([1300, false]);
  });

  it("reads a pin only when it matches", () => {
    expect(adoptedPin(undefined, 1000)).toBeNull();
    expect(adoptedPin({ version: 1, total: 900, base: null }, 1000)).toBeNull();
    expect(adoptedPin({ version: 1, total: 900, base: 1000 }, 1000.001)).toBe(900);
    expect(adoptedPin({ version: 1, total: 900, base: 1000 }, 1001)).toBeNull();
  });

  it("says a price moved only past a rounding cent", () => {
    expect(priceMoved(1651, 1651)).toBe(false);
    expect(priceMoved(1652, 1651)).toBe(true);
    expect(priceMoved(null, 1651)).toBe(false);
  });
});
