import { describe, expect, it } from "vitest";
import { pickIssuingDraft } from "./issued-draft";

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
