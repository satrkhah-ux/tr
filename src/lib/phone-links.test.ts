import { describe, expect, it } from "vitest";
import { fromAbroad, phoneParts } from "./phone-links";

describe("phone numbers in free text", () => {
  it("makes every number dialable and leaves the words as they are", () => {
    expect(phoneParts("طوارئ السفارة: +66 88 500 5353 / +66 62 505 4499")).toEqual([
      { text: "طوارئ السفارة: ", tel: null },
      { text: "+66 88 500 5353", tel: "tel:+66885005353" },
      { text: " / ", tel: null },
      { text: "+66 62 505 4499", tel: "tel:+66625054499" },
    ]);
  });

  it("dials a short emergency number but not «24 ساعة»", () => {
    const parts = phoneParts("مستشفى ADK — +960 313 5555 (خط 24 ساعة 1440)");
    expect(parts.filter((p) => p.tel).map((p) => p.tel)).toEqual(["tel:+9603135555", "tel:1440"]);
    expect(phoneParts("شرطة السياحة: 1155")[1]).toEqual({ text: "1155", tel: "tel:1155" });
  });

  it("keeps a line with no number whole", () => {
    expect(phoneParts("لا رقم هنا")).toEqual([{ text: "لا رقم هنا", tel: null }]);
  });
});

describe("our number from abroad", () => {
  it("adds the country code to a Saudi mobile, however it was typed", () => {
    for (const typed of ["0569222111", "569222111", "966569222111", "+966 56 922 2111", "00966569222111"]) {
      expect(fromAbroad(typed)).toEqual({ display: "+966 56 922 2111", tel: "tel:+966569222111" });
    }
  });

  it("leaves another country's number as it is", () => {
    expect(fromAbroad("+60 12 319 9854")).toEqual({ display: "+60 12 319 9854", tel: "tel:+60123199854" });
  });
});
