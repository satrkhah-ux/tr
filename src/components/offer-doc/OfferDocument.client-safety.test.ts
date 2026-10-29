import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { toClientOfferDTO, type InternalOfferDTO } from "@/lib/offer/dto";
import { AR } from "./labels";
import { issuePricing } from "@/lib/offer/issue-pricing";
import { methodsForFees, sessionEFee, withMethodFees } from "@/lib/offer/payment-methods";
import { DEFAULT_FEES } from "@/lib/payments/methods";

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
    days: [],
    pricing,
  };
}

describe("client OfferDocument — content + safety", () => {
  const client = toClientOfferDTO(internalOffer());
  const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: client }));

  it("SHOWS the client-safe fields (sell + board + room + cancellation + pay-at-hotel)", () => {
    expect(html).toContain(AR.total); // the price block (sell) renders
    expect(html).toContain("4,600"); // the sell total
    expect(html).toContain("شامل الإفطار"); // board type BB
    expect(html).toContain("ديلوكس"); // room type
    expect(html).toContain("إلغاء مجاني"); // cancellation policy
    expect(html).toContain("يُدفع في الفندق مباشرة"); // excluded-surcharges label
    expect(html).toContain("رسوم المنتجع"); // the excluded surcharge name
    expect(html).toContain("★★★★★"); // the star rating
    expect(html).toContain("2026-08-01"); // check-in
    expect(html).toContain("2026-08-05"); // check-out
    expect(html).toContain(AR.nightsCount(4)); // nights on the date box
  });

  /**
   * The stay card carries no photo and no facility chips — the approved layout
   * gives each stay three columns (dates · hotel · rooms) and nothing else. The
   * fields still travel in the DTO; only this document stops printing them.
   */
  it("does not print hotel photos or facility chips", () => {
    expect(html).not.toContain("data:image/svg+xml"); // the fixture's hotel image
    expect(html).not.toContain("أمور ترفيهية");
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

/**
 * «طريقة دفع العميل» (the owner, 2026-10-29): a file priced 15,510 that the client pays by Tamara issues at
 * 16,869.61 (issue-pricing.ts). The PDF prints that total — and, binding (Tabby/Tamara/MyFatoorah terms),
 * never the charge, its share or the word «رسوم»; a country's instalment lines quote each way on OUR price
 * (pricings.sell_total), so the chosen one reads the very same total and none is charged twice.
 */
describe("client OfferDocument — a chosen payment method", () => {
  const fees = { ...DEFAULT_FEES };
  const issued = issuePricing(
    [{ item_type: "service", description: "برنامج", quantity: 1, buy_price: 14100, buy_currency: "SAR", sell_price: 15510, sell_currency: "SAR" }],
    { pricing: { items: [], display_currency: "SAR", final_total: 15510, payment_method: "tamara" } },
    new Set(),
    null,
    { SAR: 1 },
    fees,
  );
  const base = internalOffer();
  const offer: InternalOfferDTO = {
    ...base,
    total: issued.totals.total,
    hotels: base.hotels.map((h) => ({ ...h, excluded_surcharges: [] })),
    finance: {
      banks: [],
      payments: [],
      instalment: withMethodFees(["التقسيط عبر تمارا", "التقسيط عبر تابي"], issued.base, methodsForFees(), sessionEFee(fees)),
    },
  };
  const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: toClientOfferDTO(offer) }));
  // what the page says — not its stylesheet (full of «%»)
  const text = html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

  it("prints the Tamara total, quoted once", () => {
    expect(issued.totals.total).toBe(16869.61);
    expect(text).toContain("16,869.61");
    expect(text).not.toContain("18,348"); // the charge laid twice
  });

  it("never says the charge, its share or «رسوم»", () => {
    expect(text).not.toContain("رسوم");
    expect(text).not.toContain("%");
    expect(text).not.toContain("1,359.61"); // the charge itself
    expect(text).not.toContain("8.766");
  });
});

/** «ادفع الآن» (the owner, 2026-10-29): the button points at OUR stable page, and says the total's way only. */
describe("client OfferDocument — «ادفع الآن»", () => {
  const offer = toClientOfferDTO({ ...internalOffer(), total: 16869.61 });
  const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer, payUrl: "https://pkg.traveliun.com/pay/AD-7-1000" }));
  const text = html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

  it("links to /pay/<serial>, never to a MyFatoorah invoice", () => {
    expect(html).toContain('href="https://pkg.traveliun.com/pay/AD-7-1000"');
    expect(text).toContain("ادفع الآن");
    expect(html).not.toContain("myfatoorah.com");
  });

  it("no button without the link, and no fee wording with it", () => {
    expect(renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer }))).not.toContain("ادفع الآن");
    // the button says the way to pay and nothing else (the fixture's hotel resort fee is the hotel's, printed elsewhere)
    expect(html.match(/<a class="od-paynow"[^>]*>([^<]*)<\/a>/)?.[1]).toBe("ادفع الآن");
  });
});

/** «ادفع بتمارا — قسّمها» (the owner, 2026-10-29): only for an offer issued with Tamara, to /pay/<serial>?m=tamara. */
describe("client OfferDocument — the Tamara button", () => {
  const offer = toClientOfferDTO({ ...internalOffer(), total: 16869.61 });
  const url = "https://pkg.traveliun.com/pay/AD-7-1000?m=tamara";
  const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer, payUrl: url, payVia: "tamara" }));
  const button = html.match(/<a class="od-paytamara"[^>]*>([\s\S]*?)<\/a>/);

  it("a branded Tamara button linking to our page — and no MyFatoorah button beside it", () => {
    expect(html).toContain('href="https://pkg.traveliun.com/pay/AD-7-1000?m=tamara"');
    expect(button?.[1]).toContain("<svg");
    expect(button?.[1]).toContain("ادفع بتمارا — قسّمها");
    expect(html).not.toContain("<a class=\"od-paynow\"");
    expect(html).not.toContain("tamara.co");
  });

  it("no fee wording on the button; a MyFatoorah offer never shows it", () => {
    expect(button?.[1].replace(/<[^>]+>/g, "")).toBe("ادفع بتمارا — قسّمها");
    const mf = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer, payUrl: "https://pkg.traveliun.com/pay/AD-7-1000" }));
    expect(mf).not.toContain("<a class=\"od-paytamara\"");
    expect(mf).not.toContain("قسّمها");
  });
});
