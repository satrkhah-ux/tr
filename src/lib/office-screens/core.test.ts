import { describe, expect, it } from "vitest";
import { core, REF_WIDTH, SCREEN_CORE } from "./core";

const slot = 12_000;
const at = (k: number) => 1_760_000_000_000 - (1_760_000_000_000 % slot) + k * slot;

describe("«الشاشات»: what each screen shows, from the clock alone", () => {
  it("four screens, eleven ads: all different, and each ad moves one screen to the right next slot", () => {
    const now = at(0) + 500;
    const shown = [0, 1, 2, 3].map((p) => core.adIndexAt(now, slot, p, 11));
    expect(new Set(shown).size).toBe(4);
    const next = [0, 1, 2, 3].map((p) => core.adIndexAt(now + slot, slot, p, 11));
    for (let p = 0; p < 3; p++) expect(next[p + 1]).toBe(shown[p]);
    // the same answer anywhere inside the slot, and no ads → nothing
    expect(core.adIndexAt(at(0) + slot - 1, slot, 2, 11)).toBe(shown[2]);
    expect(core.adIndexAt(now, slot, 0, 0)).toBe(-1);
  });

  it("the ticker is one strip: what leaves screen 1's right edge enters screen 2's left edge", () => {
    const speed = 110, text = 2400, screens = 4;
    const t = 1_760_000_123_456;
    const s1 = core.tickerLeft(t, speed, text, screens, 0, REF_WIDTH);
    const s2 = core.tickerLeft(t, speed, text, screens, 1, REF_WIDTH);
    expect(s1 - s2).toBe(REF_WIDTH);
    // left to right, and back to the start after one loop
    expect(core.tickerLeft(t + 1000, speed, text, screens, 0, REF_WIDTH) - s1).toBeCloseTo(speed, 5);
    const loopMs = ((text + screens * REF_WIDTH) / speed) * 1000;
    expect(core.tickerLeft(t + loopMs, speed, text, screens, 0, REF_WIDTH)).toBeCloseTo(s1, 3);
  });

  it("an alert shows 3 s after its moment for 9 s, on every screen alike", () => {
    const events = [{ at: 1000 }, { at: 11_000 }];
    expect(core.alertAt(events, 3999, 3000, 9000)).toBe(-1);
    expect(core.alertAt(events, 4000, 3000, 9000)).toBe(0);
    expect(core.alertAt(events, 12_999, 3000, 9000)).toBe(0);
    expect(core.alertAt(events, 14_000, 3000, 9000)).toBe(1);
    expect(core.alertAt(events, 23_000, 3000, 9000)).toBe(-1);
  });

  it("the page's copy is ES5 — an old TV WebView must parse it", () => {
    expect(SCREEN_CORE).not.toMatch(/=>|\blet\b|\bconst\b|`|\.\.\./);
  });
});
