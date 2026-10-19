import { describe, expect, it } from "vitest";
import { displayName, normalizeConfig, positionOf, riyadhDay, serviceLine, tickerText } from "./config";

describe("«الشاشات» settings and words", () => {
  it("every screen exactly once in the hanging order, whatever was saved", () => {
    expect(normalizeConfig({ screens: 4, order: [3, 3, 9, 1] }).order).toEqual([3, 1, 2, 4]);
    expect(normalizeConfig(null)).toMatchObject({ screens: 4, order: [1, 2, 3, 4], slotSec: 12, kinds: ["بكج"] });
    expect(normalizeConfig({ kinds: ["طيران", "شيء"], slotSec: 1 })).toMatchObject({ kinds: ["طيران"], slotSec: 4 });
    const cfg = normalizeConfig({ screens: 4, order: [2, 1, 3, 4] });
    expect([positionOf(cfg, 1), positionOf(cfg, 2), positionOf(cfg, 5)]).toEqual([1, 0, -1]);
  });

  it("the client's name as recorded, three words at most — never a phone, a number, emoji or a placeholder", () => {
    expect(displayName("أحمد محمد العتيبي الزهراني")).toBe("أحمد محمد العتيبي");
    expect(displayName("Saad")).toBe("Saad");
    expect(displayName("سعد 🌴")).toBe("سعد");
    expect(displayName("+966 55 123 4567")).toBeNull();
    expect(displayName("😀😀")).toBeNull();
    expect(displayName("#48213")).toBeNull();
    expect(displayName("عميل")).toBeNull();
    expect(displayName("Unknown")).toBeNull();
    expect(displayName(null)).toBeNull();
  });

  it("the alert's line: the service and the destination, as encouragement", () => {
    expect(serviceLine("بكج", "تركيا")).toBe("بكج إلى تركيا");
    expect(serviceLine("طيران", "تركيا")).toBe("طيران إلى تركيا");
    expect(serviceLine("تأشيرات", "بريطانيا")).toBe("تأشيرة إلى بريطانيا");
    expect(serviceLine("فنادق", "تركيا")).toBe("فندق في تركيا");
  });

  it("the ticker: today's top countries by conversations, no counts; under three → yesterday's with its date", () => {
    const now = Date.parse("2026-10-19T12:00:00Z"); // Monday in Riyadh
    const today = riyadhDay(now);
    const y = today - 86_400_000;
    const lead = (country: string, ...days: number[]) => ({ country, days });
    const busy = [lead("تركيا", today), lead("تركيا", today), lead("مصر", today), lead("اندونيسيا", today), lead("جورجيا", today)];
    const isolates = new RegExp(`[${String.fromCharCode(0x2066)}${String.fromCharCode(0x2069)}]`, "g");
    const plain = (s: string | null) => (s ?? "").replace(isolates, "");
    expect(tickerText(busy, now)).toContain(String.fromCharCode(0x2066) + "19-10-2026" + String.fromCharCode(0x2069));
    expect(plain(tickerText(busy, now))).toBe("الدول الأكثر طلباً اليوم — الاثنين 19-10-2026: تركيا · اندونيسيا · جورجيا · مصر");
    expect(plain(tickerText([lead("تركيا", today, y), lead("مصر", y)], now))).toBe("الدول الأكثر طلباً أمس — الأحد 18-10-2026: تركيا · مصر");
    expect(tickerText([], now)).toBeNull();
  });
});
