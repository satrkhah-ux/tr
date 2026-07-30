import { describe, expect, it } from "vitest";
import { TRAVELIUN_BRAND, brandVars, partnerBrand, shade, tint } from "./brand";
import { OFFER_DOC_CSS } from "./styles";

/**
 * The document's colours reach the stylesheet as a style attribute, so this
 * module is a trust boundary as much as a palette: whatever it returns is
 * injected into CSS.
 */

describe("tint / shade", () => {
  it("returns the colour unchanged at 0 and white/black at 1", () => {
    expect(tint("#135549", 0)).toBe("#135549");
    expect(tint("#135549", 1)).toBe("#ffffff");
    expect(shade("#135549", 0)).toBe("#135549");
    expect(shade("#135549", 1)).toBe("#000000");
  });

  it("mixes toward white, channel by channel", () => {
    // 0x80 = 128 → 128 + (255-128)*0.5 = 191.5 → 192 = 0xc0
    expect(tint("#808080", 0.5)).toBe("#c0c0c0");
  });

  it("passes a malformed value straight through rather than inventing one", () => {
    expect(tint("red", 0.5)).toBe("red");
    expect(tint("#abc", 0.5)).toBe("#abc");
  });
});

describe("brandVars", () => {
  it("derives a full palette from two colours", () => {
    const vars = brandVars("#7c3aed", "#f59e0b");
    expect(vars["--od-green"]).toBe("#7c3aed");
    expect(vars["--od-gold"]).toBe("#f59e0b");
    // the soft fill must be near-white, or text on it stops being readable
    expect(vars["--od-soft"]).toBe(tint("#7c3aed", 0.9));
  });

  /**
   * THE regression guard for "the document kept Traveliun's colour".
   *
   * Every colour the stylesheet declares on .od-root must be overridable, or a
   * partner's document keeps our green for that one rule — half-branded, which
   * reads as a mistake. Adding a var default to styles.ts without adding it here
   * fails this test instead of shipping a green border on a purple document.
   */
  it("overrides every colour variable the stylesheet declares", () => {
    const declared = [...OFFER_DOC_CSS.matchAll(/(--od-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    // --od-map is the page background image, --od-pad a length, and ink/muted are
    // deliberately neutral: body text does not turn purple for a purple brand.
    const NOT_BRANDED = new Set(["--od-map", "--od-pad", "--od-ink", "--od-muted"]);
    const expected = [...new Set(declared)].filter((name) => !NOT_BRANDED.has(name));
    const vars = brandVars("#7c3aed", "#f59e0b");

    expect(expected.length).toBeGreaterThan(7);
    for (const name of expected) expect(Object.keys(vars)).toContain(name);
  });

  it("refuses anything that is not a six-digit hex — this string lands in CSS", () => {
    const vars = brandVars("red; content:'x'", "javascript:alert(1)");
    expect(vars["--od-green"]).toBe("#135549");
    expect(vars["--od-gold"]).toBe("#f0ad22");
  });
});

describe("partnerBrand", () => {
  const row = {
    name: "شركة الأفق للسفر",
    name_latin: "Ufuq Travel",
    brand_color: "#0b4f6c",
    accent_color: "#e07a5f",
    address: "الرياض",
    phone: "0500000000",
    whatsapp: null,
    website: null,
    email: null,
  };

  it("carries the partner's identity and colours", () => {
    const brand = partnerBrand(row, "https://cdn/logo.png");
    expect(brand.nameAr).toBe("شركة الأفق للسفر");
    expect(brand.logoUrl).toBe("https://cdn/logo.png");
    expect(brand.vars?.["--od-green"]).toBe("#0b4f6c");
  });

  // The failure this prevents: a document under their logo that tells the client
  // to phone US.
  it("leaves missing contact fields blank instead of falling back to ours", () => {
    const brand = partnerBrand(row, null);
    expect(brand.whatsapp).toBe("");
    expect(brand.website).toBe("");
    expect(brand.email).toBe("");
    expect(brand.email).not.toBe(TRAVELIUN_BRAND.email);
  });

  it("keeps the house brand on the stylesheet's own palette", () => {
    expect(TRAVELIUN_BRAND.vars).toBeNull();
    expect(TRAVELIUN_BRAND.logoUrl).toBeNull();
  });
});
