import { describe, expect, it } from "vitest";
import { homeKindsFor } from "./homes";
import type { Permission } from "./roles";

const has = (...keys: Permission[]) => (p: Permission) => keys.includes(p);

describe("homeKindsFor", () => {
  it("a visa colleague gets the visas home first", () => {
    expect(homeKindsFor(has("visas.work"))).toEqual(["visas"]);
    expect(homeKindsFor(has("visas.work", "offers.write"))).toEqual(["visas", "sales"]);
  });
  it("each department its own; none gives the general home", () => {
    expect(homeKindsFor(has("operations.write"))).toEqual(["operations"]);
    expect(homeKindsFor(has("data.write"))).toEqual(["data"]);
    expect(homeKindsFor(has("guide.view"))).toEqual([]);
  });
});
