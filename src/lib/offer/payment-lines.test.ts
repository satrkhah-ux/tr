import { describe, expect, it } from "vitest";
import { paymentLines, roomLabel, roomTypesText } from "./draft-types";

describe("paymentLines", () => {
  const items = [
    { text: "يُدفع 50% مقدماً", checked: true, country_id: null },
    { text: "تابي متاح لماليزيا", checked: true, country_id: "my" },
    { text: "بنك الراجحي — شركة ترافليون", checked: true, country_id: null },
    { text: "حساب تركيا", checked: true, country_id: "tr" },
    { text: "يُدفع 50% مقدماً", checked: true, country_id: "my" },
  ];
  it("prints every country's lines and the trip country's own, once each, in order", () => {
    expect(paymentLines(items, "my")).toEqual(["يُدفع 50% مقدماً", "تابي متاح لماليزيا", "بنك الراجحي — شركة ترافليون"]);
  });
  it("a trip with no known country gets the all-countries lines only", () => {
    expect(paymentLines(items, null)).toEqual(["يُدفع 50% مقدماً", "بنك الراجحي — شركة ترافليون"]);
  });
  it("no lines written: empty (the document keeps its standing note)", () => {
    expect(paymentLines(undefined, "my")).toEqual([]);
  });
});

describe("room view", () => {
  it("prints with the room's name and keeps two views apart", () => {
    const base = { room_type_name: "غرفة مزدوجة | الفئة: ستاندرد", board_type: null };
    expect(roomLabel({ ...base, room_view: " إطلالة على البحر " })).toBe("غرفة مزدوجة | الفئة: ستاندرد — إطلالة على البحر");
    expect(roomTypesText([{ ...base, room_view: "إطلالة على البحر" }, { ...base, room_view: "إطلالة على البحر" }, { ...base }])).toBe(
      "غرفة مزدوجة | الفئة: ستاندرد — إطلالة على البحر × 2 + غرفة مزدوجة | الفئة: ستاندرد",
    );
  });
});
