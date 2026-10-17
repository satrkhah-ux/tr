import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";

/**
 * Who may work which operation — the ONE rule every operations action asks.
 *
 * The owner's order (2026-10-17): sales get «العمليات» as «ملفاته فقط، يشاهد
 * ويعمل» — they see and work the files THEY issued, no colleague's.
 *   · operations.write — every file (ops, visa, the owner);
 *   · operations.own   — only an operation whose offer names them as its
 *                        employee (offers.employee_id, «الموظف المختص» on the
 *                        document, stamped with the issuer when the offer is
 *                        produced — offer-insert.ts);
 *   · neither          — nothing.
 * currentCan honours a role view-as, so an administrator looking through
 * «مبيعات» sees exactly what a salesperson would, on their own files.
 *
 * An id from the browser is never trusted: a booking, a payment, a traveller …
 * is mapped to ITS operation here, on the server, with the service role (most of
 * these tables are closed to sessions), and that operation is what is checked.
 * The database says the same since 0078 (public.owns_operation).
 */

export type OpsAccess = { all: true } | { all: false; employeeId: string };

/** null when allowed, else the i18n key to return. */
export type Gate = TranslationKey | null;

/** The tables whose rows belong to one operation — directly, or through their booking. */
export type OpsTable =
  | "operations"
  | "operation_bookings"
  | "operation_documents"
  | "operation_payments"
  | "operation_travelers"
  | "operation_issues"
  | "operation_passport_submissions"
  | "operation_links"
  | "supplier_payments";

/** Pure: may this access work a file issued by `issuerId`? */
export function mayWork(access: OpsAccess | null, issuerId: string | null | undefined): boolean {
  if (!access) return false;
  return access.all || (Boolean(issuerId) && issuerId === access.employeeId);
}

/** What this request may do in operations — cached: one action asks several times. */
export const opsAccess = cache(async (): Promise<OpsAccess | null> => {
  if (!(await getServerUser())) return null;
  if (await currentCan("operations.write")) return { all: true };
  if (!(await currentCan("operations.own"))) return null;
  const employeeId = await getCurrentEmployeeId();
  return employeeId ? { all: false, employeeId } : null;
});

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Each row's operation, or null in the list when a row is missing or hangs off none. */
async function operationsOf(db: SupabaseClient, table: OpsTable, ids: string[]): Promise<(string | null)[]> {
  if (table === "operations") return ids;
  // a link hangs off its booking (a driver's day hangs off no single case at all)
  const column = table === "operation_links" ? "booking_id" : "operation_id";
  const { data, error } = await db.from(table).select(column).in("id", ids);
  if (error) throw error;
  const refs = ((data ?? []) as Record<string, string | null>[]).map((r) => r[column]);
  if (refs.length !== ids.length || refs.some((r) => !r)) return [null];
  return table === "operation_links" ? operationsOf(db, "operation_bookings", [...new Set(refs as string[])]) : refs;
}

/** Any operations access at all — for what belongs to no one file (the assignee list). */
export async function gateOps(): Promise<Gate> {
  if (!(await getServerUser())) return "err.session";
  return (await opsAccess()) ? null : "ops.err.forbidden";
}

/**
 * May the caller work these rows? Every id is mapped to its operation and, for
 * an own-files holder, every one of those must be a file they issued — one
 * foreign id refuses the whole action.
 */
export async function gateRows(table: OpsTable, ids: string[]): Promise<Gate> {
  if (!(await getServerUser())) return "err.session";
  const access = await opsAccess();
  if (!access) return "ops.err.forbidden";
  if (access.all) return null;
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return "ops.err.notYours";
  try {
    const db = service();
    const ops = await operationsOf(db, table, unique);
    if (ops.some((o) => !o)) return "ops.err.notYours";
    const opIds = [...new Set(ops as string[])];
    const { data, error } = await db.from("operations").select("id, offers(employee_id)").in("id", opIds);
    if (error) return "err.db";
    const rows = (data ?? []) as unknown as { offers: { employee_id: string | null } | { employee_id: string | null }[] | null }[];
    return rows.length === opIds.length && rows.every((r) => mayWork(access, one(r.offers)?.employee_id)) ? null : "ops.err.notYours";
  } catch {
    return "err.db";
  }
}

export async function gateOperation(operationId: string): Promise<Gate> {
  return gateRows("operations", [operationId]);
}

export async function gateRow(table: OpsTable, id: string): Promise<Gate> {
  return gateRows(table, [id]);
}

/**
 * The steps kept on operations.write even on one's own file: cancelling a case,
 * correcting or erasing money records, the client's payment terms, what a
 * supplier is owed and paid, and the company-wide reports. Asked AFTER the
 * row's own gate.
 */
export async function gateManager(): Promise<Gate> {
  if (!(await getServerUser())) return "err.session";
  const access = await opsAccess();
  return access?.all ? null : access ? "ops.err.managerOnly" : "ops.err.forbidden";
}
