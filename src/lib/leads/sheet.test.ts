import { describe, expect, it } from "vitest";
import { matchEmployee, normalizePhone, parseLeadsSheet, sheetStatus } from "./sheet";

const CSV = [
  ",رقم الهاتف,استفسار العميل,            الدوله,الموظف المستلم,تاخير المحادثه,هل تم ارسال طلب العميل,اسناد المحادثه الى شخص اخر,ماتم انهاءه مع العميل,حاله المحادثه",
  ",0501234567,تاشيرات,البحرين,اسوار,,تم ارسال التفاصيل,ريموندا,,مفتوح",
  ",966501234567,تاشيرات,البحرين,اسوار,,تم ارسال التفاصيل,ريموندا,,مفتوح",
  ",٠٥٠٧٦٥٤٣٢١,باكدج,الشمال التركي,رشا,,,لم يتم الاسناد,,مغلق",
  ",,طيران,الرياض,رشا,,,,,",
].join("\n");

describe("leads sheet", () => {
  it("normalizes Saudi phones to one spelling", () => {
    expect(normalizePhone("0501234567")).toBe("966501234567");
    expect(normalizePhone("+966 50 123 4567")).toBe("966501234567");
    expect(normalizePhone("00966501234567")).toBe("966501234567");
    expect(normalizePhone("501234567")).toBe("966501234567");
    expect(normalizePhone("٠٥٠٧٦٥٤٣٢١")).toBe("966507654321");
  });

  it("reads rows by header, drops phoneless and duplicate rows, blanks «لم يتم الاسناد»", () => {
    const rows = parseLeadsSheet(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ phone: "966501234567", inquiry: "تاشيرات", destination: "البحرين", received_by: "اسوار", assigned_to: "ريموندا", status: "مفتوح" });
    expect(rows[1]).toMatchObject({ phone: "966507654321", assigned_to: "", status: "مغلق" });
    expect(sheetStatus(rows[1].status)).toBe("closed");
    expect(sheetStatus("")).toBe("open");
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
});
