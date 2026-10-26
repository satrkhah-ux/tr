import { grantedPermissions, type Permission } from "@/lib/roles/roles";

/**
 * Who may do what on the visa department's files (pure; the actions in data/visa-files.ts and the tests share it).
 *
 * visas.work   — works files: sees his own and the unassigned ones.
 * visas.manage — the whole department: every file, reassigning, payments. Works files too.
 * dashboard.admin and developer.access count as both (the owner, 2026-10-26: the management account sees and
 * operates every section for real), without anything being granted to them first.
 *
 * `permissions` is what currentPermissions() returns — «عرض النظام كـ» (view-as) is already applied there, so an
 * administrator looking through the sales role gets no caller at all, exactly as that role would.
 */
export type VisaCaller = { employeeId: string | null; work: boolean; manage: boolean };

export function visaCaller(permissions: readonly Permission[], employeeId: string | null): VisaCaller | null {
  const has = (p: Permission) => permissions.includes(p);
  const manage = has("visas.manage") || has("dashboard.admin") || has("developer.access");
  const work = manage || has("visas.work");
  return work ? { employeeId, work, manage } : null;
}

/** May this caller open this file at all. */
export function canSee(file: { assignedTo: string | null }, caller: VisaCaller): boolean {
  if (caller.manage) return true;
  return caller.work && (file.assignedTo === null || file.assignedTo === caller.employeeId);
}

export type VisaEmployeeRow = {
  id: string;
  arabic_name: string;
  status: string | null;
  extra_permission_keys: string[] | null;
  removed_permission_keys: string[] | null;
  roles: { permission_keys: string[] | null } | { permission_keys: string[] | null }[] | null;
};

const keysOf = (e: VisaEmployeeRow) => {
  const role = Array.isArray(e.roles) ? e.roles[0] : e.roles;
  return grantedPermissions({ status: e.status, permission_keys: role?.permission_keys ?? null, extra_permission_keys: e.extra_permission_keys, removed_permission_keys: e.removed_permission_keys });
};

/** An active employee who could open a visa file (so a file may be handed to him). */
export const employeeWorksVisas = (e: VisaEmployeeRow) => visaCaller(keysOf(e), e.id) !== null;

/**
 * The people the board lists: those the roles name for the visa department (visas.work / visas.manage), not
 * every administrator or developer who can merely open it. Files assigned to anyone else are added by the board.
 */
export function visaPeople(rows: VisaEmployeeRow[]): { id: string; name: string }[] {
  return rows
    .filter((e) => keysOf(e).some((k) => k === "visas.work" || k === "visas.manage"))
    .map((e) => ({ id: e.id, name: e.arabic_name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}
