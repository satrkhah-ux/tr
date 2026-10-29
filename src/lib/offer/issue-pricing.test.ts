import { describe, expect, it } from "vitest";
import { adoptedPin, beforeCharge, issuePricing, priceMoved } from "./issue-pricing";
import { DEFAULT_FEES } from "@/lib/payments/methods";
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

  describe("the client's way of paying", () => {
    const fees = DEFAULT_FEES;
    // the owner's sheet: 15,510 by Tamara → 1,359.61 on top → 16,869.61; our cost 14,100
    const sheet = [line({ buy_price: 14100, sell_price: 14100 })];
    const pay = (extra: Partial<DraftData["pricing"]>, f: typeof fees | null = fees) =>
      issuePricing(sheet, priced([], { final_total: 15510, ...extra }), none, null, { SAR: 1 }, f ?? undefined);

    it("lays the chosen way's charge on the client total and on our cost — the profit does not move", () => {
      const cash = pay({});
      const tamara = pay({ payment_method: "tamara" });
      expect([cash.totals.total, cash.fee]).toEqual([15510, 0]);
      expect([tamara.totals.total, tamara.base, tamara.fee, tamara.totals.total_sar]).toEqual([16869.61, 15510, 1359.61, 16869.61]);
      expect(tamara.totals.total! - tamara.totals.buy_total!).toBeCloseTo(cash.totals.total! - cash.totals.buy_total!, 2);
      expect(pay({ payment_method: "link" }).totals.total).toBe(15897.75);
      expect(pay({ payment_method: "cash" }).totals.total).toBe(15510);
    });

    it("a switched way is a price change («تطبيق تحديث السعر»)", () => {
      expect(priceMoved(pay({ payment_method: "tabby" }).totals.total, pay({ payment_method: "cash" }).totals.total)).toBe(true);
      expect(priceMoved(pay({ payment_method: "tabby" }).totals.total, pay({ payment_method: "tamara" }).totals.total)).toBe(false);
    });

    it("adds nothing without E's fees (a partner's file) or on a quote that is not in riyals", () => {
      expect(pay({ payment_method: "tamara" }, null).totals.total).toBe(15510);
      expect(pay({ payment_method: "tamara", display_currency: "USD" }).fee).toBe(0);
    });

    it("lays the charge on an adopted version's own price, and takes it back off for the pin", () => {
      const adopted = { version: 1, total: 15000, base: 15510 };
      expect(pay({ payment_method: "tamara", adopted }).totals.total).toBe(16314.9);
      expect(beforeCharge(16869.61, "tamara", fees)).toBe(15510);
      expect(beforeCharge(15897.75, "link", fees)).toBe(15510);
      expect(beforeCharge(15510, undefined, fees)).toBe(15510);
      expect(beforeCharge(15510, "cash", fees)).toBe(15510);
    });
  });
});
