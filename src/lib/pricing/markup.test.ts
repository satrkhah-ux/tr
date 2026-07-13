import { describe, it, expect } from "vitest";
import {
  applyMarkup,
  applyRounding,
  blockReasonAr,
  computeMarkup,
  computeSell,
  ruleMatches,
  selectRule,
  sellBlocks,
  type MarkupContext,
  type MarkupRule,
} from "./markup";

function rule(over: Partial<MarkupRule>): MarkupRule {
  return {
    id: "r",
    scope: "per_hotel_line",
    markup_type: "percentage",
    value: 15,
    country: null,
    city: null,
    supplier_id: null,
    star_rating: null,
    season_start: null,
    season_end: null,
    customer_type: null,
    is_default: false,
    min_margin_pct: null,
    rounding: null,
    priority: 0,
    ...over,
  };
}

const CTX: MarkupContext = { country: "ماليزيا", city: "كوالالمبور", supplier_id: "tbo", stars: 5, date: "2026-08-01", customer_type: "individual" };

describe("applyMarkup + applyRounding", () => {
  it("percentage and fixed", () => {
    expect(applyMarkup(1000, rule({ markup_type: "percentage", value: 15 }))).toBe(1150);
    expect(applyMarkup(1000, rule({ markup_type: "fixed", value: 200 }))).toBe(1200);
  });
  it("rounding up / nearest / down to a step", () => {
    expect(applyRounding(1133, { mode: "up", step: 5 })).toBe(1135);
    expect(applyRounding(1133, { mode: "down", step: 5 })).toBe(1130);
    expect(applyRounding(1133, { mode: "nearest", step: 5 })).toBe(1135);
    expect(applyRounding(1130, { mode: "up", step: 5 })).toBe(1130); // exact multiple stays put
    expect(applyRounding(1133.2, null)).toBe(1133.2); // no rule
  });
});

describe("computeSell — the atom", () => {
  it("PERCENTAGE markup: net→sell, profit, margin", () => {
    const c = computeSell(1000, rule({ markup_type: "percentage", value: 15 }));
    expect(c.sell).toBe(1150);
    expect(c.profit).toBe(150);
    expect(c.markup_pct).toBe(15); // on net
    expect(c.margin_pct).toBe(13.04); // 150 / 1150 (on sell)
    expect(c.blocks).toEqual([]);
  });

  it("FIXED markup", () => {
    const c = computeSell(1000, rule({ markup_type: "fixed", value: 200 }));
    expect(c.sell).toBe(1200);
    expect(c.profit).toBe(200);
  });

  it("ROUNDING up to nearest 5 is applied and flagged", () => {
    const c = computeSell(1000, rule({ markup_type: "percentage", value: 13.3, rounding: { mode: "up", step: 5 } }));
    // raw = 1133 → up to nearest 5 = 1135
    expect(c.sell).toBe(1135);
    expect(c.rounding_applied).toBe(true);
  });

  it("MINIMUM MARGIN floor BLOCKS a too-thin sell", () => {
    // 5% markup → sell 1050, margin = 50/1050 = 4.76% < 10% floor
    const c = computeSell(1000, rule({ markup_type: "percentage", value: 5, min_margin_pct: 10 }));
    expect(c.margin_pct).toBe(4.76);
    expect(c.blocks).toHaveLength(1);
    expect(c.blocks[0]).toMatchObject({ code: "below_min_margin", min_margin_pct: 10 });
    expect(blockReasonAr(c.blocks[0])).toContain("هامش الربح");
  });

  it("does NOT block when margin meets the floor", () => {
    const c = computeSell(1000, rule({ markup_type: "percentage", value: 20, min_margin_pct: 10 }));
    expect(c.blocks).toEqual([]); // margin 200/1200 = 16.67% ≥ 10%
  });

  it("SUPPLIER FLOOR BLOCKS a sell below the supplier reference/min price", () => {
    const c = computeSell(1000, rule({ markup_type: "percentage", value: 15 }), { floor: 1300 });
    expect(c.sell).toBe(1150); // NOT silently raised
    expect(c.blocks).toHaveLength(1);
    expect(c.blocks[0]).toMatchObject({ code: "below_supplier_floor", floor: 1300, sell: 1150 });
    expect(blockReasonAr(c.blocks[0])).toContain("الحد الأدنى للمورّد");
  });

  it("does NOT block when sell meets the supplier floor", () => {
    const c = computeSell(1000, rule({ markup_type: "percentage", value: 15 }), { floor: 1100 });
    expect(c.blocks).toEqual([]); // 1150 ≥ 1100
  });

  it("BLOCKS a NEGATIVE sell from a fixed markup larger than net (inverted margin trap)", () => {
    // net 200, fixed -500 → sell -300; profit/sell both negative → margin looks +166%
    const c = computeSell(200, rule({ markup_type: "fixed", value: -500 }));
    expect(c.sell).toBe(-300);
    expect(c.blocks.some((b) => b.code === "invalid_sell")).toBe(true);
    expect(blockReasonAr(c.blocks.find((b) => b.code === "invalid_sell")!)).toContain("غير صالح");
  });

  it("min-margin floor uses the UNROUNDED margin (9.996% does NOT round up past a 10% floor)", () => {
    // net 900.04, fixed +99.96 → sell 1000; true margin 9.996% < 10% → must block
    const c = computeSell(900.04, rule({ markup_type: "fixed", value: 99.96, min_margin_pct: 10 }));
    expect(c.sell).toBe(1000);
    expect(c.margin_pct).toBe(10); // display rounds to 10.00…
    expect(c.blocks.some((b) => b.code === "below_min_margin")).toBe(true); // …but the floor check does NOT
  });
});

describe("sellBlocks — re-check a KNOWN net/sell (publish gate)", () => {
  it("flags a sell edited below the supplier floor after pricing", () => {
    expect(sellBlocks(1000, 1000, { floor: 1300 }).some((b) => b.code === "below_supplier_floor")).toBe(true);
  });
  it("flags a sell edited below the minimum margin", () => {
    expect(sellBlocks(950, 1000, { minMarginPct: 10 }).some((b) => b.code === "below_min_margin")).toBe(true);
  });
  it("flags a non-positive sell", () => {
    expect(sellBlocks(200, -50, {}).some((b) => b.code === "invalid_sell")).toBe(true);
  });
  it("passes a sell that meets both floors", () => {
    expect(sellBlocks(1000, 1400, { minMarginPct: 10, floor: 1300 })).toEqual([]);
  });
});

describe("selectRule — most specific wins, default fallback", () => {
  const def = rule({ id: "default", is_default: true, value: 10 });
  const country = rule({ id: "country", country: "ماليزيا", value: 15 });
  const countryStar = rule({ id: "country5", country: "ماليزيا", star_rating: 5, value: 20 });
  const summer = rule({ id: "summer", season_start: "06-01", season_end: "08-31", value: 25 });

  it("picks the most specific matching rule", () => {
    expect(selectRule([def, country, countryStar], CTX)!.id).toBe("country5");
  });
  it("falls back to the default when nothing more specific matches", () => {
    const other: MarkupContext = { ...CTX, country: "تركيا", stars: 3 };
    expect(selectRule([def, country, countryStar], other)!.id).toBe("default");
  });
  it("returns null when no rule matches and there is no default", () => {
    const other: MarkupContext = { ...CTX, country: "تركيا" };
    expect(selectRule([country, countryStar], other)).toBeNull();
  });
  it("matches an inclusive season window (wrap-aware)", () => {
    expect(ruleMatches(summer, { ...CTX, date: "2026-07-15" })).toBe(true);
    expect(ruleMatches(summer, { ...CTX, date: "2026-01-15" })).toBe(false);
    const winter = rule({ season_start: "12-01", season_end: "02-28" });
    expect(ruleMatches(winter, { ...CTX, date: "2026-01-10" })).toBe(true); // wrap-around
    expect(ruleMatches(winter, { ...CTX, date: "2026-06-10" })).toBe(false);
  });
});

describe("computeMarkup — scope", () => {
  const lines = [
    { key: "h1", net: 500, room_nights: 5 },
    { key: "h2", net: 500, room_nights: 4 },
  ];

  it("PACKAGE scope marks up the whole package ONCE", () => {
    const r = computeMarkup(lines, rule({ scope: "package", markup_type: "percentage", value: 20 }));
    expect(r.scope).toBe("package");
    expect(r.total.net).toBe(1000);
    expect(r.total.sell).toBe(1200); // 1000 * 1.2
    expect(r.total.profit).toBe(200);
    // per-line rows pass through at net (all profit is at package level)
    expect(r.lines.map((l) => l.sell)).toEqual([500, 500]);
  });

  it("PER-HOTEL-LINE scope marks up each line", () => {
    const r = computeMarkup(lines, rule({ scope: "per_hotel_line", markup_type: "percentage", value: 10 }));
    expect(r.lines.map((l) => l.sell)).toEqual([550, 550]);
    expect(r.total.sell).toBe(1100);
    expect(r.total.profit).toBe(100);
  });

  it("PER-ROOM-NIGHT scope marks up the per-room-night net then scales", () => {
    // line net 1000 over 5 room-nights = 200/night; +15% = 230/night; ×5 = 1150
    const r = computeMarkup([{ key: "h1", net: 1000, room_nights: 5 }], rule({ scope: "per_room_night", markup_type: "percentage", value: 15 }));
    expect(r.lines[0].sell).toBe(1150);
    expect(r.total.sell).toBe(1150);
  });

  it("propagates a supplier-floor block from a line to the offer", () => {
    const r = computeMarkup([{ key: "h1", net: 1000, room_nights: 5, floor: 1300 }], rule({ scope: "per_hotel_line", value: 15 }));
    expect(r.blocks.some((b) => b.code === "below_supplier_floor")).toBe(true);
  });
});
