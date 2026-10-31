import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { AR } from "./labels";
import { emptyDraftData, normalizeDraftHotel } from "@/lib/offer/draft-types";
import { draftToPreviewOffer } from "@/lib/offer/preview-dto";

/**
 * «خطة الدفع» and the hotels' refund terms under «الشروط المالية» (the owner, 2026-10-31): the client reads the first
 * payment, the dues on their dates and each hotel's refund deadline — amounts only, never a profit.
 */
describe("OfferDocument — the file's payment plan and refund terms", () => {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-12-20", nights: 4, days: 5, adults: 2 };
  data.cities = [{ city_name: "كوالالمبور", nights: 4, check_in: null, check_out: null }];
  data.hotels = [normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق أ", rooms_count: 1, room_type_name: "ديلوكس", board_type: "BB", refundable: true, refundable_until: "2026-12-01" })];
  data.pricing = {
    ...data.pricing,
    items: [{ item_type: "hotel", description: "فندق أ", quantity: 1, buy_price: 6000, buy_currency: "SAR", sell_price: 8000, sell_currency: "SAR" }],
    plan: { deposit: { amount: 2000, refundable: false, note: "تُخصم من إجمالي الباقة" }, payments: [{ date: "2026-12-01", amount: 6000 }] },
  };
  const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: draftToPreviewOffer(data) }));
  if (process.env.FINANCE_DOC_OUT) writeFileSync(process.env.FINANCE_DOC_OUT, `<!doctype html><meta charset="utf-8">${html}`);

  it("prints the first payment, the dues and the refund deadline", () => {
    expect(html).toContain(AR.financeTerms);
    expect(html).toContain("الدفعة الأولى لتثبيت الحجز: 2,000 ريال (غير مسترجعة) — تُخصم من إجمالي الباقة");
    expect(html).toContain("الدفعة الثانية: 6,000 ريال — حتى 2026-12-01");
    expect(html).toContain(AR.financeRefunds);
    expect(html).toContain("فندق أ: قابل للاسترداد حتى 2026-12-01");
    expect(html).not.toMatch(/ربح|أرباح|6000|6,000 SAR/);
  });
});
