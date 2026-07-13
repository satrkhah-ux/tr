/**
 * Role + permission model (single source of truth). The real role is derived
 * from the signed-in employee's DB role; a dev-only "view as" can override the
 * EFFECTIVE role for inspection without granting real access.
 */

export type Role = "admin" | "employee" | "developer" | "visitor";

export const ROLES: Role[] = ["admin", "employee", "developer", "visitor"];

export const ROLE_LABELS_AR: Record<Role, string> = {
  admin: "إدارة",
  employee: "موظف",
  developer: "مطور",
  visitor: "زائر",
};

/** i18n keys for role labels (used by the UI via the translator). */
export const ROLE_LABEL_KEYS: Record<Role, "role.admin" | "role.employee" | "role.developer" | "role.visitor"> = {
  admin: "role.admin",
  employee: "role.employee",
  developer: "role.developer",
  visitor: "role.visitor",
};

export type Permission =
  | "dashboard.admin"
  | "dashboard.employee"
  | "offers.write"
  | "data.write"
  | "employees.manage"
  | "settings.manage"
  | "kanban.view"
  | "guide.view"
  /** see the pricing stage of the package generator (sell prices). */
  | "pricing.view"
  /** see INTERNAL pricing: buy price / profit / margin. */
  | "pricing.internal";

const ALL_PERMISSIONS: Permission[] = [
  "dashboard.admin",
  "dashboard.employee",
  "offers.write",
  "data.write",
  "employees.manage",
  "settings.manage",
  "kanban.view",
  "guide.view",
  "pricing.view",
  "pricing.internal",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Developer sees everything (for inspection).
  developer: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  // Employees build offers (sell prices) but never see buy price / profit.
  employee: ["dashboard.employee", "offers.write", "data.write", "kanban.view", "guide.view", "pricing.view"],
  visitor: ["guide.view"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export type DashboardView = "admin" | "employee" | "none";

export function dashboardViewFor(role: Role): DashboardView {
  if (can(role, "dashboard.admin")) return "admin";
  if (can(role, "dashboard.employee")) return "employee";
  return "none";
}
