import { describe, expect, it } from "vitest";
import { referenceRuleError } from "./reference-rules";

describe("catalogue reference writes", () => {
  it("requires a real name and country when adding a city inline or from the catalogue", () => {
    expect(referenceRuleError("cities", { arabic_name: "  ", country_id: "c" }, true)).toBe("data.form.nameRequired");
    expect(referenceRuleError("cities", { arabic_name: "مدينة" }, true)).toBe("pg.err.countryFirst");
    expect(referenceRuleError("cities", { arabic_name: "مدينة", country_id: "c" }, true)).toBeNull();
  });
  it("allows partial edits, zero coordinates and rejects invalid ranges", () => {
    expect(referenceRuleError("cities", { lat: 0, lng: 0 }, false)).toBeNull();
    expect(referenceRuleError("cities", { lat: 91 }, false)).toBe("data.form.invalidCoordinates");
    expect(referenceRuleError("cities", { lng: -181 }, false)).toBe("data.form.invalidCoordinates");
    expect(referenceRuleError("cities", { lat: "nonsense" }, false)).toBe("data.form.invalidCoordinates");
    expect(referenceRuleError("cities", { country_id: null }, false)).toBe("pg.err.countryFirst");
  });
});
