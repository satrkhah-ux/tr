import { describe, expect, it } from "vitest";
import { FEATURE_DEFAULTS, type Feature } from "@/lib/features";
import type { Permission } from "@/lib/roles/roles";
import { navGroupsFor } from "./TraveliunShell";

/** The owner's order of 2026-10-17: what each role's sidebar holds. */
const role = (keys: Permission[]) => (p: Permission) => keys.includes(p);
const SALES = role(["dashboard.employee", "offers.write", "data.write", "kanban.view", "guide.view", "pricing.view", "repackage.write", "pricing.internal", "operations.own"]);
const OPS = role(["dashboard.employee", "data.write", "kanban.view", "guide.view", "operations.write", "operations.passport"]);
const on = (f: Feature) => FEATURE_DEFAULTS[f];
const off = (feature: Feature) => (f: Feature) => f !== feature && FEATURE_DEFAULTS[f];

describe("the sidebar", () => {
  it("shows sales the home, «بيسك», the clients, operations and the data — nothing else", () => {
    expect(navGroupsFor(SALES, on).map((g) => g.labelKey)).toEqual(["nav.dashboard", "nav.basic", "nav.customers", "nav.operations", "nav.dataSection"]);
  });

  it("holds the old «البكجات السياحية» inside «بيسك», the legacy generator only while it is on", () => {
    const basic = (featureOn: (f: Feature) => boolean) => navGroupsFor(SALES, featureOn).find((g) => g.labelKey === "nav.basic")?.children?.map((c) => c.href);
    expect(basic(on)).toEqual(["/basic", "/ready-offers", "/offers", "/kanban-board", "/repackage", "/repackage/flight-card", "/package-generator"]);
    expect(basic(off("legacy_generator"))).not.toContain("/package-generator");
  });

  it("keeps the data section to what sales may open", () => {
    const data = navGroupsFor(SALES, on).find((g) => g.labelKey === "nav.dataSection")?.children?.map((c) => c.href) ?? [];
    expect(data).toContain("/hotels");
    expect(data).not.toContain("/markup-rules");
    expect(data).not.toContain("/settings/suppliers");
    // the hidden vault's block heading moves to the next link shown
    const links = navGroupsFor(SALES, on).find((g) => g.labelKey === "nav.dataSection")?.children ?? [];
    expect(links.find((c) => c.href === "/company-suppliers")?.captionKey).toBe("nav.hotelSuppliers");
  });

  it("points a section whose home is closed at its first open link", () => {
    // ops hold the kanban, not «بيسك» (offers.write)
    const basic = navGroupsFor(OPS, on).find((g) => g.labelKey === "nav.basic");
    expect(basic?.href).toBe("/kanban-board");
    expect(basic?.children?.map((c) => c.href)).toEqual(["/kanban-board"]);
  });
});
