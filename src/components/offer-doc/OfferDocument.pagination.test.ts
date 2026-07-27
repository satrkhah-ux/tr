import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { toClientOfferDTO, type InternalOfferDTO } from "@/lib/offer/dto";
import { AR } from "./labels";

/**
 * The document lays out explicit A4 sheets, so two sections need a pager: the
 * terms and the stays. Both were fixed counts once, and both produced sheets
 * carrying two lines and nothing else. These tests lock the behaviour the
 * company asked for: the standard terms stay on ONE page, stay cards never get
 * crammed past what A4 holds, and a genuinely long list still splits.
 */
const CLAUSE = "في حال لم يكن حجم السيارة ملائمًا لعدد الركاب والأمتعة يُرجى إعلامنا مسبقًا نود التنويه بأن الأسعار تختلف حسب حجم السيارة";

function stay(city: string, notices: boolean) {
  return {
    city_name: city, hotel_name: `فندق ${city}`, stars: 5, room_type: "ديلوكس",
    board_type: "BB" as const, rooms_count: 2, nights: 3,
    check_in: "2026-06-20", check_out: "2026-06-23",
    sell_price: 100, sell_currency: "SAR", buy_price: 80, buy_currency: "SAR",
    cancellation_policy: notices ? "إلغاء مجاني حتى 48 ساعة قبل موعد الوصول" : null,
    excluded_surcharges: notices ? [{ name: "ضريبة المدينة", amount: 10, currency: "MYR" }] : [],
    valid_until: null, image_url: null, facilities: [],
    supplier_id: null, supplier_name: null, rate_key: null, net_base: null,
    net_source_currency: null, fx_rate: null, fx_date: null, ref_sell_base: null,
    markup_amount: null, markup_pct: null,
  };
}

function offer(over: Partial<InternalOfferDTO> = {}): InternalOfferDTO {
  return {
    serial: "AB-1-1000-20260620", destination: "ماليزيا",
    customer_name: "عميل", customer_phone: null, employee_name: "عبدالرزاق",
    arrival_date: "2026-06-20", departure_date: "2026-07-03", duration: null,
    offer_date: "2026-06-20", issue_date: "2026-06-20", validity_date: null,
    adults: 2, children: 0, infants: 0, total: 1000, currency: "SAR",
    hotels: [], flights: [], transport: [], visas: [],
    includes: [], excludes: [], terms: [], climate: [], days: [],
    pricing: computeOfferPricing([], { SAR: 1 }, "SAR"),
    ...over,
  };
}

const render = (o: InternalOfferDTO) =>
  renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: toClientOfferDTO(o) }));

/** Sheets whose footer label mentions this section (a sheet may carry several). */
const pagesOf = (html: string, section: string) =>
  (html.match(/data-section="([^"]*)"/g) ?? []).filter((m) => m.includes(section)).length;

/** Total sheets, cover included. */
const sheetCount = (html: string) => (html.match(/class="od-page/g) ?? []).length;

describe("terms pagination", () => {
  it("keeps the company's ten standard clauses on ONE page", () => {
    const html = render(offer({ terms: Array.from({ length: 10 }, () => CLAUSE) }));
    expect(pagesOf(html, AR.terms)).toBe(1);
  });

  it("prints no page counter — sheets are labelled by the sections they carry", () => {
    const html = render(offer({ terms: [CLAUSE, CLAUSE] }));
    expect(pagesOf(html, AR.terms)).toBe(1);
    expect(html).not.toContain("1/1");
  });

  it("never splits the terms when they would fit whole on a fresh sheet", () => {
    // ten clauses land under the services block; they must move, not spill
    const html = render(offer({ terms: Array.from({ length: 10 }, () => CLAUSE) }));
    expect(pagesOf(html, AR.terms)).toBe(1);
  });

  it("still splits a genuinely long list, numbering it continuously", () => {
    const html = render(offer({ terms: Array.from({ length: 40 }, () => CLAUSE) }));
    expect(pagesOf(html, AR.terms)).toBeGreaterThan(1);
    expect(html).toContain('start="1"');
    // the second page must resume, not restart
    expect(html).not.toMatch(/start="1"[\s\S]*start="1"/);
  });

  it("omits the section entirely when there are no terms", () => {
    expect(render(offer())).not.toContain(AR.termsContract);
  });
});

describe("stay pagination", () => {
  it("fits five lean stays on one sheet", () => {
    const hotels = ["أ", "ب", "ج", "د", "هـ"].map((c) => stay(c, false));
    expect(pagesOf(render(offer({ hotels })), AR.accommodation)).toBe(1);
  });

  it("splits stays that carry policy notices, rather than overflowing", () => {
    const hotels = ["أ", "ب", "ج", "د", "هـ", "و", "ز"].map((c) => stay(c, true));
    expect(pagesOf(render(offer({ hotels })), AR.accommodation)).toBeGreaterThanOrEqual(2);
  });

  it("keeps splitting as the itinerary grows", () => {
    const hotels = Array.from({ length: 16 }, (_, i) => stay(`مدينة ${i}`, false));
    expect(pagesOf(render(offer({ hotels })), AR.accommodation)).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The whole point of the block pager: a small offer used to print a sheet
 * carrying one visa row and nothing else. Sections must now share.
 */
describe("sheet filling", () => {
  it("puts flights, visas and a lone stay on ONE sheet", () => {
    const html = render(
      offer({
        hotels: [stay("باكو", false)],
        visas: ["تأشيرة أذربيجان"],
        flights: [
          { airline: "س", flight_no: "SV1", from_airport: "JED", to_airport: "GYD", departure_at: null, arrival_at: null, cabin_class: null, baggage_allowance: null, leg_order: "outbound", sell_price: null, sell_currency: null, buy_price: null, buy_currency: null },
        ],
      }),
    );
    const shared = (html.match(/data-section="([^"]*)"/g) ?? []).find((s) => s.includes(AR.visas));
    expect(shared).toContain(AR.flights);
    expect(shared).toContain(AR.accommodation);
  });

  it("does not grow the sheet count for a tiny offer", () => {
    const html = render(offer({ hotels: [stay("باكو", false)], visas: ["تأشيرة"], terms: [CLAUSE, CLAUSE] }));
    // cover + (visas & stay) + services + terms
    expect(sheetCount(html)).toBeLessThanOrEqual(4);
  });
});
