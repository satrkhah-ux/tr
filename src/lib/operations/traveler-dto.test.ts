import { describe, expect, it } from "vitest";
import { passportExpiringWithin, toTravelerListItem, type TravelerRow } from "./traveler-dto";

/**
 * The runtime half of the passport wall. The type proof in traveler-dto.ts fails
 * the BUILD if a sensitive key is ever added to the list shape; this fails the
 * TESTS if a sensitive VALUE ever reaches the serialized output — the same
 * two-layer pattern as the pricing DTO and the client-safety document test.
 */

/** A row with values that would be unmistakable if they leaked. */
function row(over: Partial<TravelerRow> = {}): TravelerRow {
  return {
    id: "t-1",
    operation_id: "op-1",
    traveler_kind: "adult",
    sort: 0,
    display_name: "ابتهال بخاري",
    passport_encrypted: "CIPHERTEXT-DO-NOT-LEAK-a7f3b9",
    passport_expiry: "2027-04-18",
    passport_image_path: "op-1/t-1/9f2c-scan.jpg",
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    ...over,
  };
}

describe("toTravelerListItem", () => {
  it("carries nothing sensitive into the serialized item", () => {
    const json = JSON.stringify(toTravelerListItem(row()));

    expect(json).not.toContain("CIPHERTEXT-DO-NOT-LEAK");
    expect(json).not.toContain("9f2c-scan.jpg");
    expect(json).not.toContain("passport_encrypted");
    expect(json).not.toContain("passport_image_path");
  });

  it("keeps what the ops screen actually needs", () => {
    const item = toTravelerListItem(row());

    expect(item.display_name).toBe("ابتهال بخاري");
    expect(item.passport_expiry).toBe("2027-04-18");
    expect(item.has_passport).toBe(true);
    expect(item.has_scan).toBe(true);
  });

  it("reports absence without revealing anything", () => {
    const item = toTravelerListItem(row({ passport_encrypted: null, passport_image_path: null }));
    expect(item.has_passport).toBe(false);
    expect(item.has_scan).toBe(false);
  });

  it("does not leak a column added to the row later", () => {
    // built field-by-field, so an extra key on the input cannot ride along
    const withExtra = { ...row(), secret_note: "LEAK-ME" } as TravelerRow;
    expect(JSON.stringify(toTravelerListItem(withExtra))).not.toContain("LEAK-ME");
  });
});

describe("passportExpiringWithin", () => {
  const TODAY = "2026-07-29";

  it("flags a passport expiring inside the window", () => {
    expect(passportExpiringWithin("2026-11-01", TODAY)).toBe(true);
  });

  it("leaves a passport valid well past the window alone", () => {
    expect(passportExpiringWithin("2028-01-01", TODAY)).toBe(false);
  });

  it("flags one that has ALREADY expired", () => {
    expect(passportExpiringWithin("2026-01-01", TODAY)).toBe(true);
  });

  it("treats a missing expiry as not-a-signal, not as expiring", () => {
    // an unknown expiry is a data gap; raising it here would drown the real ones
    expect(passportExpiringWithin(null, TODAY)).toBe(false);
  });

  it("survives an unparseable today", () => {
    expect(passportExpiringWithin("2026-11-01", "not-a-date")).toBe(false);
  });

  it("honours a custom window", () => {
    expect(passportExpiringWithin("2026-09-15", TODAY, 1)).toBe(false);
    expect(passportExpiringWithin("2026-08-15", TODAY, 1)).toBe(true);
  });
});
