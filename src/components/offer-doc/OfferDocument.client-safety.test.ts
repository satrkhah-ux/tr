import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { toClientOfferDTO, type InternalOfferDTO } from "@/lib/offer/dto";

/**
 * The definitive client-safety proof: render the EXACT component the client PDF
 * prints (offer-doc/OfferDocument, client variant) from an offer that was priced
 * from a supplier, and assert the rendered HTML shows the client-safe fields
 * (sell / board / room / cancellation / "يُدفع في الفندق") and contains ZERO
 * net price, supplier name, rate_key, or margin. The PDF is just this HTML
 * printed by Chromium, so this is the content contract.
 */
function internalOffer(): InternalOfferDTO {
  const pricing = computeOfferPricing(
    [{ item_type: "hotel", quantity: 1, buy_price: 3833.33, buy_currency: "SAR", sell_price: 4600, sell_currency: "SAR" }],
    { SAR: 1 },
    "SAR",
  );
  return {
    serial: "AD-1-4600-20260801",
    destination: "ماليزيا",
    customer_name: "نايف الجهني",
    customer_phone: "0555123456",
    employee_name: "الإدارة",
    arrival_date: "2026-08-01",
    departure_date: "2026-08-05",
    duration: "4 ليالٍ",
    offer_date: "2026-08-01",
    issue_date: "2026-07-20",
    validity_date: "2026-08-03",
    adults: 2,
    children: 0,
    infants: 0,
    total: 4600,
    currency: "SAR",
    hotels: [
      {
        city_name: "كوالالمبور",
        hotel_name: "فندق سيزونز",
        stars: 5,
        room_type: "ديلوكس",
        board_type: "BB",
        rooms_count: 1,
        nights: 4,
        check_in: "2026-08-01",
        check_out: "2026-08-05",
        sell_price: 4600,
        sell_currency: "SAR",
        buy_price: 3833.33,
        buy_currency: "SAR",
        // client-safe
        cancellation_policy: "إلغاء مجاني حتى 48 ساعة قبل موعد الوصول",
        excluded_surcharges: [{ name: "رسوم المنتجع", amount: 20, currency: "USD" }],
        valid_until: "2026-07-20",
        image_url: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
        facilities: ["pool", "wifi", "gym"],
        // INTERNAL — must NOT appear in the rendered client HTML
        supplier_id: "tbo",
        supplier_name: "TBO Holidays",
        rate_key: "RK-SECRET-42",
        net_base: 3833.33,
        net_source_currency: "USD",
        fx_rate: 3.75,
        fx_date: "2026-07-01",
        ref_sell_base: 4000,
        markup_amount: 766.67,
        markup_pct: 20,
      },
    ],
    flights: [],
    transport: [],
    visas: [],
    includes: ["الفنادق"],
    excludes: [],
    terms: ["قابل للتعديل"],
    climate: [],
    pricing,
  };
}

describe("client OfferDocument — content + safety", () => {
  const client = toClientOfferDTO(internalOffer());
  const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: client }));

  it("SHOWS the client-safe fields (sell + board + room + cancellation + pay-at-hotel)", () => {
    expect(html).toContain("سعر البكج"); // the price section (sell) renders
    expect(html).toContain("4,600"); // the sell total
    expect(html).toContain("شامل الإفطار"); // board type BB
    expect(html).toContain("ديلوكس"); // room type
    expect(html).toContain("إلغاء مجاني"); // cancellation policy
    expect(html).toContain("يُدفع في الفندق مباشرة"); // excluded-surcharges label
    expect(html).toContain("رسوم المنتجع"); // the excluded surcharge name
    expect(html).toContain("data:image"); // the hotel image
    expect(html).toContain("أمور ترفيهية"); // facilities label
    expect(html).toContain("مسبح"); // pool facility (Arabic)
  });

  it("contains ZERO net price, supplier name, rate_key, or margin", () => {
    expect(html).not.toContain("TBO Holidays"); // supplier name
    expect(html).not.toContain("RK-SECRET-42"); // rate_key
    expect(html).not.toContain("3833.33"); // the net (cost basis)
    expect(html).not.toContain("3,833"); // net, formatted
    expect(html).not.toContain("766.67"); // markup amount
    expect(html).not.toContain("الهامش"); // margin label (internal-only section)
    expect(html).not.toContain("الشراء"); // "buy" label (internal-only)
    // and none of the internal key names survive the redaction
    for (const key of ["supplier_id", "supplier_name", "rate_key", "net_base", "fx_rate", "ref_sell_base", "markup_amount"]) {
      expect(html).not.toContain(key);
    }
  });
});
