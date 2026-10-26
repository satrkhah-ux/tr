"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { notifyOps } from "@/lib/data/ops-notify";
import { logAudit } from "@/lib/data/audit";
import type { MailKind } from "@/lib/reservations-mail/classify";

/**
 * «بريد بلا ملف» — supplier emails the reader could not match, listed at the
 * bottom of the operations board: a human links each to its case or dismisses
 * it. data.write, like the data screens (price-grid.ts) — linking an email IS
 * a data correction, not a booking act.
 *
 * Service client after the gate: reservation_emails and operation_issues are
 * written together with the notice, exactly as the reader writes a matched one.
 */

type Fail = { ok: false; error: TranslationKey };

async function gate(): Promise<SupabaseClient | Fail> {
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  if (!(await currentCan("data.write"))) return { ok: false, error: "err.forbidden" };
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

const isFail = (x: unknown): x is Fail => typeof x === "object" && x !== null && "ok" in x;

export type UnlinkedEmail = {
  id: string;
  from_address: string | null;
  subject: string | null;
  kind: MailKind | null;
  received_at: string | null;
};

export async function listUnlinkedEmails(): Promise<UnlinkedEmail[]> {
  const db = await gate();
  if (isFail(db)) return [];
  const { data } = await db
    .from("reservation_emails")
    .select("id, from_address, subject, kind, received_at")
    .eq("status", "new")
    .order("received_at", { ascending: true })
    .limit(50);
  return ((data ?? []) as UnlinkedEmail[]) ?? [];
}

/** link it to its case by hand — the same issue and notice the reader raises on a match */
export async function linkEmailToOperation(emailId: string, operationId: string): Promise<{ ok: true } | Fail> {
  const db = await gate();
  if (isFail(db)) return db;
  const { data: mail } = await db.from("reservation_emails").select("id, subject, from_address, kind, status").eq("id", emailId).maybeSingle();
  const row = mail as { id: string; subject: string | null; from_address: string | null; kind: string | null; status: string } | null;
  if (!row || row.status !== "new") return { ok: false, error: "ops.err.notFound" };
  const { error } = await db
    .from("reservation_emails")
    .update({ operation_id: operationId, matched_by: "manual", status: "linked" })
    .eq("id", emailId)
    .eq("status", "new");
  if (error) return { ok: false, error: "err.db" };
  const line = `📧 بريد مورّد رُبط يدوياً: ${(row.subject ?? "—").slice(0, 200)} — من ${row.from_address ?? "—"}`;
  await db.from("operation_issues").insert({ operation_id: operationId, description: line });
  await notifyOps(line, `/operations/${operationId}`);
  await logAudit({ action: "operation.issue", entity: "reservation_emails", entity_id: emailId, meta: { operation_id: operationId, kind: row.kind, manual: true } });
  return { ok: true };
}

export async function dismissEmail(emailId: string): Promise<{ ok: true } | Fail> {
  const db = await gate();
  if (isFail(db)) return db;
  const { error } = await db.from("reservation_emails").update({ status: "dismissed" }).eq("id", emailId).eq("status", "new");
  return error ? { ok: false, error: "err.db" } : { ok: true };
}
