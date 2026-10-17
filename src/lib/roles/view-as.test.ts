import { describe, expect, it } from "vitest";
import { canSwitchRoles, isDeveloperRole, switchableRoles, viewAsPermissions, type Permission } from "./roles";

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

describe("the switcher's list and the developer's protection", () => {
  const roles = [
    { id: "sales", permission_keys: sales },
    { id: "dev", permission_keys: [...admin, "developer.access"] },
    { id: "empty", permission_keys: null },
  ];

  it("offers the administration every role but the developer's", () => {
    expect(switchableRoles(admin, roles).map((r) => r.id)).toEqual(["sales", "empty"]);
    expect(switchableRoles(developer, roles).map((r) => r.id)).toEqual(["sales", "dev", "empty"]);
    expect(switchableRoles(["offers.write"], roles)).toEqual([]);
  });

  it("a role (and so its people) is the developer's when it carries developer.access", () => {
    expect(isDeveloperRole([...admin, "developer.access"])).toBe(true);
    expect(isDeveloperRole(admin)).toBe(false);
    expect(isDeveloperRole(null)).toBe(false);
    expect(isDeveloperRole(undefined)).toBe(false);
  });
});
