import { describe, expect, it } from "vitest";
import { screenPage } from "./page";
import type { ScreenState } from "./server";

const state: ScreenState = {
  now: 600000, build: "test", screens: 4, position: 0, slotMs: 12000,
  ads: [], ticker: null, countries: ["تركيا", "جورجيا", "تايلاند"], events: [], demo: null,
};
describe("office country bulletin", () => {
  it("embeds destination data without allowing script or markup injection", () => {
    const html = screenPage(1, { ...state, countries: ["</script><script>bad()</script>"] }, true);
    expect(html).not.toContain("</script><script>bad()");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain('id="countryList"');
    expect(html).toContain("prefers-reduced-motion");
  });
  it("emits syntactically valid scripts for legacy screens", () => {
    const html = screenPage(1, state, true);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      expect(() => new Function(match[1])).not.toThrow();
      expect(match[1]).not.toMatch(/\b(?:const|let)\b|=>/);
    }
  });
});
