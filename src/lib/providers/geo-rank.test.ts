import { describe, expect, it } from "vitest";
import { bestGeoHit } from "./geo-rank";

describe("bestGeoHit", () => {
  it("refuses a near-miss name and takes the place actually called that", () => {
    const hits = [
      { name: "Langkawit", latitude: 5.68, longitude: 115.93, feature_code: "PPL", population: 0 },
      { name: "Langkawi Islands", latitude: 6.35, longitude: 99.86, feature_code: "ISLS", population: 0 },
      { name: "Langkawi International Airport", latitude: 6.33, longitude: 99.73, feature_code: "AIRP", population: 0 },
    ];
    expect(bestGeoHit("Langkawi", hits)?.name).toBe("Langkawi Islands");
  });

  it("prefers a populated town over an empty hamlet of the same name", () => {
    const hits = [
      { name: "Hội An", latitude: 14.9, longitude: 108.95, feature_code: "PPL", population: 0 },
      { name: "Hoi An", latitude: 15.88, longitude: 108.33, feature_code: "PPL", population: 32757 },
    ];
    expect(bestGeoHit("Hoi An", hits)?.latitude).toBe(15.88);
  });

  it("returns null when nothing is named what was asked", () => {
    expect(bestGeoHit("Kedah", [{ name: "Kedawung", latitude: 0, longitude: 0 }])).toBeNull();
  });
});
