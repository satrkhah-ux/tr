import { describe, expect, it } from "vitest";
import { matchEmployee, normalizeInquiry, normalizePhone, parseLeadsSheet, riyadhDay, sheetKey, sheetPerson, sheetStatus } from "./sheet";

// the sheet's real header, misspellings and stray spaces included
const CSV = [
  ",رقم الهاتف,استفسار العميل,            الدوله,الموظف المستلم,تاخير المحادثه,هل تم ارسال طلب العميل,اسناد المحادثه الى شخص اخر,ماتم انهاءه مع العميل,حاله المحادثه,الاجراء البعدي,مسؤول التواصل ,النتيجة ",
  ",0501234567,تاشيرات,البحرين,اسوار,ساعة,تم ارسال التفاصيل,ريموندا,,مفتوح,,,",
  ",966501234567,تاشيرات,البحرين,اسوار,,تم ارسال التفاصيل,ريموندا,,مفتوح,,,",
  ",٠٥٠٧٦٥٤٣٢١,باكدج,الشمال التركي,رشا,,,لم يتم الاسناد,,مغلق,يتابع غداً,رشا,حجز",
  ",,طيران,الرياض,رشا,,,,,,,,",
].join("\n");

describe("leads sheet", () => {
  it("normalizes Saudi phones to one spelling", () => {
    expect(normalizePhone("0501234567")).toBe("966501234567");
    expect(normalizePhone("+966 50 123 4567")).toBe("966501234567");
    expect(normalizePhone("00966501234567")).toBe("966501234567");
    expect(normalizePhone("501234567")).toBe("966501234567");
    expect(normalizePhone("٠٥٠٧٦٥٤٣٢١")).toBe("966507654321");
  });

  it("reads every column by its header, whatever the spelling; drops phoneless and duplicate rows", () => {
    const rows = parseLeadsSheet(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ inquiry: "تاشيرات", destination: "البحرين", received_by: "اسوار", delay: "ساعة", assigned_to: "ريموندا", status: "مفتوح" });
    expect(rows[1]).toMatchObject({ next_action: "يتابع غداً", contact_owner: "رشا", result: "حجز", status: "مغلق" });
    expect(rows[0].key).toBe(sheetKey({ phone: "966501234567", inquiry: "تاشيرات", destination: "البحرين", received_by: "اسوار" }));
    expect(sheetPerson(rows[1].assigned_to)).toBe("");
    expect(sheetStatus(rows[1].status)).toBe("closed");
    expect(sheetStatus("")).toBe("open");
  });

  it("classifies the inquiry in one spelling", () => {
    expect(normalizeInquiry("باكدج")).toBe("بكج");
    expect(normalizeInquiry("بكدج")).toBe("بكج");
    expect(normalizeInquiry("تاشيرات")).toBe("تأشيرات");
    expect(normalizeInquiry(" طلب غير واضح ")).toBe("طلب غير واضح");
    expect(normalizeInquiry("شيء آخر")).toBe("طلب غير واضح");
    expect(normalizeInquiry("")).toBe("");
  });

  it("matches a handwritten name to one employee only", () => {
    const team = [
      { id: "a", arabic_name: "محمد الحبيب" },
      { id: "b", arabic_name: "محمد صالح" },
      { id: "c", arabic_name: "رشا أحمد" },
    ];
    expect(matchEmployee("محمد الحبيب", team)).toBe("a");
    expect(matchEmployee("رشا", team)).toBe("c");
    expect(matchEmployee("محمد", team)).toBeNull();
    expect(matchEmployee("ريموندا", team)).toBeNull();
  });

  it("dates in Riyadh", () => {
    expect(riyadhDay("2026-10-17T22:30:00Z")).toBe("2026-10-18");
    expect(riyadhDay("2026-10-17T20:30:00Z")).toBe("2026-10-17");
  });
});

it("maps retired imports into the follow-up category", () => {
  for (const input of ["يستفسر", "استفسار", "غير مصنف", "طلب"]) expect(normalizeInquiry(input)).toBe("طلب غير واضح");
});
