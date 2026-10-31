/**
 * Role + permission model (single source of truth). The real role is derived
 * from the signed-in employee's DB role; the administration and the developer
 * can look through another role («عرض النظام كـ», viewAsPermissions below),
 * which only ever narrows what they hold.
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
   * COMMIT a reservation through a supplier's API, and cancel one.
   *
   * Split from operations.write because it is the only button in the system that
   * spends company money without anyone typing an amount: it draws on our credit
   * limit at the supplier, and a mis-click is a paid night, not a bad record.
   * Re-checking a price stays on operations.write — asking costs nothing.
   */
  "operations.book",
  /**
   * DECRYPT passport identifiers and open a passport scan. Split from
   * operations.write because "who is travelling / whose passport expires soon"
   * is everyday ops work, while reading the numbers is not — and every read is
   * written to audit_logs.
   */
  "operations.passport",
  /**
   * Run the operations of the files YOU issued — and only those (sales,
   * 2026-10-17). operations.write is every file; this is the same screens
   * scoped to offers.employee_id = you, in the app and in RLS (0078).
   */
  "operations.own",
  /**
   * The manager's steps on the files YOU issued — cancelling the case, a refund,
   * correcting or deleting a payment, replacing a slip, the client's installment
   * schedule, what a supplier charged and was paid for it. The owner,
   * 2026-10-17: «اريد كل شخص يدير مبيعاته الى ان نوظف مدير مبيعات يجمع كل
   * العمليات» — until a sales manager is hired, each salesperson runs their own
   * files whole. Revoke = remove this one key from «مبيعات» (app gate access.ts
   * gateManagerRows, database 0081 — both read the role's keys live). Only
   * matters beside operations.own; the company-wide money (reports, cash flow,
   * supplier accounts) stays operations.write.
   */
  "operations.manage_own",
  /** «عمولتي»: your own commission — your paid-in-full files, their profit, your share (0092). */
  "commissions.view",
  /** run the month's commission cycle: calculate, adjust with a reason, send for approval. */
  "commissions.manage",
  /** approve and pay a cycle, approve the commission policy (never one you edited yourself). */
  "commissions.approve",
  /** «الحسابات»: the financial section's staff — the accounts home (/accounts) and the reminders to pay suppliers, refund deadlines and clients' installments. */
  "finance.accounts",
  /** «الخصومات»: make coupon campaigns and send them to clients (the owner, 2026-10-31). */
  "discounts.manage",
  /** «قارئ الكوبونات»: scan a client's coupon and use it — once. */
  "discounts.redeem",
  /** «مطوّر»: the developer page — external links' health, and turning system services on and off. */
  "developer.access",
  /** «العملاء» (/clients): every client conversation (0107 — every role got it; take it per role or colleague). */
  "clients.view",
  "followups.work",
  "followups.manage",
  /** «مطابقة تقريري»: paste the daily report written by hand and see it beside the system's, with the reasons of each difference (the owner, 2026-10-31). */
  "reports.staff_compare",
  /** «التأشيرات»: work the visa files (create, collect documents, submit, follow up) — the visa department. */
  "visas.work",
  /** «التأشيرات»: the department's whole board, reassigning files, payments and the numbers. */
  "visas.manage",
  /**
   * «تنبيهاتي» (@traveliunbot) as a manager (the user, 2026-10-22): every
   * colleague's live numbers in the bot, «📢 إعلان عام», and an alert to one of
   * them. The bot's management only, without employees.manage's power over
   * roles and passwords. employees.manage holds it as well.
   */
  "staffbot.manage",
  /**
   * The status buttons beside مُراد (the owner, 2026-10-29): «لدي عميل», «لدي اتصال», «صلاة» — while one is on, no
   * request is routed to the colleague and no delay is counted. Given per role or per colleague; «اجتماع» needs none
   * (it appears to whoever the administration invited).
   */
  "status.client",
  "status.call",
  "status.prayer",
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
    "clients.view",
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

/** Is this string one of ours? The DB stores permission keys as free text. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * What a signed-in person may do: an ACTIVE employee's role keys, nothing else.
 * No implicit administrator — «All Permissions» is simply a role listing every
 * key. public.staff_can() (migration 0073) is this same rule in SQL, so the
 * database's write policies and the app's gates answer alike.
 */
export function grantedPermissions(
  employee: {
    status: string | null;
    permission_keys: readonly string[] | null;
    extra_permission_keys?: readonly string[] | null;
    removed_permission_keys?: readonly string[] | null;
  } | null,
): Permission[] {
  if (!employee || employee.status !== "Active") return [];
  // the role's keys, plus what this one colleague was given (0106), minus what was taken from them (0107)
  const removed = new Set(employee.removed_permission_keys ?? []);
  return [...new Set([...(employee.permission_keys ?? []), ...(employee.extra_permission_keys ?? [])])].filter(
    (k): k is Permission => isPermission(k) && !removed.has(k),
  );
}

/**
 * The permission vocabulary, arranged the way an administrator reads it: by the
 * part of the system it opens, and split into what the holder SEES and what they
 * can DO. A flat list of thirteen keys is unanswerable — "what does someone in
 * this section see?" is the actual question, and this is the shape that answers it.
 *
 * `sensitive` marks the three that deserve a second thought before ticking:
 * identity documents, cost and profit, and the ability to grant permissions.
 */
export type PermissionKind = "view" | "do";

export type PermissionItem = {
  key: Permission;
  kind: PermissionKind;
  sensitive?: boolean;
};

export type PermissionGroup = {
  /** i18n key for the group heading. */
  key: string;
  items: PermissionItem[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "perm.group.dashboard",
    items: [
      { key: "dashboard.admin", kind: "view" },
      { key: "dashboard.employee", kind: "view" },
      { key: "pricing.internal", kind: "view", sensitive: true },
    ],
  },
  {
    key: "perm.group.offers",
    items: [
      { key: "offers.write", kind: "do" },
      { key: "pricing.view", kind: "view" },
      { key: "repackage.write", kind: "do" },
      { key: "kanban.view", kind: "view" },
    ],
  },
  {
    key: "perm.group.clients",
    items: [{ key: "clients.view", kind: "view" }, { key: "followups.work", kind: "do" }, { key: "followups.manage", kind: "do", sensitive: true }, { key: "reports.staff_compare", kind: "do" }],
  },
  {
    key: "perm.group.visas",
    items: [{ key: "visas.work", kind: "do" }, { key: "visas.manage", kind: "do", sensitive: true }],
  },
  {
    key: "perm.group.operations",
    items: [
      { key: "operations.write", kind: "do" },
      { key: "operations.own", kind: "do" },
      { key: "operations.manage_own", kind: "do", sensitive: true },
      { key: "operations.passport", kind: "view", sensitive: true },
      // a booking at the supplier spends money: given by name, never with «تحديد الكل»
      { key: "operations.book", kind: "do", sensitive: true },
    ],
  },
  {
    key: "perm.group.data",
    items: [
      { key: "data.write", kind: "do" },
      { key: "settings.manage", kind: "do" },
    ],
  },
  {
    key: "perm.group.commissions",
    items: [
      { key: "commissions.view", kind: "view" },
      { key: "commissions.manage", kind: "do", sensitive: true },
      { key: "commissions.approve", kind: "do", sensitive: true },
    ],
  },
  {
    key: "perm.group.accounts",
    items: [{ key: "finance.accounts", kind: "do", sensitive: true }],
  },
  {
    key: "perm.group.discounts",
    items: [
      { key: "discounts.manage", kind: "do", sensitive: true },
      { key: "discounts.redeem", kind: "do" },
    ],
  },
  {
    key: "perm.group.team",
    items: [
      { key: "employees.manage", kind: "do", sensitive: true },
      { key: "staffbot.manage", kind: "do", sensitive: true },
      { key: "status.client", kind: "do" },
      { key: "status.call", kind: "do" },
      { key: "status.prayer", kind: "do" },
    ],
  },
  {
    key: "perm.group.developer",
    items: [{ key: "developer.access", kind: "do", sensitive: true }],
  },
  {
    key: "perm.group.guide",
    items: [{ key: "guide.view", kind: "view" }],
  },
];

/** Compile-time proof that the groups above cover the whole vocabulary. */
const GROUPED = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
type _EveryPermissionGrouped = typeof GROUPED extends Permission[] ? true : never;
export const UNGROUPED_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => !GROUPED.includes(p));

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * «التبديل بين الحسابات» (2026-10-17): the administration and the developer can
 * look at the system as another role sees it — sales, operations… — to check
 * what that role gets. It only ever NARROWS: the view is the chosen role's keys
 * that the real account also holds, and a role carrying developer.access is
 * not offered to an account without it (the developer's view stays the
 * developer's). The real session still decides what the database lets through.
 */
export const VIEW_AS_COOKIE = "tv_view_role";

/**
 * The administration (it manages the team: employees.manage) and the developer.
 * Not dashboard.admin: «مدير مبيعات» reads the admin dashboard but is not the
 * administration the owner meant.
 */
export function canSwitchRoles(realPermissions: readonly Permission[]): boolean {
  return realPermissions.includes("employees.manage") || realPermissions.includes("developer.access");
}

/** The permissions a view-as session runs with, or null when that role may not be viewed as. */
export function viewAsPermissions(realPermissions: readonly Permission[], roleKeys: readonly string[]): Permission[] | null {
  if (!canSwitchRoles(realPermissions)) return null;
  const keys = roleKeys.filter(isPermission);
  if (keys.includes("developer.access") && !realPermissions.includes("developer.access")) return null;
  // the visa department's two keys are implied by the management keys (visa-files/access.ts), so they are held too
  const managed = realPermissions.includes("dashboard.admin") || realPermissions.includes("developer.access");
  return keys.filter((k) => realPermissions.includes(k) || (managed && (k === "visas.work" || k === "visas.manage")));
}

/** The roles the switcher offers this account: the ones viewAsPermissions accepts, nothing else. */
export function switchableRoles<R extends { permission_keys: readonly string[] | null }>(
  realPermissions: readonly Permission[],
  roles: readonly R[],
): R[] {
  return roles.filter((r) => viewAsPermissions(realPermissions, r.permission_keys ?? []) !== null);
}

/**
 * «حساب المطوّر لا يُوصَل إليه من حساب الإدارة» (2026-10-17): a role carrying
 * developer.access — and every employee sitting in one — is managed only by an
 * account whose OWN role carries it. Otherwise an administrator could tick the
 * key onto their own section, move themselves into the developer's, or point
 * the developer's login at their own mailbox.
 */
export function isDeveloperRole(permissionKeys: readonly string[] | null | undefined): boolean {
  return (permissionKeys ?? []).includes("developer.access");
}

export type DashboardView = "admin" | "employee" | "none";

export function dashboardViewFor(role: Role): DashboardView {
  if (can(role, "dashboard.admin")) return "admin";
  if (can(role, "dashboard.employee")) return "employee";
  return "none";
}
