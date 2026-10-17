"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { gateOperation, gateRow } from "@/lib/operations/access";

/**
 * After the bookings (operations order 6): the problems met during the trip,
 * and the client's rating once back. («جاهز للسفر» is the wizard's now —
 * lib/data/wizard-case.ts wizardReady.)
 */

type Fail = { ok: false; error: TranslationKey };

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

export type OperationIssue = {
  id: string;
  happened_at: string;
  description: string;
  resolution: string | null;
  resolved_at: string | null;
};

export async function listIssues(operationId: string): Promise<{ issues: OperationIssue[]; rating: { score: number; comment: string | null } | null }> {
  if (await gateOperation(operationId)) return { issues: [], rating: null };
  try {
    const supabase = await db();
    const [issues, rating] = await Promise.all([
      supabase.from("operation_issues").select("id, happened_at, description, resolution, resolved_at").eq("operation_id", operationId).order("happened_at", { ascending: false }),
      supabase.from("operation_ratings").select("score, comment").eq("operation_id", operationId).maybeSingle(),
    ]);
    return { issues: (issues.data ?? []) as OperationIssue[], rating: (rating.data as { score: number; comment: string | null } | null) ?? null };
  } catch {
    return { issues: [], rating: null };
  }
}

export async function addIssue(operationId: string, description: string): Promise<{ ok: true } | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  if (!description.trim()) return { ok: false, error: "ops.issue.required" };
  try {
    const { error } = await (await db())
      .from("operation_issues")
      .insert({ operation_id: operationId, description: description.trim(), created_by: await getCurrentEmployeeId() });
    if (error) return { ok: false, error: "err.createFailed" };
    await logAudit({ action: "operation.issue", entity: "operations", entity_id: operationId, meta: { issue: description.trim() } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export async function resolveIssue(issueId: string, resolution: string): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_issues", issueId);
  if (denied) return { ok: false, error: denied };
  if (!resolution.trim()) return { ok: false, error: "ops.issue.resolutionRequired" };
  try {
    const { error } = await (await db())
      .from("operation_issues")
      .update({ resolution: resolution.trim(), resolved_at: new Date().toISOString() })
      .eq("id", issueId);
    return error ? { ok: false, error: "err.updateFailed" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
