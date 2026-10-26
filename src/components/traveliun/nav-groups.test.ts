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
    // «متابعتي»: every employee's own list (2026-10-26); «المتابعة» is the team's and the administration's, so sales do not see it
    // «سكرتيري الخاص»: every employee's own assistant (owner order 2, 2026-10-24)
    expect(navGroupsFor(SALES, on).map((g) => g.labelKey)).toEqual(["nav.dashboard", "nav.basic", "nav.customers", "nav.myFollowups", "nav.secretary", "nav.operations", "nav.dataSection"]);
  });

  it("holds the old «البكجات السياحية» inside «بيسك», the legacy generator only while it is on", () => {
    const basic = (featureOn: (f: Feature) => boolean) => navGroupsFor(SALES, featureOn).find((g) => g.labelKey === "nav.basic")?.children?.map((c) => c.href);
    expect(basic(on)).toEqual(["/basic?new=1", "/basic?files=issued", "/ready-offers", "/confirmed-trips", "/kanban-board", "/repackage", "/repackage/flight-card", "/package-generator"]);
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
  it("holds «البيانات» to sixteen links and «الإدارة» to four (the owner, 2026-10-19, 2026-10-22, 2026-10-26)", () => {
    const all = () => true;
    const section = (key: string) => navGroupsFor(all, on).find((g) => g.labelKey === key)?.children?.map((c) => c.href) ?? [];
    expect(section("nav.dataSection")).toEqual([
      "/data-search",
      "/data-quality",
      "/countries",
      "/cities",
      "/hotels",
      "/setting/climate",
      "/airlines",
      "/airports",
      "/cars-types",
      // «إدارة أسعار المواصلات» (the owner's transport details order, 2026-10-26)
      "/transport-prices",
      "/cars/transfers",
      "/tour-programs",
      "/services-types",
      "/visas",
      "/company-suppliers",
      "/offers/offer-includes",
    ]);
    // the links sit under six captions (the owner, 2026-10-26: «قسم البيانات يحتاج تنظيم»)
    const captions = navGroupsFor(all, on).find((g) => g.labelKey === "nav.dataSection")?.children?.filter((c) => c.captionKey).map((c) => c.captionKey);
    expect(captions).toEqual(["nav.dataCap.find", "nav.dataCap.places", "nav.dataCap.air", "nav.dataCap.transport", "nav.dataCap.services", "nav.dataCap.company"]);
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

describe("«التأشيرات» (the owner, 2026-10-26)", () => {
  const visas = (can: (p: Permission) => boolean) => navGroupsFor(can, on).find((g) => g.labelKey === "nav.visaFiles");
  const hrefs = (can: (p: Permission) => boolean) => visas(can)?.children?.map((c) => c.href);

  it("opens for the visa department and for the management — each key on its own", () => {
    for (const key of ["visas.work", "visas.manage", "dashboard.admin", "developer.access"] as Permission[]) {
      expect(hrefs(role([key]))).toEqual(["/visa-files", "/visa-files/new"]);
      expect(visas(role([key]))?.href).toBe("/visa-files");
    }
  });

  it("is not in sales' or operations' menu, although they open the price list under «البيانات»", () => {
    expect(visas(SALES)).toBeUndefined();
    expect(visas(OPS)).toBeUndefined();
    expect(visas(role(["data.write"]))).toBeUndefined();
    expect(navGroupsFor(SALES, on).find((g) => g.labelKey === "nav.dataSection")?.children?.map((c) => c.href)).toContain("/visas");
  });

  it("adds the price list (the existing /visas page) for whoever opens both the board and the data", () => {
    expect(hrefs(role(["visas.work", "data.write"]))).toEqual(["/visa-files", "/visa-files/new", "/visas"]);
    // the board's keys alone do not open /visas (data.write), so no dead link
    expect(hrefs(role(["visas.manage"]))).not.toContain("/visas");
  });
});
