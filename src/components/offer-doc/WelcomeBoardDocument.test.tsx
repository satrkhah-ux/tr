import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WelcomeBoardDocument, type WelcomeBoard } from "./WelcomeBoardDocument";

/**
 * The board is a physical object before it is a document: it gets held up in an
 * arrivals hall. These check the three things that make it work there — the
 * name is big, the sheet is landscape, and the company on it is the issuing
 * company rather than ours.
 */

const base: WelcomeBoard = {
  name: "أحمد الرفاعي",
  subtitle: null,
  companyNameAr: "مسارات الشرق للسفر",
  companyNameLatin: "Masarat Al-Sharq",
  logoUrl: null,
  brandColor: "#7a2048",
  accentColor: "#c9a227",
};

const render = (board: Partial<WelcomeBoard> = {}) =>
  renderToStaticMarkup(<WelcomeBoardDocument board={{ ...base, ...board }} />);

describe("WelcomeBoardDocument", () => {
  it("prints the requested name", () => {
    expect(render({ name: "Mr. John Smith" })).toContain("Mr. John Smith");
  });

  it("turns the sheet landscape", () => {
    // preferCSSPageSize is on in the PDF layer, so this rule IS the page size.
    expect(render()).toContain("size:A4 landscape");
  });

  it("wears the issuing company's colours and name, not ours", () => {
    const html = render();
    expect(html).toContain("#7a2048");
    expect(html).toContain("مسارات الشرق للسفر");
    expect(html).not.toContain("#185045");
    expect(html).not.toContain("ترافليون");
  });

  it("falls back to the company initial when no logo is uploaded", () => {
    // A partner is approved before a logo exists; that first day must not
    // render a broken image on a sign held up in public.
    expect(render({ logoUrl: null })).toContain("م</span>");
  });

  it("shrinks the type as the name grows, so it always fits one sheet", () => {
    const short = render({ name: "علي" });
    const long = render({ name: "عبد الرحمن بن عبد العزيز آل سعود الشمري" });
    // line-height:1.15 is the name block specifically — the logo fallback also
    // carries font-weight:800 and matched a looser pattern.
    const sizeOf = (html: string) =>
      Number(/font-size:(\d+)pt;font-weight:800;color:[^;]+;line-height:1\.15/.exec(html)?.[1] ?? 0);
    expect(sizeOf(short)).toBeGreaterThan(sizeOf(long));
  });

  it("runs a Latin name left-to-right on an Arabic sheet", () => {
    expect(render({ name: "John Smith" })).toContain("direction:ltr");
    expect(render({ name: "أحمد" })).toContain("direction:rtl");
  });
});
