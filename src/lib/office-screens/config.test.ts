import { describe, expect, it } from "vitest";
import { alertText, normalizeConfig, positionOf, riyadhDay, tickerText } from "./config";

describe("«الشاشات» settings and words", () => {
  it("every screen exactly once in the hanging order, whatever was saved", () => {
    expect(normalizeConfig({ screens: 4, order: [3, 3, 9, 1] }).order).toEqual([3, 1, 2, 4]);
    expect(normalizeConfig(null)).toMatchObject({ screens: 4, order: [1, 2, 3, 4], slotSec: 12, kinds: ["بكج"] });
    expect(normalizeConfig({ kinds: ["طيران", "شيء"], slotSec: 1 })).toMatchObject({ kinds: ["طيران"], slotSec: 4 });
    const cfg = normalizeConfig({ screens: 4, order: [2, 1, 3, 4] });
    expect([positionOf(cfg, 1), positionOf(cfg, 2), positionOf(cfg, 5)]).toEqual([1, 0, -1]);
  });

  it("the alert names the destination and the kind, never a person", () => {
    expect(alertText("بكج", "تركيا", false)).toBe("✈️ عميل جديد طلب تركيا الآن");
    expect(alertText("تأشيرات", "إيطاليا", true)).toBe("تجربة — 🛂 عميل جديد طلب تأشيرة إيطاليا الآن");
  });

  it("the ticker: today's top countries by conversations, no counts; under three → yesterday's with its date", () => {
    const now = Date.parse("2026-10-19T12:00:00Z"); // Monday in Riyadh
    const today = riyadhDay(now);
    const y = today - 86_400_000;
    const lead = (country: string, ...days: number[]) => ({ country, days });
    const busy = [lead("تركيا", today), lead("تركيا", today), lead("مصر", today), lead("اندونيسيا", today), lead("جورجيا", today)];
    expect(tickerText(busy, now)).toBe("الدول الأكثر طلباً اليوم — الاثنين 19-10-2026: تركيا · اندونيسيا · جورجيا · مصر");
    expect(tickerText([lead("تركيا", today, y), lead("مصر", y)], now)).toBe("الدول الأكثر طلباً أمس — الأحد 18-10-2026: تركيا · مصر");
    expect(tickerText([], now)).toBeNull();
  });
});
