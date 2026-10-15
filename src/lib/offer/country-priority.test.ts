import { describe, expect, it } from "vitest";
import { byUsage } from "./country-priority";

describe("byUsage", () => {
  it("puts the most-sold countries first and leaves the rest in their alphabetical order", () => {
    const alphabetical = ["أذربيجان", "اندونيسيا", "إيطاليا", "تايلاند", "تركيا", "جورجيا", "مصر", "ماليزيا"].map((name) => ({ name }));
    expect(byUsage(alphabetical).map((c) => c.name)).toEqual([
      "تايلاند",
      "اندونيسيا",
      "تركيا",
      "ماليزيا",
      "جورجيا",
      "أذربيجان",
      "إيطاليا",
      "مصر",
    ]);
  });
});
