import { describe, expect, it } from "vitest";
import { FEATURE_DEFAULTS, type Feature } from "@/lib/features";
import { ALL_PERMISSIONS, type Permission } from "./roles";
import { canOpenLink, canOpenPath, partnerFeatures, permissionsForPath } from "./section-access";

/** «مبيعات» after the 2026-10-17 reorganisation: no settings.manage, employees.manage or operations.write — operations.own instead. */
const SALES: Permission[] = [
  "dashboard.employee",
  "offers.write",
  "data.write",
  "kanban.view",
  "guide.view",
  "pricing.view",
  "repackage.write",
  "pricing.internal",
  "operations.own",
];
const sales = (p: Permission) => SALES.includes(p);
/** «كل الصلاحيات» as it stands: everything except the developer's key and operations.own. */
const owner = (p: Permission) => p !== "developer.access" && p !== "operations.own";
const all = (p: Permission) => (ALL_PERMISSIONS as readonly Permission[]).includes(p);

const CLOSED_TO_SALES = [
  // the administration's settings and the margin policy, the credential vault
  "/markup-rules",
  "/settings/suppliers",
  "/settings/client-comms",
  "/settings/data-transfer",
  "/setting/statuses",
  "/setting/climate",
  // «قسم الإدارة»
  "/customers",
  "/companies",
  "/companies-visits",
  "/companies-visits-statuses",
  "/customers_care",
  "/customers_care/services",
  "/customers-care",
  "/web-guide",
  "/guide/categories",
  "/partner-companies",
  "/partner-companies/abc",
  "/employees",
  "/employees/accounts",
  "/employees/roles",
  // company-wide revenue
  "/travel-intelligence",
  "/developer",
];

const OPEN_TO_SALES = [
  "/dashboard",
  // «النظام بيسك» and what it now holds
  "/basic",
  "/basic/abc",
  "/package-generator",
  "/package-generator/abc/hotels",
  "/offers",
  "/ready-offers",
  "/kanban-board",
  "/repackage",
  "/repackage/flight-card",
  // «العمليات» — their own files (operations.own)
  "/operations",
  "/operations/abc",
  // «البيانات» — view, add, edit
  "/hotels",
  "/hotels?id=42",
  "/cities",
  "/cars/transfers",
  "/data-quality",
  "/price-grid",
  "/company-suppliers",
  "/offers/offer-includes",
  "/offers/terms-and-conditions",
];

describe("section access — the menus and the pages read the same list", () => {
  it("shows sales only the home, «بيسك», operations and the data", () => {
    for (const path of CLOSED_TO_SALES) expect(canOpenPath(path, sales), path).toBe(false);
    for (const path of OPEN_TO_SALES) expect(canOpenPath(path, sales), path).toBe(true);
  });

  it("lets the all-permissions role into all of it but the developer page", () => {
    for (const path of [...CLOSED_TO_SALES, ...OPEN_TO_SALES]) {
      expect(canOpenPath(path, owner), path).toBe(path !== "/developer");
    }
    for (const path of [...CLOSED_TO_SALES, ...OPEN_TO_SALES]) expect(canOpenPath(path, all), path).toBe(true);
  });

  it("opens operations to either operations permission", () => {
    expect(canOpenPath("/operations", (p) => p === "operations.write")).toBe(true);
    expect(canOpenPath("/operations/abc", (p) => p === "operations.own")).toBe(true);
    expect(canOpenPath("/operations", (p) => p === "operations.passport")).toBe(false);
    expect(permissionsForPath("/operations/abc")).toEqual(["operations.write", "operations.own"]);
  });

  it("names the permission each part needs", () => {
    expect(permissionsForPath("/employees/roles")).toEqual(["employees.manage"]);
    expect(permissionsForPath("/setting/profits")).toEqual(["settings.manage"]);
    expect(permissionsForPath("/markup-rules")).toEqual(["settings.manage"]);
    expect(permissionsForPath("/settings/suppliers")).toEqual(["settings.manage"]);
    expect(permissionsForPath("/hotels")).toEqual(["data.write"]);
    expect(permissionsForPath("/customers")).toEqual(["settings.manage"]);
    expect(permissionsForPath("/travel-intelligence")).toEqual(["dashboard.admin"]);
    expect(permissionsForPath("/developer")).toEqual(["developer.access"]);
    // a prefix is a whole segment: /services-types is its own entry, /operationsx is nothing
    expect(permissionsForPath("/operationsx")).toBeNull();
    expect(permissionsForPath("/customers_carex")).toBeNull();
    expect(permissionsForPath("/basic")).toBeNull();
  });
});

describe("service switches — a switched-off service closes its links", () => {
  const off = (feature: Feature) => (f: Feature) => f !== feature && FEATURE_DEFAULTS[f];

  it("hides a switched-off service, and only it", () => {
    expect(canOpenLink({ href: "/package-generator", perm: "offers.write" }, sales, off("legacy_generator"))).toBe(false);
    expect(canOpenLink({ href: "/basic", perm: "offers.write" }, sales, off("legacy_generator"))).toBe(true);
    expect(canOpenPath("/repackage/flight-card", sales, off("flight_card"))).toBe(false);
    expect(canOpenPath("/repackage", sales, off("flight_card"))).toBe(true);
    expect(canOpenPath("/kanban-board?x=1", sales, off("kanban"))).toBe(false);
    // without switches the permission rule alone answers (paths no service owns)
    expect(canOpenPath("/package-generator", sales)).toBe(true);
  });

  it("never closes a partner's «ملفاتي» — but does close their other services", () => {
    const partner = () => false;
    expect(canOpenPath("/package-generator", partner, partnerFeatures(off("legacy_generator")))).toBe(true);
    expect(canOpenPath("/ready-offers", partner, partnerFeatures(off("ready_offers")))).toBe(false);
  });

  it("still needs the link's own permission", () => {
    expect(canOpenLink({ href: "/repackage", perm: "repackage.write" }, (p) => p === "data.write", () => true)).toBe(false);
  });
});
