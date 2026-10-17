import type { Permission } from "@/lib/roles/roles";
import { canOpenPath } from "@/lib/roles/section-access";
import { accessOf, mayWork } from "@/lib/operations/access";

/**
 * Who a staff notice that links to a page goes to: whoever that page opens
 * for — the same rule the page applies when they tap the button, so nobody is
 * sent to a screen that bounces them to the dashboard.
 *
 *  · any page — section-access.ts canOpenPath on the recipient's own
 *    permissions (/partner-companies settings.manage, /employees
 *    employees.manage, /data-quality data.write …);
 *  · one operation's page (/operations/<id>) — who may work that file
 *    (operations/access.ts): operations.write every file, operations.own only
 *    the files they issued (the offer's employee_id, `issuerId`).
 */

export type StaffMember = { id: string; chatId: number; permissions: readonly Permission[] };

const OPERATION = /^\/operations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/?#]|$)/i;

/** The operation a link opens, or null when it opens no single file. */
export function operationOfPath(href: string): string | null {
  return OPERATION.exec(href)?.[1] ?? null;
}

/** The members `href` opens for; `issuerId` is the linked operation's offers.employee_id. */
export function noticeRecipients(staff: readonly StaffMember[], href: string, issuerId?: string | null): StaffMember[] {
  const oneFile = operationOfPath(href) !== null;
  return staff.filter(
    (s) =>
      canOpenPath(href, (p) => s.permissions.includes(p)) &&
      (!oneFile || mayWork(accessOf(s.id, s.permissions), issuerId)),
  );
}
