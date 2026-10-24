import { describe, expect, it } from "vitest";
import { reviewVisas, visaIssues, type VisaReviewInput } from "./visa-review";

const base: VisaReviewInput = {
  id: "1",
  country: "فرنسا",
  country_id: "fr",
  visa_type: "تأشيرة سياحية",
  sell_price: 400,
  sell_currency: "SAR",
  arabic_requirements: "1- الجواز الأصلي\n2- صورتين شخصيتين",
  status: "Active",
};

describe("visa review", () => {
  it("a priced, active row with a tidy list has nothing to fix", () => {
    expect(visaIssues(base)).toEqual([]);
    expect(reviewVisas([base])).toEqual([]);
  });

  it("names what Murad would get wrong", () => {
    expect(visaIssues({ ...base, sell_price: null })).toEqual(["noPrice"]);
    expect(visaIssues({ ...base, sell_currency: "USD" })).toEqual(["notSar"]);
    expect(visaIssues({ ...base, status: "Inactive", country_id: null })).toEqual(["inactive", "noCountry"]);
    expect(visaIssues({ ...base, arabic_requirements: "  " })).toEqual(["noRequirements"]);
  });

  it("a run-on list with the embassy fee in its one line reaches nobody when prices are hidden", () => {
    const issues = visaIssues({ ...base, arabic_requirements: "1- الجواز الأصلي2- صورتين رسوم السفارة 500 ريال" });
    expect(issues).toEqual(["runOn", "lostWhenHidden"]);
  });

  it("a fee on its own line is only dropped, the rest still goes", () => {
    expect(visaIssues({ ...base, arabic_requirements: "1- الجواز الأصلي\n2- صورتين\nرسوم السفارة 500 ريال" })).toEqual(["pricesInside"]);
  });

  it("puts the most broken first", () => {
    const rows = reviewVisas([
      { ...base, id: "a", country: "مصر", sell_price: null },
      base,
      { ...base, id: "b", country: "الصين", sell_price: null, arabic_requirements: null },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
