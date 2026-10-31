import { describe, expect, it } from "vitest";
import { buildReport, periodOf, type ReportRequest } from "./daily-report";
import { compareReports, parseStaffReport } from "./staff-report";

// the shape of the report a follow-up employee sent the owner on 2026-10-29 (figures and destinations only)
const HERS = `📊 تقرير الطلبات اليومي
🗓️ الخميس / 29 اكتوبر 2026
═════════════════
🔹ملخص الطلبات
🔹إجمالي الطلبات : 48
🌍 البكجات السياحية : 14
✈️ حجوزات الطيران :  7
🛂 التأشيرات : 20
📞 الاستفسارات : 0
══════════════════
👨🏻‍💼 البكجات المستلمة حسب الموظف
🔹خالد الجبري : العدد 2
_ تايلند
_ صبنجة
🔹 ‏اكرم حسين : العدد 1
_ تركيا
═══════════════════
📈 توزيع البكجات حسب الوجهة
تركيا : 1
 صبنجه : 1
 تايلند : 1
══════════════════
🏨 طلبات الفنادق : 1
باريس : محمد صالح
🚘 مواصلات : 0
══════════════════
🔸 طلبات اخرى : 3
🟣 الطلبات غير المكتملة : 3
_ مهتم لم يحدد شي`;

describe("parseStaffReport", () => {
  it("reads the summary, the sellers and the destinations", () => {
    const p = parseStaffReport(HERS);
    expect(p.total).toBe(48);
    expect(p.counts).toEqual({ package: 14, flight: 7, visa: 20, inquiry: 0, hotel: 1, transport: 0, other: 3, incomplete: 3 });
    expect(p.employees).toEqual([{ name: "خالد الجبري", count: 2 }, { name: "اكرم حسين", count: 1 }]);
    expect(p.destinations.map((d) => d.name)).toEqual(["تركيا", "صبنجه", "تايلند"]);
  });
});

describe("compareReports", () => {
  const r = (over: Partial<ReportRequest>): ReportRequest => ({ id: Math.random().toString(36), day: "2026-10-29", bucket: "package", kind: null, country: null, city: null, place: null, employee: null, assignee: null, note: null, ...over });
  const places = [{ name: "تركيا", country: "تركيا" }, { name: "صبنجه", country: "تركيا" }, { name: "تايلند", country: "تايلند" }];
  const report = buildReport(
    [
      r({ country: "تايلند", assignee: "خالد الجبري" }),
      r({ country: "تركيا", city: "صبنجة", assignee: "خالد الجبري" }),
      r({ country: "تركيا", assignee: "اكرم حسين", returning: true }),
      r({ bucket: "incomplete" }),
    ],
    periodOf("day", "2026-10-29", "2026-10-31"),
  );
  const rows = compareReports(parseStaffReport(HERS), report, places);
  const row = (label: string) => rows.find((x) => x.label === label)!;

  it("says the system's total holds the clients back that day", () => {
    expect(row("إجمالي الطلبات")).toMatchObject({ hers: 48, system: 4 });
    expect(row("إجمالي الطلبات").reasons[0]).toContain("1 عميلاً عاد");
  });

  it("matches sellers across the hidden marks and agrees when the counts agree", () => {
    expect(row("بكجات خالد الجبري")).toMatchObject({ hers: 2, system: 2, reasons: [] });
    expect(row("بكجات اكرم حسين")).toMatchObject({ hers: 1, system: 1, reasons: [] });
  });

  it("reads her city as the system's country", () => {
    expect(row("وجهة تركيا")).toMatchObject({ hers: 2, system: 2 });
    expect(row("وجهة تركيا").reasons[0]).toContain("صبنجه");
  });

  it("points at the unclear requests when she counted more", () => {
    expect(row("البكجات").reasons.join(" ")).toContain("لم يصنّف النظام 1");
  });
});
