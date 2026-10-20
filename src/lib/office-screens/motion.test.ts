import { expect, it } from "vitest";
import { countryRanking } from "./config";
import { landmarkFor } from "./landmarks";

it("counts conversations once per country and day, without inventing live counters", () => {
  expect(countryRanking([
    { country: "مصر", days: [1, 1] }, { country: "جورجيا", days: [1] },
    { country: "مصر", days: [1] }, { country: "تركيا", days: [0] },
  ], 1)).toEqual([{ country: "مصر", count: 2 }, { country: "جورجيا", count: 1 }]);
});
it("resolves spelling variants to local scenery, with a non-black generic fallback", () => {
  expect(landmarkFor("جورجيا")).toBe("/screen-landmarks/georgia.webp");
  expect(landmarkFor("مصر")).toBe("/screen-landmarks/egypt.webp");
  expect(landmarkFor("إندونيسيا")).toBe(landmarkFor("اندونيسيا"));
  expect(landmarkFor("عُمان")).toBe("/screen-landmarks/oman.webp");
  expect(landmarkFor("غير معروفة")).toBe("/screen-landmarks/journey.svg");
});
