import type { Permission } from "./roles";

/**
 * «الرئيسية» per department (the owner, 2026-10-29): a colleague's home follows the work their permissions give them,
 * not one page for everybody. The administration keeps its own overview (TraveliunDashboardClient AdminHome).
 * Order is the order of the tabs — the first is the colleague's own.
 */
export type HomeKind = "visas" | "operations" | "sales" | "data";

const RULES: [HomeKind, readonly Permission[]][] = [
  ["visas", ["visas.work", "visas.manage"]],
  ["operations", ["operations.write", "operations.own", "operations.book"]],
  ["sales", ["offers.write", "followups.work", "clients.view"]],
  ["data", ["data.write"]],
];

export function homeKindsFor(can: (p: Permission) => boolean): HomeKind[] {
  return RULES.filter(([, keys]) => keys.some(can)).map(([kind]) => kind);
}
