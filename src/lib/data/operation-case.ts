"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { listAssignees } from "@/lib/data/operation-assign";
import { currentCan } from "@/lib/roles/current";
import { toClientInfo, type ClientInfo } from "@/lib/operations/case-list";

/**
 * The case as a piece of work: who owns it, what its page tells the client,
 * what the team noted, and who did what.
 *
 * assignee_id / client_info arrive with 0064. Every read of them is its own
 * query that fails soft, so this code deployed before the migration shows an
 * unowned case instead of an empty board.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type Fail = { ok: false; error: TranslationKey };

async function requireOps(): Promise<TranslationKey | null> {
  const user = await getServerUser();
  if (!user) return "err.session";
  return (await currentCan("operations.write")) ? null : "ops.err.forbidden";
}

export type StaffOption = { id: string; label: string };

/** The board's owner column and the people a case can be given to. */
export async function listCaseOwners(): Promise<{ owners: Record<string, string>; staff: StaffOption[] }> {
  const empty = { owners: {}, staff: [] };
  if (await requireOps()) return empty;
  try {
    const supabase = await db();
    const [ownersRes, people] = await Promise.all([supabase.from("operations").select("id, assignee_id").not("assignee_id", "is", null), listAssignees()]);
    const owners = Object.fromEntries(((ownersRes.data ?? []) as { id: string; assignee_id: string }[]).map((o) => [o.id, o.assignee_id]));
    return { owners, staff: people.filter((p) => p.kind === "employee" && p.id).map((p) => ({ id: p.id as string, label: p.label })) };
  } catch {
    return empty;
  }
}

export async function getCaseExtras(operationId: string): Promise<{ assignee_id: string | null; client_info: ClientInfo }> {
  const empty = { assignee_id: null, client_info: toClientInfo(null) };
  if (await requireOps()) return empty;
  try {
    const { data } = await (await db()).from("operations").select("assignee_id, client_info").eq("id", operationId).maybeSingle();
    const row = data as { assignee_id: string | null; client_info: unknown } | null;
    return { assignee_id: row?.assignee_id ?? null, client_info: toClientInfo(row?.client_info) };
  } catch {
    return empty;
  }
}

export async function setCaseAssignee(operationId: string, employeeId: string | null): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const { error } = await (await db()).from("operations").update({ assignee_id: employeeId || null }).eq("id", operationId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "operation.assigned", entity: "operations", entity_id: operationId, meta: { assignee_id: employeeId || null } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** What /trip shows the client about reaching us. Only the four known fields are kept. */
export async function saveClientInfo(operationId: string, info: ClientInfo): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  try {
    const clean = toClientInfo(info);
    const { error } = await (await db()).from("operations").update({ client_info: clean }).eq("id", operationId);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "operation.client_info", entity: "operations", entity_id: operationId, meta: { fields: Object.keys(clean).filter((k) => clean[k as keyof ClientInfo]) } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * An internal note: an audit row, not a column. audit_logs is readable by the
 * service role only, so a note can reach neither a partner (who reads their own
 * operations rows, 0037) nor the client link — and it is in the activity log by
 * construction.
 */
export async function addCaseNote(operationId: string, note: string): Promise<{ ok: true } | Fail> {
  const denied = await requireOps();
  if (denied) return { ok: false, error: denied };
  const text = note.trim().slice(0, 2000);
  if (!text) return { ok: false, error: "ops.err.emptyMessage" };
  try {
    const { data } = await (await db()).from("operations").select("id").eq("id", operationId).maybeSingle();
    if (!data) return { ok: false, error: "ops.err.notFound" };
    const written = await logAudit({ action: "operation.note", entity: "operations", entity_id: operationId, meta: { note: text } });
    return written ? { ok: true } : { ok: false, error: "err.createFailed" };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ActivityEntry = {
  id: string;
  action: string;
  actor: string | null;
  created_at: string;
  /** the few non-secret facts worth a line: a status, an amount, a number, a note. */
  meta: Record<string, string>;
};

const SHOWN_META = ["from", "to", "amount", "currency", "kind", "confirmation_number", "note", "channel", "time", "date", "seeded"];

/** Who did what to this case and when — the case row, its bookings, documents and travellers. */
export async function listCaseActivity(operationId: string): Promise<ActivityEntry[]> {
  if (await requireOps()) return [];
  try {
    // service: audit_logs and operation_travelers are both locked to it; requireOps is the gate
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const [bookings, documents, travelers] = await Promise.all(
      ["operation_bookings", "operation_documents", "operation_travelers"].map((table) => service.from(table).select("id").eq("operation_id", operationId)),
    );
    // uuids are unique across tables, so the ids alone pick this case's rows
    const ids = [operationId, ...[bookings, documents, travelers].flatMap((r) => ((r.data ?? []) as { id: string }[]).map((x) => x.id))];
    const { data } = await service
      .from("audit_logs")
      .select("id, action, actor_email, meta, created_at, employees(arabic_name)")
      .in("entity_id", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    return ((data ?? []) as unknown as {
      id: string;
      action: string;
      actor_email: string | null;
      meta: Record<string, unknown> | null;
      created_at: string;
      employees: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
    }[]).map((r) => ({
      id: r.id,
      action: r.action,
      actor: one(r.employees)?.arabic_name ?? r.actor_email,
      created_at: r.created_at,
      meta: Object.fromEntries(
        SHOWN_META.filter((k) => r.meta?.[k] != null && r.meta[k] !== "").map((k) => [k, String(r.meta?.[k]).slice(0, 2000)]),
      ),
    }));
  } catch {
    return [];
  }
}
