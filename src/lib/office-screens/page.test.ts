import { describe, expect, it } from "vitest";
import { screenPage } from "./page";
import { serviceLine } from "./config";
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
    expect(html).toContain('id="ranks"');
    expect(html).toContain('id="hero"');
    expect(html).toContain("prefers-reduced-motion");
  });
  it("emits syntactically valid scripts for legacy screens", () => {
    const html = screenPage(1, state, true);
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      expect(() => new Function(match[1])).not.toThrow();
      expect(match[1]).not.toMatch(/\b(?:const|let)\b|=>/);
    }
  });
  it("the alert encourages — never «طلب» (the owner, 2026-10-22: «مسافر جديد مع ترافليون — بكج إلى ماليزيا أفضل من طلب جديد»)", () => {
    const html = screenPage(1, state, true);
    const alert = html.slice(html.indexOf('<div id="alert">'), html.indexOf('<section id="countries">'));
    expect(alert).toContain("مسافر جديد مع ترافليون");
    expect(alert).not.toContain("طلب");
    for (const kind of ["بكج", "طيران", "تأشيرات", "فنادق"]) expect(serviceLine(kind, "ماليزيا")).not.toContain("طلب");
  });
});
