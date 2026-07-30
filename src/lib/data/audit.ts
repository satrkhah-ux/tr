"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";

/**
 * The audit trail. Promoted out of suppliers.ts, where it was a file-private
 * helper that hardcoded `entity: "hotel_suppliers"` and never populated
 * `actor_id` — so the one table meant to answer "who did this" could only ever
 * answer it by email.
 *
 * Three deliberate differences from the original:
 *
 * 1. It takes NO supabase client. `audit_logs` is RLS-locked (0017), so a caller
 *    passing the ordinary user client writes nothing and the catch swallows it —
 *    silent audit loss is precisely the footgun to remove. This module builds
 *    the service client itself.
 * 2. `actor_id` is filled.
 * 3. The action vocabulary is a typed union, so a typo is a compile error rather
 *    than a row nobody will ever find again.
 */

export type AuditAction =
  // supplier vault (pre-existing)
  | "supplier.credentials_changed"
  | "supplier.updated"
  | "supplier.test_connection"
  // operations
  | "operation.confirmed"
  | "operation.client_status"
  | "operation.execution_status"
  | "operation.cancelled"
  | "payment.recorded"
  // passports — every one of these is a read of identity data
  | "passport.saved"
  | "passport.viewed"
  | "passport.scan_viewed"
  | "passport.decrypt_failed"
  // execution
  | "booking.created"
  | "booking.confirmed"
  | "booking.cancelled"
  | "dispatch.sent"
  | "voucher.issued"
  | "voucher.revoked"
  // partner companies (identity + branding)
  | "partner.created"
  | "partner.updated";

export type AuditInput = {
  action: AuditAction;
  entity: string;
  entity_id: string;
  /** NON-SECRET context only. Never a passport number, never a credential. */
  meta?: Record<string, unknown>;
};

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

/**
 * Append one audit row. Returns whether it was written.
 *
 * Callers normally ignore the result — audit must not block the work it records.
 * The ONE exception is reading passport data, where the caller checks this
 * boolean and refuses to hand over the data if the trail could not be written.
 * "We can prove who read the passports" and "we think we can" are different
 * claims, and that check is the whole difference. It costs nothing real: the
 * audit insert and the passport read share one service client, so a failure here
 * means the database is unreachable anyway.
 */
export async function logAudit(input: AuditInput): Promise<boolean> {
  try {
    const user = await getServerUser();
    const employeeId = await getCurrentEmployeeId();
    const { error } = await db()
      .from("audit_logs")
      .insert({
        actor_id: employeeId,
        actor_email: user?.email ?? null,
        action: input.action,
        entity: input.entity,
        entity_id: input.entity_id,
        meta: input.meta ?? {},
      });
    return !error;
  } catch {
    return false;
  }
}

export type AuditEntry = {
  id: string;
  action: string;
  actor_email: string | null;
  entity: string;
  entity_id: string;
  meta: Record<string, unknown>;
  created_at: string;
};

/** The audit trail for ONE entity — powers the per-operation timeline. */
export async function listEntityAudit(entity: string, entityId: string, limit = 100): Promise<AuditEntry[]> {
  try {
    const user = await getServerUser();
    if (!user) return [];
    const { data } = await db()
      .from("audit_logs")
      .select("id, action, actor_email, entity, entity_id, meta, created_at")
      .eq("entity", entity)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as AuditEntry[];
  } catch {
    return [];
  }
}
