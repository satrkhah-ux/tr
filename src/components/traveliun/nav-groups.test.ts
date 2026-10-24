import { describe, expect, it } from "vitest";
import { FEATURE_DEFAULTS, type Feature } from "@/lib/features";
import type { Permission } from "@/lib/roles/roles";
import { navGroupsFor } from "./TraveliunShell";

/** The owner's order of 2026-10-17: what each role's sidebar holds. */
const role = (keys: Permission[]) => (p: Permission) => keys.includes(p);
const SALES = role(["dashboard.employee", "offers.write", "clients.view", "data.write", "kanban.view", "guide.view", "pricing.view", "repackage.write", "pricing.internal", "operations.own"]);
const OPS = role(["dashboard.employee", "clients.view", "data.write", "kanban.view", "guide.view", "operations.write", "operations.passport"]);
const on = (f: Feature) => FEATURE_DEFAULTS[f];
const off = (feature: Feature) => (f: Feature) => f !== feature && FEATURE_DEFAULTS[f];

describe("the sidebar", () => {
  it("shows sales the home, «بيسك», the clients, operations and the data — nothing else", () => {
    // «المتابعة»: each seller follows his own offers (owner order 4, 2026-10-23)
    expect(navGroupsFor(SALES, on).map((g) => g.labelKey)).toEqual(["nav.dashboard", "nav.basic", "nav.customers", "nav.followups", "nav.operations", "nav.dataSection"]);
  });

  it("holds the old «البكجات السياحية» inside «بيسك», the legacy generator only while it is on", () => {
    const basic = (featureOn: (f: Feature) => boolean) => navGroupsFor(SALES, featureOn).find((g) => g.labelKey === "nav.basic")?.children?.map((c) => c.href);
    expect(basic(on)).toEqual(["/basic?new=1", "/ready-offers", "/confirmed-trips", "/kanban-board", "/repackage", "/repackage/flight-card", "/package-generator"]);
    expect(basic(off("legacy_generator"))).not.toContain("/package-generator");
    // the two redesign tools, each with its own switch
    expect(basic(off("flight_card"))).toContain("/repackage");
    expect(basic(off("flight_card"))).not.toContain("/repackage/flight-card");
    expect(basic(off("repackage"))).not.toContain("/repackage");
  });

  it("keeps the data section to what sales may open", () => {
    const data = navGroupsFor(SALES, on).find((g) => g.labelKey === "nav.dataSection")?.children?.map((c) => c.href) ?? [];
    expect(data).toContain("/hotels");
    expect(data).not.toContain("/markup-rules");
    expect(data).not.toContain("/settings/suppliers");
    // «مناخ المدن» is settings.manage — not sales'
    expect(data).not.toContain("/setting/climate");
  });

  // fourteen, and «ابحث عن دولة أو خدمة» first — the owner's own order of 2026-10-22
  it("holds «البيانات» to fifteen links and «الإدارة» to four (the owner, 2026-10-19, 2026-10-22)", () => {
    const all = () => true;
    const section = (key: string) => navGroupsFor(all, on).find((g) => g.labelKey === key)?.children?.map((c) => c.href) ?? [];
    expect(section("nav.dataSection")).toEqual([
      "/data-search",
      "/data-quality",
      "/hotels",
      "/countries",
      "/cities",
      "/airlines",
      "/airports",
      "/cars-types",
      "/cars/transfers",
      "/tour-programs",
      "/services-types",
      "/visas",
      "/company-suppliers",
      "/offers/offer-includes",
      "/setting/climate",
    ]);
    expect(section("nav.adminSection")).toEqual(["/employees", "/settings/pricing", "/settings/client-comms", "/settings/screens", "/settings/conversations", "/web-guide"]);
  });

  it("points a section whose home is closed at its first open link", () => {
    // ops hold the kanban, not «بيسك» (offers.write)
    const basic = navGroupsFor(OPS, on).find((g) => g.labelKey === "nav.basic");
    expect(basic?.href).toBe("/kanban-board");
    expect(basic?.children?.map((c) => c.href)).toEqual(["/kanban-board"]);
  });
});

describe("a merged page's link (the walk of 94c84a7)", () => {
  it("opens for whoever can open any of its tabs, on their first one: «المطوّر» without developer.access", () => {
    const admin = role(["dashboard.admin", "settings.manage", "employees.manage", "data.write", "clients.view"]);
    const dev = navGroupsFor(admin, on).find((g) => g.labelKey === "nav.developer");
    expect(dev?.href).toBe("/settings/integrations");
    // a role that opens none of them sees no link
    expect(navGroupsFor(SALES, on).find((g) => g.labelKey === "nav.developer")).toBeUndefined();
  });
});
