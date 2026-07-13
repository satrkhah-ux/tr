import { describe, it, expect } from "vitest";
import {
  areComparable,
  comparabilityDiff,
  comparabilityKey,
  exclusionReasonsAr,
  groupComparable,
  normalizeRate,
  normalizeRoomCategory,
  rankComparable,
  type NormalizedRate,
} from "./normalize";
import type { SupplierRate } from "./rate-types";

// SAR per 1 unit of currency (matches getRates().sarPer). base = SAR.
const RATES = { SAR: 1, USD: 3.75, EUR: 4.06 };
const FX_DATE = "2026-07-01";

function rate(over: Partial<SupplierRate>): SupplierRate {
  return {
    supplier_id: "tbo",
    supplier_name: "TBO Holidays",
    rate_key: "RK1",
    hotel_id: "H1",
    hotel_name: "فندق سيزونز",
    check_in: "2026-08-01",
    check_out: "2026-08-05",
    occupancy: { adults: 2, children: 0, rooms: 1 },
    room_category_raw: "Deluxe Room",
    board_type: "BB",
    refundable: true,
    cancellation_policy: "إلغاء مجاني حتى 48 ساعة قبل الوصول",
    inclusive: 100,
    currency: "USD",
    surcharges: [],
    ref_sell: null,
    valid_until: "2026-07-20",
    ...over,
  };
}

describe("normalizeRoomCategory", () => {
  it("collapses AR/EN labels to canonical categories", () => {
    expect(normalizeRoomCategory("Deluxe Room")).toBe("deluxe");
    expect(normalizeRoomCategory("غرفة ديلوكس")).toBe("deluxe");
    expect(normalizeRoomCategory("Superior Twin")).toBe("superior");
    expect(normalizeRoomCategory("Junior Suite")).toBe("junior_suite"); // more specific than "suite"
    expect(normalizeRoomCategory("جناح")).toBe("suite");
    expect(normalizeRoomCategory("Family Room")).toBe("family");
    expect(normalizeRoomCategory("Standard")).toBe("standard");
    expect(normalizeRoomCategory("Pod Capsule")).toBe("other");
    expect(normalizeRoomCategory("")).toBe("other");
  });
});

describe("normalizeRate — comparable total & surcharges", () => {
  it("a Mandatory surcharge IS included in the comparable total (converted to base)", () => {
    const n = normalizeRate(
      rate({ inclusive: 100, currency: "USD", surcharges: [{ name: "ضريبة المدينة", amount: 10, currency: "USD", charge: "Mandatory" }] }),
      RATES, "SAR", FX_DATE,
    )!;
    expect(n.net_inclusive_base).toBe(375); // 100 * 3.75
    expect(n.mandatory_base).toBe(37.5); // 10 * 3.75
    expect(n.comparable_total_base).toBe(412.5); // included
    expect(n.excluded_surcharges).toEqual([]);
    expect(n.fx_rate).toBe(3.75);
    expect(n.fx_date).toBe(FX_DATE);
  });

  it("an Excluded surcharge is NOT in the total but IS retained verbatim for client display", () => {
    const n = normalizeRate(
      rate({
        inclusive: 100,
        currency: "USD",
        surcharges: [
          { name: "رسوم المنتجع", amount: 20, currency: "USD", charge: "Excluded" },
          { name: "ضريبة سياحية", amount: 8, currency: "USD", charge: "Mandatory" },
        ],
      }),
      RATES, "SAR", FX_DATE,
    )!;
    // total = 375 (inclusive) + 30 (mandatory 8*3.75) — the Excluded 20 is NOT added
    expect(n.mandatory_base).toBe(30);
    expect(n.comparable_total_base).toBe(405);
    // …but the Excluded surcharge survives, name + amount intact, un-converted
    expect(n.excluded_surcharges).toHaveLength(1);
    expect(n.excluded_surcharges[0]).toEqual({ name: "رسوم المنتجع", amount: 20, currency: "USD", charge: "Excluded" });
  });

  it("returns null when the rate currency has no fx (never guesses a comparable total)", () => {
    expect(normalizeRate(rate({ currency: "JPY" }), RATES, "SAR", FX_DATE)).toBeNull();
  });

  it("converts a supplier ref-sell floor into base", () => {
    const n = normalizeRate(rate({ ref_sell: 130, currency: "USD" }), RATES, "SAR", FX_DATE)!;
    expect(n.ref_sell_base).toBe(487.5); // 130 * 3.75
  });
});

describe("comparability — non-comparable rates are never ranked together", () => {
  const nights = (r: SupplierRate) => normalizeRate(r, RATES, "SAR", FX_DATE)!;

  it("a non-refundable RO rate is NOT comparable to a refundable BB rate", () => {
    const ro = nights(rate({ rate_key: "RO", board_type: "RO", refundable: false, room_category_raw: "Standard", inclusive: 90 }));
    const bb = nights(rate({ rate_key: "BB", board_type: "BB", refundable: true, room_category_raw: "Standard", inclusive: 100 }));

    expect(areComparable(ro, bb)).toBe(false);
    expect(comparabilityKey(ro)).not.toBe(comparabilityKey(bb));

    // grouping keeps them apart — two groups of one, never ranked against each other
    const groups = groupComparable([ro, bb]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.rates.length === 1)).toBe(true);

    // and the exclusion reasons are explicit
    const diff = comparabilityDiff(ro, bb);
    expect(diff).toContain("board");
    expect(diff).toContain("refundability");
    expect(exclusionReasonsAr(diff)).toEqual(expect.arrayContaining(["نظام وجبات مختلف", "غير قابل للاسترداد"]));
  });

  it("ranks genuinely comparable rates cheapest-first within ONE group", () => {
    const cheap = nights(rate({ rate_key: "cheap", inclusive: 90 }));
    const dear = nights(rate({ rate_key: "dear", inclusive: 120 }));
    const groups = groupComparable([dear, cheap]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rates.map((r) => r.rate_key)).toEqual(["cheap", "dear"]);
    expect(rankComparable([dear, cheap])[0].rate_key).toBe("cheap");
  });

  it("different occupancy / room category / dates each break comparability", () => {
    const base = nights(rate({}));
    const occ = nights(rate({ occupancy: { adults: 3, children: 0, rooms: 1 } }));
    const room = nights(rate({ room_category_raw: "Suite" }));
    const dates = nights(rate({ check_in: "2026-09-01", check_out: "2026-09-05" }));
    expect(comparabilityDiff(base, occ)).toContain("occupancy");
    expect(comparabilityDiff(base, room)).toContain("room_category");
    expect(comparabilityDiff(base, dates)).toContain("dates");
  });

  it("does NOT merge two UNRECOGNIZED rooms just because both normalize to 'other'", () => {
    const villa = nights(rate({ rate_key: "villa", room_category_raw: "Overwater Villa", inclusive: 1000 }));
    const garden = nights(rate({ rate_key: "garden", room_category_raw: "Garden View Room", inclusive: 200 }));
    expect(villa.room_category).toBe("other");
    expect(garden.room_category).toBe("other");
    expect(areComparable(villa, garden)).toBe(false); // different raw label
    expect(comparabilityDiff(villa, garden)).toContain("room_category");
    expect(groupComparable([villa, garden])).toHaveLength(2); // NOT ranked $200 vs $1000
  });

  it("still merges two rooms sharing the same unrecognized label (case-insensitive)", () => {
    const a = nights(rate({ rate_key: "a", room_category_raw: "Overwater Villa", inclusive: 900 }));
    const b = nights(rate({ rate_key: "b", room_category_raw: "overwater villa", inclusive: 1000 }));
    expect(areComparable(a, b)).toBe(true);
    expect(groupComparable([a, b])).toHaveLength(1);
  });

  it("is N-supplier ready: the same room from two suppliers ranks together by price", () => {
    const a = nights(rate({ supplier_id: "tbo", rate_key: "A", inclusive: 110 }));
    const b: NormalizedRate = nights(rate({ supplier_id: "agoda", rate_key: "B", inclusive: 100 }));
    const groups = groupComparable([a, b]);
    expect(groups).toHaveLength(1); // supplier is NOT part of the comparability key
    expect(groups[0].rates.map((r) => r.supplier_id)).toEqual(["agoda", "tbo"]); // cheapest first
  });
});
