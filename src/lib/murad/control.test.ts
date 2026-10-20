import { describe, expect, it } from "vitest";
import { defaultControl, inMuradScope, parseControl, validControl } from "./control";
import { canOpenPath } from "@/lib/roles/section-access";
import { visaAnswerText } from "./visa";

describe("Murad controls", () => {
  it("preserves existing behavior until a control is saved and fails closed on corruption", () => {
    expect(parseControl(null)).toEqual(defaultControl());
    expect(Object.values(parseControl("{bad").tasks)).not.toContain(true);
    expect(validControl({ ...defaultControl(), inboxIds: [-1] })).toBe(false);
    expect(validControl({ ...defaultControl(), handoffs: { wrong: { teamId: 1, agentId: null } } })).toBe(false);
  });
  it("requires BOTH the selected inbox and department, and rejects unknown scope", () => {
    const c = { ...defaultControl(), inboxIds: [1], teamIds: [2] };
    expect(inMuradScope(c, 1, 2)).toBe(true);
    expect(inMuradScope(c, 1, 3)).toBe(false);
    expect(inMuradScope(c, null, 2)).toBe(false);
    expect(inMuradScope(defaultControl(), null, null)).toBe(true);
  });
  it("hides settings and decisions from sales while admitting management and developer", () => {
    for (const path of ["/murad-settings", "/management-decisions"]) {
      expect(canOpenPath(path, (p) => p === "offers.write")).toBe(false);
      expect(canOpenPath(path, (p) => p === "developer.access")).toBe(true);
    }
    expect(canOpenPath("/murad-settings", (p) => p === "settings.manage")).toBe(true);
  });
  it("keeps visa requirements but omits the quote when prices are disabled", () => {
    const text = visaAnswerText({
      includePrice: false, country: "بريطانيا", row: { country: "بريطانيا", visa_type: "سياحية", sell_price: 1357, sell_currency: "SAR", status: "Active", arabic_requirements: "جواز سفر" },
      applicants: 2, sarPer: 1, check: false,
    });
    expect(text).toContain("بريطانيا");
    expect(text).not.toContain("1,357");
    expect(text).not.toContain("2,714");
  });
});
