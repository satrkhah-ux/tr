import { describe, expect, it } from "vitest";
import { describeTerms, partnerMargin, partnerPrice } from "./pricing";

/**
 * The percentage management sets per company, in both directions.
 *
 * Worth testing to the corner cases because a wrong sign here does not look
 * wrong on screen — it looks like a price — and is discovered on an invoice.
 */

describe("partnerPrice", () => {
  it("adds a markup on top of our sell", () => {
    expect(partnerPrice(1000, { kind: "markup", pct: 35 })).toBe(1350);
  });

  it("takes a commission off our sell", () => {
    expect(partnerPrice(1000, { kind: "commission", pct: 35 })).toBe(650);
  });

  it("leaves the price alone at zero, and with no terms at all", () => {
    expect(partnerPrice(1000, { kind: "markup", pct: 0 })).toBe(1000);
    expect(partnerPrice(1000, null)).toBe(1000);
  });

  it("refuses a nonsense percentage rather than applying it", () => {
    // A bad number in the settings screen should show our plain price — not a
    // free trip, and not a negative one.
    expect(partnerPrice(1000, { kind: "markup", pct: -20 })).toBe(1000);
    expect(partnerPrice(1000, { kind: "commission", pct: 250 })).toBe(1000);
    expect(partnerPrice(1000, { kind: "commission", pct: Number.NaN })).toBe(1000);
  });

  it("never goes below zero", () => {
    expect(partnerPrice(1000, { kind: "commission", pct: 100 })).toBe(0);
  });

  it("rounds to two places, so the figure quoted is the figure charged", () => {
    expect(partnerPrice(333.33, { kind: "markup", pct: 15 })).toBe(383.33);
  });
});

describe("partnerMargin", () => {
  it("is theirs alone — what their client pays minus what we charge them", () => {
    const m = partnerMargin(2000, 1350);
    expect(m.amount).toBe(650);
    expect(m.pct).toBe(32.5);
  });

  it("goes negative when they undersell, and says so", () => {
    expect(partnerMargin(1200, 1350).amount).toBe(-150);
  });

  it("has no percentage to report against a zero sell", () => {
    expect(partnerMargin(0, 0).pct).toBeNull();
  });
});

describe("describeTerms", () => {
  it("says which direction the percentage moves, in words", () => {
    expect(describeTerms({ kind: "markup", pct: 35 })).toContain("إضافة");
    expect(describeTerms({ kind: "commission", pct: 12 })).toContain("خصم");
    expect(describeTerms({ kind: "markup", pct: 0 })).toContain("بلا إضافة");
  });
});
