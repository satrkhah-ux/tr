import { describe, expect, it } from "vitest";
import { nationalityCode, nationalityName } from "./nationality";

describe("nationality — the country's name instead of «SAU» (the owner, 2026-10-22)", () => {
  it("names the passport's code in Arabic, or English for an English voucher", () => {
    expect(nationalityName("SAU")).toBe("السعودية");
    expect(nationalityName("SYR")).toBe("سوريا");
    expect(nationalityName("IRQ")).toBe("العراق");
    expect(nationalityName("D")).toBe("ألمانيا");
    expect(nationalityName("SAU", "en")).toBe("Saudi Arabia");
  });

  it("reads what staff type as the same code, and shows anything else as written", () => {
    expect(nationalityCode("سعودي")).toBe("SAU");
    expect(nationalityCode(" Saudi ")).toBe("SAU");
    expect(nationalityCode("ae")).toBe("ARE");
    expect(nationalityName("سعودية")).toBe("السعودية");
    expect(nationalityName("عراقي")).toBe("عراقي");
    expect(nationalityName(null)).toBe("");
  });
});
