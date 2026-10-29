import { describe, expect, it } from "vitest";
import type { InternalOfferDTO } from "@/lib/offer/dto";
import { toClientOfferDTO } from "@/lib/offer/dto";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { repackageToPreviewOffer } from "@/lib/offer/preview-dto";
import { costInSellCurrency, PACKAGE_LINE, repackageOfferInput } from "./offer-input";
import { ADDITION_PRICE, georgiaData, georgiaPackage, SELL, SUPPLIER_COST } from "./fixture";
import { validateRepackage } from "./repackage-validation";

const RATES = { sarPer: { SAR: 1, USD: 3.75 }, source: "fallback" as const, updatedAt: "2026-10-26" };
const build = (data = georgiaData(), customerId: string | null = "cust-1") => {
  const r = repackageOfferInput(data, { customerId, importId: "imp-1", rates: RATES });
  if (!r.ok) throw new Error(`not built: ${r.error}`);
  return r.input;
};

describe("the offer a repackage issues — the client, the total, the additions", () => {
  it("the fixture is issuable (the tests below are about a file that passes the gate)", () => {
    expect(validateRepackage(georgiaData()).ok).toBe(true);
  });

  it("files the offer under the client the repackage is for, and under its import", () => {
    const input = build(georgiaData(), "cust-42");
    expect(input.customer_id).toBe("cust-42");
    expect(input.source_kind).toBe("repackaged");
    expect(input.source_import_id).toBe("imp-1");
    expect(input.destination).toBe("جورجيا");
    expect([input.adults, input.children, input.infants]).toEqual([2, 1, 0]);
  });

  it("totals the package's sell price and the priced additions; the supplier's cost is the buy side only", () => {
    const input = build();
    expect(input.total).toBe(SELL + ADDITION_PRICE);
    expect(input.buy_total).toBe(SUPPLIER_COST);
    expect(input.currency).toBe("SAR");
  });

  it("prints the additions in the includes list, after the package's own — priced or not", () => {
    const labels = build().services.filter((s) => s.kind === "include").map((s) => s.label);
    expect(labels.slice(0, 2)).toEqual(["الإقامة في الفنادق", "الإفطار اليومي"]);
    expect(labels.slice(-2)).toEqual(["جولة نهرية — ساعتان مع مرشد", "شريحة اتصال"]);
    // the excludes are untouched
    expect(build().services.filter((s) => s.kind === "exclude").map((s) => s.label)).toEqual(["التأشيرة", "المصاريف الشخصية"]);
  });

  it("a priced addition is its own pricing line with NO cost; an unpriced one has no line; the package line holds the cost", () => {
    const items = build().pricing_items!;
    expect(items.map((i) => [i.description, i.sell_price, i.buy_price])).toEqual([
      [PACKAGE_LINE, SELL, SUPPLIER_COST],
      ["جولة نهرية", ADDITION_PRICE, null],
    ]);
    // the supplier's cost is in the supplier's own currency on the package line
    expect(items[0].buy_currency).toBe("SAR");
    expect(items[1].buy_currency).toBeNull();
  });

  it("a hotel line carries facts only — no cost, no supplier", () => {
    for (const h of build().hotels!) {
      expect([h.buy_price, h.buy_currency, h.sell_price, h.supplier_id, h.supplier_name]).toEqual([null, null, null, null, null]);
    }
  });

  it("flights the agent typed travel with the supplier's own", () => {
    const own = { airline: "SV", flight_no: "SV9", from_airport: "TBS", to_airport: "RUH", departure_at: "2026-11-15T20:00", arrival_at: null, added: true as const };
    const data = georgiaData({ extracted: georgiaPackage({ flights: [...georgiaPackage().flights, own] }) });
    expect(build(data).flights.map((f) => f.flight_no)).toEqual(["AT100", "SV9"]);
  });

  it("without additions it is the offer it always was", () => {
    const input = build(georgiaData({ additions: [] }));
    expect(input.total).toBe(SELL);
    expect(input.pricing_items).toHaveLength(1);
    expect(input.services.filter((s) => s.kind === "include")).toHaveLength(3); // 2 includes + the transfer line
  });

  it("converts the supplier's cost into the sell currency, and stops rather than store it in the wrong one", () => {
    expect(costInSellCurrency(100, "USD", "SAR", { SAR: 1, USD: 3.75 })).toEqual({ ok: true, amount: 375 });
    expect(costInSellCurrency(375, "SAR", "USD", { SAR: 1, USD: 3.75 })).toEqual({ ok: true, amount: 100 });
    expect(costInSellCurrency(100, "SAR", "sar", { SAR: 1 })).toEqual({ ok: true, amount: 100 });
    expect(costInSellCurrency(null, "USD", "SAR", { SAR: 1 })).toEqual({ ok: true, amount: null });
    expect(costInSellCurrency(100, "EUR", "SAR", { SAR: 1 })).toEqual({ ok: false });

    const usd = georgiaData({ extracted: georgiaPackage({ supplier_total: 2000, supplier_currency: "USD" }) });
    expect(build(usd).buy_total).toBe(7500);
    const unknown = georgiaData({ extracted: georgiaPackage({ supplier_currency: "EUR" }) });
    expect(repackageOfferInput(unknown, { customerId: null, importId: "i", rates: RATES })).toEqual({ ok: false, error: "missingRates" });
  });
});

describe("the supplier's cost never reaches the client's document", () => {
  const input = build();

  /** The internal view of what the input would store — priced the way loadInternalOffer prices it. */
  function internalOf(): InternalOfferDTO {
    const lines = input.pricing_items!.map((p) => ({ ...p }));
    return {
      serial: "AD-1-1000-20261026",
      destination: input.destination,
      customer_name: "عميل تجريبي",
      customer_phone: "0500000000",
      employee_name: null,
      arrival_date: input.offer_date,
      departure_date: "2026-11-15",
      duration: input.duration,
      offer_date: input.offer_date,
      issue_date: null,
      validity_date: null,
      adults: input.adults,
      children: input.children,
      infants: input.infants,
      total: input.total,
      currency: input.currency,
      hotels: input.hotels!.map((h) => ({
        city_name: null,
        hotel_name: h.hotel_name,
        stars: null,
        room_type: h.room_type_name ?? null,
        board_type: h.board_type,
        rooms_count: h.rooms_count,
        nights: h.nights,
        check_in: h.check_in,
        check_out: h.check_out,
        sell_price: h.sell_price,
        sell_currency: h.sell_currency,
        buy_price: h.buy_price,
        buy_currency: h.buy_currency,
        cancellation_policy: null,
        excluded_surcharges: [],
        valid_until: null,
        image_url: null,
        facilities: [],
        supplier_id: h.supplier_id ?? null,
        supplier_name: h.supplier_name ?? null,
        rate_key: null,
        net_base: null,
        net_source_currency: null,
        fx_rate: null,
        fx_date: null,
        ref_sell_base: null,
        markup_amount: null,
        markup_pct: null,
      })),
      flights: [],
      transport: [],
      visas: [],
      includes: input.services.filter((s) => s.kind === "include").map((s) => s.label),
      excludes: input.services.filter((s) => s.kind === "exclude").map((s) => s.label),
      terms: input.terms,
      climate: [],
      days: [],
      pricing: computeOfferPricing(lines, { SAR: 1 }, "SAR"),
    };
  }

  it("the internal sheet adds up: the package and the addition, cost and profit — that is where the cost lives", () => {
    const pricing = internalOf().pricing;
    expect(pricing.total_sell).toBe(SELL + ADDITION_PRICE);
    expect(pricing.total_buy).toBe(SUPPLIER_COST);
    expect(pricing.profit).toBe(SELL + ADDITION_PRICE - SUPPLIER_COST);
  });

  it("the client tree carries the total and the addition, and nothing of the cost, the profit or a buy key", () => {
    const client = JSON.stringify(toClientOfferDTO(internalOf()));
    expect(client).toContain(String(SELL + ADDITION_PRICE));
    expect(client).toContain("جولة نهرية — ساعتان مع مرشد");
    expect(client).not.toContain(String(SUPPLIER_COST));
    expect(client).not.toMatch(/buy_|total_buy|profit|margin|supplier/);
  });

  it("the preview the agent sees is the same: our total, the addition in the list, never the cost", () => {
    const preview = repackageToPreviewOffer(georgiaData())!;
    expect(preview.total).toBe(SELL + ADDITION_PRICE);
    expect(preview.includes.slice(-2)).toEqual(["جولة نهرية — ساعتان مع مرشد", "شريحة اتصال"]);
    expect(preview.customer_name).toBe("عميل تجريبي");
    const json = JSON.stringify(preview);
    expect(json).not.toContain(String(SUPPLIER_COST));
    expect(json).not.toContain("supplier");
  });
});
