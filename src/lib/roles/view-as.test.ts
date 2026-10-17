import { describe, expect, it } from "vitest";
import { canSwitchRoles, viewAsPermissions, type Permission } from "./roles";

const admin: Permission[] = ["dashboard.admin", "offers.write", "data.write", "settings.manage", "operations.write"];
const developer: Permission[] = [...admin, "developer.access", "operations.own"];
const sales = ["dashboard.employee", "offers.write", "data.write", "operations.own", "not.a.key"];

describe("«التبديل بين الحسابات»", () => {
  it("only the administration and the developer may switch", () => {
    expect(canSwitchRoles(admin)).toBe(true);
    expect(canSwitchRoles(["developer.access"])).toBe(true);
    expect(canSwitchRoles(["dashboard.employee", "offers.write"])).toBe(false);
    expect(viewAsPermissions(["offers.write"], sales)).toBeNull();
  });

  it("only narrows: the role's keys the real account also holds", () => {
    expect(viewAsPermissions(admin, sales)).toEqual(["offers.write", "data.write"]);
    expect(viewAsPermissions(developer, sales)).toEqual(["offers.write", "data.write", "operations.own"]);
  });

  it("the administration cannot look through the developer's role", () => {
    expect(viewAsPermissions(admin, [...admin, "developer.access"])).toBeNull();
    expect(viewAsPermissions(developer, [...admin, "developer.access"])).toEqual([...admin, "developer.access"]);
  });
});
