import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type Permission } from "./roles";
import { canOpenPath, permissionForPath } from "./section-access";

/** «مبيعات» as it stands in the database: no settings.manage, employees.manage or operations.write. */
const SALES: Permission[] = [
  "dashboard.employee",
  "offers.write",
  "data.write",
  "kanban.view",
  "guide.view",
  "pricing.view",
  "repackage.write",
  "pricing.internal",
];
const sales = (p: Permission) => SALES.includes(p);
const admin = (p: Permission) => (ALL_PERMISSIONS as readonly Permission[]).includes(p);

const CLOSED_TO_SALES = [
  "/hotels",
  "/hotels?id=42",
  "/cities",
  "/cars/transfers",
  "/data-quality",
  "/price-grid",
  "/company-suppliers",
  "/markup-rules",
  "/offers/offer-includes",
  "/offers/terms-and-conditions",
  "/settings/suppliers",
  "/settings/client-comms",
  "/settings/data-transfer",
  "/setting/statuses",
  "/setting/climate",
  "/employees",
  "/employees/accounts",
  "/employees/roles",
  "/operations",
  "/operations/abc/edit",
];

const OPEN_TO_SALES = [
  "/dashboard",
  "/customers",
  "/companies",
  "/companies-visits",
  "/customers_care/services",
  "/basic",
  "/basic/abc",
  "/package-generator",
  "/package-generator/abc/hotels",
  "/offers",
  "/ready-offers",
  "/kanban-board",
  "/repackage",
  "/partner-companies",
  "/web-guide",
];

describe("section access — the menus and the pages read the same list", () => {
  it("keeps sales out of the data section, the settings, the team and operations", () => {
    for (const path of CLOSED_TO_SALES) expect(canOpenPath(path, sales), path).toBe(false);
  });

  it("lets sales into everything else they work in", () => {
    for (const path of OPEN_TO_SALES) expect(canOpenPath(path, sales), path).toBe(true);
  });

  it("lets the all-permissions role into all of it", () => {
    for (const path of [...CLOSED_TO_SALES, ...OPEN_TO_SALES]) expect(canOpenPath(path, admin), path).toBe(true);
  });

  it("names the permission each part needs", () => {
    expect(permissionForPath("/operations/abc")).toBe("operations.write");
    expect(permissionForPath("/employees/roles")).toBe("employees.manage");
    expect(permissionForPath("/setting/profits")).toBe("settings.manage");
    expect(permissionForPath("/markup-rules")).toBe("settings.manage");
    // a prefix is a whole segment: /services-types is its own entry, /operationsx is nothing
    expect(permissionForPath("/operationsx")).toBeNull();
    expect(permissionForPath("/customers")).toBeNull();
  });
});
