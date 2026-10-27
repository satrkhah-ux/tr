import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  QUALITY_ISSUES,
  ROWS_FUNCTION,
  diffRecord,
  guardHotels,
  hasArabicLetter,
  issueRowsFunction,
  qualityReportError,
  verifyBlockers,
  weeklyLines,
} from "./quality";

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0071_data_quality.sql", import.meta.url)),
  "utf8",
);

describe("issues ↔ 0071", () => {
  it("every issue is decided and counted by the migration", () => {
    const counts = MIGRATION.slice(MIGRATION.indexOf("function public.data_quality_counts()"));
    for (const issue of QUALITY_ISSUES) {
      expect(MIGRATION).toContain(`when '${issue.key}' then`);
      expect(counts).toContain(`'${issue.key}'`);
      expect(MIGRATION).toContain(`function public.${ROWS_FUNCTION[issue.table]}(p_issue text)`);
    }
  });

  it("lists a table only through its own issues", () => {
    expect(issueRowsFunction("hotels", "hotel_no_arabic")).toBe("data_quality_hotels");
    expect(issueRowsFunction("cities", "hotel_no_arabic")).toBeNull();
    expect(issueRowsFunction("hotels", "drop table")).toBeNull();
  });
});

describe("quality report errors", () => {
  it("reports a missing database function only when the database says it is missing", () => {
    expect(qualityReportError({ code: "PGRST202" })).toBe("data.quality.err.notReady");
    expect(qualityReportError({ code: "42883" })).toBe("data.quality.err.notReady");
    expect(qualityReportError({ code: "57014" })).toBe("data.quality.err.timeout");
    expect(qualityReportError({ code: "PGRST301" })).toBe("err.session");
    expect(qualityReportError({ code: "42501" })).toBe("err.forbidden");
    expect(qualityReportError(new Error("network failure"))).toBe("err.db");
  });
});

describe("hasArabicLetter", () => {
  it("needs a letter, not digits or Latin", () => {
    expect(hasArabicLetter("فندق هيلتون")).toBe(true);
    expect(hasArabicLetter("Hilton 5*")).toBe(false);
    expect(hasArabicLetter("٤")).toBe(false);
    expect(hasArabicLetter(null)).toBe(false);
  });
});

const ok = { id: "h1", arabic_name: "فندق", city_id: "c1", stars: 4, address: "x", contact_number: "1" };

describe("guardHotels", () => {
  it("warns — never blocks — on a Latin printed name, a missing city and contact (the owner, 2026-10-18)", () => {
    const issues = guardHotels(
      [{ hotel_id: "h1", hotel_name: "Hilton" }],
      [{ ...ok, city_id: null, address: "", contact_number: null }],
    );
    expect(issues.map((i) => [i.problem, i.blocking])).toEqual([
      ["latin_name", false],
      ["no_city", false],
      ["no_address", false],
      ["no_phone", false],
    ]);
  });

  it("reads the line's name first, falls back to the record, skips lines without a catalogue hotel", () => {
    expect(guardHotels([{ hotel_id: "h1", hotel_name: "فندق" }], [{ ...ok, arabic_name: "Hilton" }])).toEqual([]);
    expect(guardHotels([{ hotel_id: "h1", hotel_name: "" }], [{ ...ok, arabic_name: "Hilton" }])[0].problem).toBe("latin_name");
    expect(guardHotels([{ hotel_id: null, hotel_name: "Hilton" }], [ok])).toEqual([]);
  });

  it("reports a hotel used twice once", () => {
    const twice = [{ hotel_id: "h1", hotel_name: "" }, { hotel_id: "h1", hotel_name: "" }];
    expect(guardHotels(twice, [{ ...ok, address: null }])).toHaveLength(1);
  });
});

describe("verifyBlockers", () => {
  it("lists every field a verified hotel needs", () => {
    expect(verifyBlockers(ok)).toEqual([]);
    expect(verifyBlockers({ id: "h", arabic_name: "X", city_id: null, stars: 0, address: " ", contact_number: null })).toEqual([
      "latin_name", "no_city", "no_stars", "no_address", "no_phone",
    ]);
  });
});

describe("diffRecord", () => {
  it("keeps only real changes, masks what must not be read back, clips long text", () => {
    const long = "a".repeat(200);
    const diff = diffRecord(
      { stars: 4, arabic_name: "قديم", buy_price: 10, address: null },
      { stars: "4", arabic_name: "جديد", buy_price: 12, address: long },
      (c) => c === "buy_price",
    );
    expect(Object.keys(diff)).toEqual(["arabic_name", "buy_price", "address"]);
    expect(diff.arabic_name).toEqual(["قديم", "جديد"]);
    expect(diff.buy_price).toEqual(["•", "•"]);
    expect(String(diff.address[1]).length).toBe(121);
  });
});

describe("weeklyLines", () => {
  const label = (k: string) => k.replace("data.quality.issue.", "");
  it("shows the change against last week", () => {
    expect(weeklyLines({ hotel_no_arabic: 270, hotel_no_stars: 268, room_not_room: 5 }, { hotel_no_arabic: 279, hotel_no_stars: 268, room_not_room: 2 }, label)).toEqual([
      "• hotel_no_arabic: 270 (−9)",
      "• hotel_no_stars: 268 (=)",
      "• room_not_room: 5 (+3)",
    ]);
  });
  it("a first week has no comparison", () => {
    expect(weeklyLines({ hotel_no_arabic: 1 }, null, label)).toEqual(["• hotel_no_arabic: 1"]);
  });
});
