import { describe, expect, it } from "vitest";
import { FEATURE_DEFAULTS, featureForPath, parseFeatures } from "./features";

describe("system service switches", () => {
  it("everything is on unless the row says otherwise; a broken row switches nothing off", () => {
    expect(parseFeatures(null)).toEqual(FEATURE_DEFAULTS);
    expect(parseFeatures("{not json")).toEqual(FEATURE_DEFAULTS);
    expect(parseFeatures('{"repackage":false,"unknown":false,"kanban":"no"}')).toEqual({ ...FEATURE_DEFAULTS, repackage: false });
  });

  it("maps a route to its service, the flight card before the repackage flow", () => {
    expect(featureForPath("/repackage/flight-card?x=1")).toBe("flight_card");
    expect(featureForPath("/repackage/abc")).toBe("repackage");
    expect(featureForPath("/package-generator/abc/hotels")).toBe("legacy_generator");
    expect(featureForPath("/package-generatorx")).toBeNull();
    expect(featureForPath("/basic/abc")).toBeNull();
  });
});
