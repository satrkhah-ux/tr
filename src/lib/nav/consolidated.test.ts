import { describe, expect, it } from "vitest";
import { movedTo, tabsFor } from "./consolidated";

describe("the menu consolidation (the owner, 2026-10-19)", () => {
  it("sends every page that went where it went — nothing lands on a dead page", () => {
    expect(movedTo("/cars")).toBe("/cars-types");
    expect(movedTo("/customers_care")).toBe("/clients");
    expect(movedTo("/customers_care/dashboard")).toBe("/clients");
    expect(movedTo("/companies-visits/12")).toBe("/dashboard");
    expect(movedTo("/setting/profits")).toBe("/settings/pricing");
    expect(movedTo("/rooms-types?x=1")).toBe("/hotels");
  });

  it("leaves the current pages where they are", () => {
    // /drivers and /ports rejoined the transport tabs (the owner's transport order, 2026-10-26)
    for (const path of ["/cars-types", "/cars/transfers", "/cars-capacities", "/drivers", "/ports", "/customers", "/companies-x", "/setting/climate", "/settings/pricing", "/hotels"]) expect(movedTo(path)).toBeNull();
  });

  it("puts each merged page's tabs over all of its parts, the most precise one active", () => {
    expect(tabsFor("/employees/accounts")).toMatchObject({ active: "/employees/accounts" });
    // «الحضور والإجازات» and «البدّالة» (presence, the owner 2026-10-29)
    expect(tabsFor("/employees")?.tabs.map((t) => t.href)).toEqual(["/employees", "/employees/accounts", "/employees/roles", "/employees/attendance", "/employees/switchboard"]);
    expect(tabsFor("/markup-rules")?.tabs.map((t) => t.href)).toEqual(["/settings/pricing", "/markup-rules"]);
    expect(tabsFor("/customers")?.active).toBe("/customers");
    // the transport family: one row of tabs from the vehicle types to the price grid
    expect(tabsFor("/cars-capacities")?.tabs.map((t) => t.href)).toEqual(["/transport-prices", "/cars-types", "/cars-capacities", "/cars/transfers", "/cars/tours", "/tour-programs", "/drivers", "/ports", "/price-grid"]);
    expect(tabsFor("/drivers")?.active).toBe("/drivers");
    expect(tabsFor("/services-types")?.active).toBe("/services-types");
    expect(tabsFor("/hotels")).toBeNull();
    // «العملاء» draws its own row, «الأشخاص» in it
    expect(tabsFor("/clients")).toBeNull();
  });

  it("keeps Murad settings independent from management decisions", () => {
    expect(tabsFor("/murad-settings")).toBeNull();
    expect(tabsFor("/management-decisions")).toBeNull();
    expect(movedTo("/murad-settings")).toBeNull();
  });

  it("puts the board and a new visa file in one row, a file's page under the board — the price list (/visas) keeps its own page", () => {
    expect(tabsFor("/visa-files")?.tabs.map((t) => t.href)).toEqual(["/visa-files", "/visa-files/new"]);
    expect(tabsFor("/visa-files/new")?.active).toBe("/visa-files/new");
    expect(tabsFor("/visa-files/6f1c")?.active).toBe("/visa-files");
    expect(tabsFor("/visas")).toBeNull();
  });
});
