import { describe, expect, it } from "vitest";
import { newestFrozen, pickIssuingDraft } from "./issued-draft";

describe("pickIssuingDraft", () => {
  const ours = { id: "d1", partner_company_id: null };
  const theirs = { id: "d2", partner_company_id: "p1" };

  it("takes the one draft that names the serial — ours, or the offer's own partner's", () => {
    expect(pickIssuingDraft([ours], null)).toBe(ours);
    expect(pickIssuingDraft([ours], "p1")).toBe(ours); // our draft issued under a reseller's brand
    expect(pickIssuingDraft([theirs], "p1")).toBe(theirs);
  });

  it("trusts no other company's draft, and none when two name the serial", () => {
    expect(pickIssuingDraft([theirs], "p2")).toBeNull();
    expect(pickIssuingDraft([theirs], null)).toBeNull();
    expect(pickIssuingDraft([ours, theirs], "p1")).toBeNull();
    expect(pickIssuingDraft([], null)).toBeNull();
  });
});

describe("newestFrozen — operations seeds from the version last sent", () => {
  const v1 = { id: "d1", data: { hotels: [] } };
  const v3 = { id: "d1", data: { hotels: [{ hotel_name: "فندق بالي" }] } };

  it("takes the newest version that froze a draft, not the first", () => {
    expect(newestFrozen([{ version: 1, source: v1 }, { version: 3, source: v3 }, { version: 2, source: null }])).toBe(v3);
  });

  it("skips a plain republish (no frozen copy) after the last re-issue", () => {
    expect(newestFrozen([{ version: 2, source: v3 }, { version: 4, source: null }, { version: 1, source: v1 }])).toBe(v3);
  });

  it("is undefined for an offer issued before the freeze existed", () => {
    expect(newestFrozen([{ version: 1, source: null }])).toBeUndefined();
    expect(newestFrozen([])).toBeUndefined();
  });

  it("keeps a frozen «no trustworthy draft» answer (then the offer's rows seed)", () => {
    const none = { id: null, data: null };
    expect(newestFrozen([{ version: 1, source: v1 }, { version: 2, source: none }])).toBe(none);
  });
});
