import { describe, expect, it } from "vitest";
import { runsOn, splitNumbered } from "./numbered-lines";

// the live Spain row's shape (2026-10-24): eight items, no line break, figures inside items
const SPAIN =
  "1- الجواز الاصل صالح لمده 6 شهور على الاقل وبه صفحتين فارغتين2- صورة بطاقة الاحوال3- كشف حساب بنكي لأخر 3 شهور و6 شهور للمقيم بي 3 ايام لا يقل الرصيد عن 10 الاف ريال4- خطاب تعريف من العمل 5- خروج وعوده للمقيميين6-     صورتين شخصيتين مقاس 3.5في 4.5رسوم السفارة 500 ريال";

describe("splitNumbered", () => {
  it("puts each numbered item on its own line and leaves figures inside items alone", () => {
    const lines = splitNumbered(SPAIN).split("\n");
    expect(lines).toHaveLength(6);
    expect(lines.map((l) => l.match(/^\d+/)?.[0])).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(lines[2]).toContain("لأخر 3 شهور و6 شهور للمقيم بي 3 ايام لا يقل الرصيد عن 10 الاف ريال");
    expect(lines[5]).toContain("3.5في 4.5رسوم");
  });

  it("leaves a list that is already one item per line as it is", () => {
    const tidy = "الصين\n\n1-    الجواز الأصلي\n\n2-    صورتين شخصيه\nالسعر يختلف حسب الجنسيه";
    expect(splitNumbered(tidy)).toBe(tidy);
    expect(runsOn(tidy)).toBe(false);
  });

  it("splits «1.» and «2)» too, but not a decimal", () => {
    expect(splitNumbered("1. جواز 2. صورة 3) كشف")).toBe("1. جواز\n2. صورة\n3) كشف");
    expect(splitNumbered("مقاس 3.5 في 4.5")).toBe("مقاس 3.5 في 4.5");
  });

  it("never breaks a date, a range or a line that ends on a number", () => {
    expect(splitNumbered("1- تأشيرة لمدة 3-6 أشهر 2- السفر قبل 2026-1-5 3- صورة")).toBe("1- تأشيرة لمدة 3-6 أشهر\n2- السفر قبل 2026-1-5\n3- صورة");
    const bullets = "- الجواز صالح 1\n- صورة شخصية";
    expect(splitNumbered(bullets)).toBe(bullets);
  });

  it("knows a run-on list", () => {
    expect(runsOn(SPAIN)).toBe(true);
    expect(runsOn("صورة من الجواز\nصورة شخصيه")).toBe(false);
    expect(runsOn(null)).toBe(false);
  });
});
