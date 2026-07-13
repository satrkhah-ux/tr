import { describe, it, expect } from "vitest";
import { priceSupplierRate } from "./price-line";
import type { MarkupContext, MarkupRule } from "./markup";
import type { SupplierRate } from "./rate-types";

const RATES = { SAR: 1, USD: 3.75 };
const FX_DATE = "2026-07-01";
const CTX: MarkupContext = { country: "ماليزيا", city: "كوالالمبور", supplier_id: "tbo", stars: 5, date: "2026-08-01", customer_type: "individual" };

function rule(over: Partial<MarkupRule> = {}): MarkupRule {
  return {
    id: "default", scope: "per_hotel_line", markup_type: "percentage", value: 20,
    country: null, city: null, supplier_id: null, star_rating: null,
    season_start: null, season_end: null, customer_type: null,
    is_default: true, min_margin_pct: null, rounding: null, priority: 0, ...over,
  };
}

function rate(over: Partial<SupplierRate> = {}): SupplierRate {
  return {
    supplier_id: "tbo", supplier_name: "TBO Holidays", rate_key: "RK-9",
    hotel_id: "H1", hotel_name: "فندق سيزونز كوالالمبور",
    check_in: "2026-08-01", check_out: "2026-08-05",
    occupancy: { adults: 2, children: 0, rooms: 1 },
    room_category_raw: "Deluxe Room", board_type: "BB", refundable: true,
    cancellation_policy: "إلغاء مجاني حتى 48 ساعة قبل الوصول",
    inclusive: 100, currency: "USD",
    surcharges: [
      { name: "ضريبة سياحية", amount: 10, currency: "USD", charge: "Mandatory" },
      { name: "رسوم المنتجع", amount: 20, currency: "USD", charge: "Excluded" },
    ],
    ref_sell: null, valid_until: "2026-07-20", ...over,
  };
}

describe("priceSupplierRate — end to end", () => {
  it("normalizes, marks up, and carries BOTH internal and client-safe fields", () => {
    const res = priceSupplierRate(rate(), [rule()], CTX, RATES, "SAR", FX_DATE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const line = res.line;

    // net = inclusive(375) + mandatory(37.5) = 412.5; +20% = 495
    expect(line.net).toBe(412.5);
    expect(line.sell).toBe(495);
    expect(line.profit).toBe(82.5);
    expect(line.margin_pct).toBe(16.67);
    expect(line.blocks).toEqual([]);

    // internal audit fields present
    expect(line.supplier_id).toBe("tbo");
    expect(line.rate_key).toBe("RK-9");
    expect(line.fx_rate).toBe(3.75);
    expect(line.fx_date).toBe(FX_DATE);
    expect(line.net_source_currency).toBe("USD");

    // client-safe fields present
    expect(line.board_type).toBe("BB");
    expect(line.room_category).toBe("deluxe");
    expect(line.cancellation_policy).toContain("إلغاء مجاني");
    expect(line.valid_until).toBe("2026-07-20");
    // the Excluded surcharge is carried through for "يُدفع في الفندق"
    expect(line.excluded_surcharges).toEqual([{ name: "رسوم المنتجع", amount: 20, currency: "USD", charge: "Excluded" }]);
  });

  it("BLOCKS when the marked-up sell is below the supplier floor", () => {
    // ref_sell 200 USD = 750 SAR floor; sell 495 < 750 → blocked
    const res = priceSupplierRate(rate({ ref_sell: 200 }), [rule()], CTX, RATES, "SAR", FX_DATE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.line.ref_sell_base).toBe(750);
    expect(res.line.blocks.some((b) => b.code === "below_supplier_floor")).toBe(true);
  });

  it("errors as no_fx when the rate currency has no exchange rate", () => {
    const res = priceSupplierRate(rate({ currency: "JPY" }), [rule()], CTX, RATES, "SAR", FX_DATE);
    expect(res).toEqual({ ok: false, error: "no_fx" });
  });

  it("errors as no_rule when no rule matches and no default exists", () => {
    const specific = rule({ id: "tr", is_default: false, country: "تركيا" });
    const res = priceSupplierRate(rate(), [specific], CTX, RATES, "SAR", FX_DATE);
    expect(res).toEqual({ ok: false, error: "no_rule" });
  });
});
