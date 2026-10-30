import { describe, expect, it } from "vitest";
import { cleanName, couponCode, couponState, discountLabel, maskPhone, readScan } from "./rules";

describe("discount rules", () => {
  it("labels", () => {
    expect(discountLabel("amount", 300)).toBe("300 ريال");
    expect(discountLabel("percent", 10)).toBe("10%");
  });

  it("a coupon is used once and ends on its date", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(couponState({ redeemed_at: null, expires_at: "2026-11-30T00:00:00Z" }, now)).toBe("valid");
    expect(couponState({ redeemed_at: "2026-11-05T00:00:00Z", expires_at: "2026-11-30T00:00:00Z" }, now)).toBe("used");
    expect(couponState({ redeemed_at: null, expires_at: "2026-11-09T00:00:00Z" }, now)).toBe("expired");
  });

  it("codes avoid look-alike letters", () => {
    const code = couponCode(new Uint8Array([0, 1, 2, 30, 31, 255]));
    expect(code).toMatch(/^TRV-[2-9A-HJKMNP-Z]{6}$/);
  });

  it("reads a scanned link or a typed code", () => {
    expect(readScan("https://pkg.traveliun.com/coupon/abcdefghijklmnopqrstuvwx")).toEqual({ token: "abcdefghijklmnopqrstuvwx" });
    expect(readScan(" trv-7k3m9q ")).toEqual({ code: "TRV-7K3M9Q" });
    expect(readScan("TRV7K3M9Q")).toEqual({ code: "TRV-7K3M9Q" });
    expect(readScan("hello")).toBeNull();
  });

  it("masks the number", () => {
    expect(maskPhone("+966 55 123 4567")).toBe("05•••••567");
  });
});

describe("cleanName", () => {
  it("keeps a person's name, drops phrases, shops and marks", () => {
    expect(cleanName("Hazim.")).toBe("Hazim");
    expect(cleanName("Reham💕")).toBe("Reham");
    expect(cleanName("عمر الجهني")).toBe("عمر الجهني");
    expect(cleanName("استغفر الله")).toBeNull();
    expect(cleanName("حساب تجاري")).toBeNull();
    expect(cleanName("MARWA FAM SALES 🌷")).toBeNull();
    expect(cleanName(".")).toBeNull();
    expect(cleanName("خ")).toBeNull();
    expect(cleanName("تجربة النظام بيسك")).toBeNull();
    expect(cleanName("شخصين")).toBeNull();
    expect(cleanName(null)).toBeNull();
  });
});
