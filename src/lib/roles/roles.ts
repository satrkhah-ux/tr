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

/**
 * THE permission vocabulary. The list is the source and `Permission` is derived
 * from it — the two used to be declared separately, which meant a permission
 * could exist in the union while being absent from the "everything" array, and
 * an admin would silently not have it. Deriving makes that class of bug
 * unrepresentable.
 */
export const ALL_PERMISSIONS = [
  "dashboard.admin",
  "dashboard.employee",
  "offers.write",
  "data.write",
  "employees.manage",
  "settings.manage",
  "kanban.view",
  "guide.view",
  /** see the pricing stage of the package generator (sell prices). */
  "pricing.view",
  /** see INTERNAL pricing: buy price / profit / margin. */
  "pricing.internal",
  /** import & re-issue a supplier PDF (the repackage flow). */
  "repackage.write",
  /** run an operation after the client confirms: bookings, dispatch, vouchers. */
  "operations.write",
  /**
   * DECRYPT passport identifiers and open a passport scan. Split from
   * operations.write because "who is travelling / whose passport expires soon"
   * is everyday ops work, while reading the numbers is not — and every read is
   * written to audit_logs.
   */
  "operations.passport",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Developer sees everything (for inspection).
  developer: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  // Employees build offers (sell prices) but never see buy price / profit.
  // They DO get both operations permissions: an ops agent needs the passport
  // number to make the booking, and routing every booking through a manager
  // ends with the numbers being traded over WhatsApp outside the system.
  employee: [
    "dashboard.employee",
    "offers.write",
    "data.write",
    "kanban.view",
    "guide.view",
    "pricing.view",
    "repackage.write",
    "operations.write",
    "operations.passport",
  ],
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
