import { describe, expect, it } from "vitest";
import { lastTwoMonths, monthReport, type ReportOffer } from "./report";

const o = (issued_on: string, confirmed: boolean, destination = "ماليزيا", total = 10_000, currency = "SAR"): ReportOffer => ({ issued_on, confirmed, destination, total, currency });

describe("the partner's monthly report", () => {
  it("counts a month's offers, confirmations, conversion, value and top destinations", () => {
    const r = monthReport(
      [o("2026-10-01", true), o("2026-10-05", false, "جورجيا"), o("2026-10-09", true, "ماليزيا", 2_500.5), o("2026-10-20", false, "تركيا"), o("2026-09-30", true)],
      "2026-10",
    );
    expect(r).toMatchObject({ issued: 4, confirmed: 2, conversion: 50, value: [{ currency: "SAR", total: 12_500.5 }] });
    expect(r.top[0]).toEqual({ name: "ماليزيا", count: 2 });
  });

  it("has no conversion for an empty month, and knows the month before January", () => {
    expect(monthReport([], "2026-10").conversion).toBeNull();
    expect(lastTwoMonths("2026-01-15")).toEqual(["2026-01", "2025-12"]);
  });
});
