import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "./OfferDocument";
import { coverImagePath } from "./cover-image";
import { computeOfferPricing } from "@/lib/offer/pricing";
import { toClientOfferDTO, type InternalOfferDTO } from "@/lib/offer/dto";

/** «الغلاف الفني» (2026-10-29): optional first page; the employee's labels never reach the document. */
function offer(over: Partial<InternalOfferDTO> = {}): InternalOfferDTO {
  return {
    serial: "AB-1-1000-20261029", destination: "ماليزيا",
    customer_name: "أحمد العتيبي", customer_phone: null, employee_name: "عبدالرزاق",
    arrival_date: "2026-11-20", departure_date: "2026-11-27", duration: null,
    offer_date: "2026-10-29", issue_date: "2026-10-29", validity_date: null,
    adults: 2, children: 1, infants: 0, total: 1000, currency: "SAR",
    hotels: [], flights: [], transport: [], visas: [],
    includes: [], excludes: [], terms: [], climate: [], days: [],
    pricing: computeOfferPricing([], { SAR: 1 }, "SAR"),
    ...over,
  };
}
const html = (cover?: "designed", over: Partial<InternalOfferDTO> = {}) =>
  renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: toClientOfferDTO(offer(over)), cover }));

describe("designed cover", () => {
  it("replaces only the first page: same number of sheets, the client and trip on the cover, no internal label", () => {
    const basic = html();
    const designed = html("designed");
    expect((designed.match(/class="od-page/g) ?? []).length).toBe((basic.match(/class="od-page/g) ?? []).length);
    expect(basic).not.toContain("od-cover od-dc");
    expect(designed).toContain("od-cover od-dc");
    expect(designed).toContain("أحمد العتيبي");
    expect(designed).toContain("/screen-landmarks/malaysia.webp");
    expect(designed).not.toMatch(/أساسي|فني/);
  });
  it("one picture per country, the first of several; none → the neutral cover without a broken image", () => {
    expect(coverImagePath("ماليزيا")).toBe("/screen-landmarks/malaysia.webp");
    expect(coverImagePath("سنغافورة + ماليزيا")).toBe("/screen-landmarks/singapore.webp");
    expect(coverImagePath("بلد غير معروف")).toBeNull();
    expect(html("designed", { destination: "بلد غير معروف" })).not.toContain("<img class=\"od-dc-photo\"");
  });
});
