"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { syncOperation } from "@/lib/data/operation-sync";
import { mintReceipt } from "@/lib/data/payment-receipt";
import type { PaymentKind, PaymentMethod } from "@/lib/data/operations";
import { PAYMENT_KINDS, PAYMENT_METHODS, isIsoDate } from "@/lib/operations/payments";
import { gateManager, gateOperation, gateRow } from "@/lib/operations/access";

/**
 * «الدفعات» beyond recording one (recordPayment, operations.ts): correcting and
 * deleting a payment, the client's proof of payment, the receipt link, and the
 * installment schedule. Every action is audited and behind operations/access.ts:
 * the slip and the receipt are the file's work (an own-files holder on their
 * own file too); correcting or deleting a payment, replacing a slip already on
 * file, and the schedule are the manager's (operations.write) — money records
 * and payment terms are not erased or moved by the person they are about.
 *
 * Rows go through the USER client (RLS is staff-only), except two narrow
 * writes the server builds itself — the receipt number and the slip's path —
 * which go through the service role after the gate, because 0078 gives an
 * own-files holder no UPDATE on payments (they could PATCH the amount). The
 * private `payment-proofs` bucket has no storage policy, so it is the service
 * role too, and only after the permission check.
 */

const BUCKET = "payment-proofs";
/** Short on purpose: a forwarded URL to a client's bank slip should die fast. */
const SIGNED_URL_TTL_SECONDS = 5 * 60;
const MAX_PROOF_BYTES = 8 * 1024 * 1024;
/** what a slip is — the bucket's own list (0062); never SVG, which can carry script. */
const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_INSTALLMENTS = 24;

type Fail = { ok: false; error: TranslationKey };

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const storage = () => (createSupabaseServiceClient() as unknown as SupabaseClient).storage.from(BUCKET);

type PaymentRow = {
  id: string;
  operation_id: string;
  amount: number;
  currency: string;
  kind: PaymentKind;
  method: PaymentMethod | null;
  paid_at: string;
  receipt_no: string | null;
  receipt_token: string | null;
  proof_path: string | null;
};

async function loadPayment(supabase: SupabaseClient, id: string): Promise<PaymentRow | null> {
  const { data } = await supabase
    .from("operation_payments")
    .select("id, operation_id, amount, currency, kind, method, paid_at, receipt_no, receipt_token, proof_path")
    .eq("id", id)
    .maybeSingle();
  return data as PaymentRow | null;
}

export type PaymentInput = {
  amount: number;
  kind: PaymentKind;
  method: PaymentMethod | null;
  reference: string | null;
  paid_at: string;
  note: string | null;
};

/** Correct a payment. The before/after goes to the audit log — money edited silently is money nobody can explain. */
export async function updatePayment(id: string, input: PaymentInput): Promise<{ ok: true } | Fail> {
  const denied = await gateManager();
  if (denied) return { ok: false, error: denied };
  if (!(Number.isFinite(input.amount) && input.amount > 0)) return { ok: false, error: "ops.err.amountPositive" };
  if (!PAYMENT_KINDS.includes(input.kind) || (input.method && !PAYMENT_METHODS.includes(input.method)) || !isIsoDate(input.paid_at)) {
    return { ok: false, error: "ops.pay.err.invalid" };
  }
  try {
    const supabase = await db();
    const before = await loadPayment(supabase, id);
    if (!before) return { ok: false, error: "err.loadFailed" };

    const { error } = await supabase
      .from("operation_payments")
      .update({
        amount: Math.round(input.amount * 100) / 100,
        kind: input.kind,
        method: input.method || null,
        reference: input.reference?.trim() || null,
        paid_at: input.paid_at,
        note: input.note?.trim() || null,
        updated_at: new Date().toISOString(),
        // a refund corrected into money IN is owed its receipt
        ...(input.kind !== "refund" && !before.receipt_token ? mintReceipt() : {}),
      })
      .eq("id", id);
    if (error) return { ok: false, error: "err.updateFailed" };

    await logAudit({
      action: "payment.updated",
      entity: "operations",
      entity_id: before.operation_id,
      meta: {
        payment_id: id,
        before: { amount: Number(before.amount), kind: before.kind, method: before.method, paid_at: before.paid_at },
        after: { amount: input.amount, kind: input.kind, method: input.method, paid_at: input.paid_at },
      },
    });
    await syncOperation(before.operation_id);
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Delete a payment — its receipt link dies with the row, its slip with the storage object. */
export async function deletePayment(id: string): Promise<{ ok: true } | Fail> {
  const denied = await gateManager();
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const row = await loadPayment(supabase, id);
    if (!row) return { ok: false, error: "err.loadFailed" };

    const { error } = await supabase.from("operation_payments").delete().eq("id", id);
    if (error) return { ok: false, error: "err.deleteFailed" };
    if (row.proof_path) await storage().remove([row.proof_path]);

    await logAudit({
      action: "payment.deleted",
      entity: "operations",
      entity_id: row.operation_id,
      meta: { payment_id: id, amount: Number(row.amount), currency: row.currency, kind: row.kind, paid_at: row.paid_at, receipt_no: row.receipt_no },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** Attach the client's transfer slip / POS receipt. Replaces any earlier one. */
export async function uploadPaymentProof(paymentId: string, formData: FormData): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_payments", paymentId);
  if (denied) return { ok: false, error: denied };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ops.err.noFile" };
  if (file.size > MAX_PROOF_BYTES) return { ok: false, error: "ops.err.fileTooLarge" };
  if (!PROOF_TYPES.includes(file.type)) return { ok: false, error: "ops.pay.err.fileType" };

  try {
    const supabase = await db();
    const row = await loadPayment(supabase, paymentId);
    if (!row) return { ok: false, error: "err.loadFailed" };
    // the first slip is the file's work; replacing one already on file erases it — the manager's
    if (row.proof_path) {
      const manager = await gateManager();
      if (manager) return { ok: false, error: manager };
    }

    // random leaf: a leaked path names no client and lets nobody guess its neighbours
    const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
    const path = `${row.operation_id}/${row.id}/${randomUUID()}.${ext}`;
    const up = await storage().upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (up.error) return { ok: false, error: "ops.err.uploadFailed" };

    // service: a server-built path, after the gate (see the module note)
    const { error } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("operation_payments")
      .update({ proof_path: path, updated_at: new Date().toISOString() })
      .eq("id", paymentId);
    if (error) {
      await storage().remove([path]);
      return { ok: false, error: "err.updateFailed" };
    }
    if (row.proof_path) await storage().remove([row.proof_path]);

    await logAudit({ action: "payment.updated", entity: "operations", entity_id: row.operation_id, meta: { payment_id: paymentId, proof: true } });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** A 5-minute signed URL to the slip, for staff only. */
export async function getPaymentProofUrl(paymentId: string): Promise<{ ok: true; url: string } | Fail> {
  const denied = await gateRow("operation_payments", paymentId);
  if (denied) return { ok: false, error: denied };
  try {
    const row = await loadPayment(await db(), paymentId);
    if (!row?.proof_path) return { ok: false, error: "ops.pay.err.noProof" };
    const signed = await storage().createSignedUrl(row.proof_path, SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) return { ok: false, error: "ops.pay.err.noProof" };
    await logAudit({ action: "payment.proof_viewed", entity: "operations", entity_id: row.operation_id, meta: { payment_id: paymentId } });
    return { ok: true, url: signed.data.signedUrl };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * The receipt's share token — minted now for a payment recorded before
 * receipts existed, so an old deposit gets its «سند قبض» the first time it is
 * asked for. Idempotent: the `is null` guard keeps a double click to one number.
 */
export async function ensurePaymentReceipt(paymentId: string): Promise<{ ok: true; token: string } | Fail> {
  const denied = await gateRow("operation_payments", paymentId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const row = await loadPayment(supabase, paymentId);
    if (!row) return { ok: false, error: "err.loadFailed" };
    if (row.kind === "refund") return { ok: false, error: "ops.pay.err.refundReceipt" };
    if (row.receipt_token) return { ok: true, token: row.receipt_token };

    const minted = mintReceipt();
    // service: a server-minted number, after the gate (see the module note)
    await (createSupabaseServiceClient() as unknown as SupabaseClient).from("operation_payments").update(minted).eq("id", paymentId).is("receipt_token", null);
    const after = await loadPayment(supabase, paymentId);
    if (!after?.receipt_token) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: "payment.updated", entity: "operations", entity_id: row.operation_id, meta: { payment_id: paymentId, receipt_no: after.receipt_no } });
    return { ok: true, token: after.receipt_token };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type InstallmentRow = { id: string; due_date: string; amount: number; note: string | null };

/** The stored schedule; empty = the default terms apply (payments.ts defaultSchedule). */
export async function listInstallments(operationId: string): Promise<InstallmentRow[]> {
  if (await gateOperation(operationId)) return [];
  try {
    const { data } = await (await db())
      .from("operation_installments")
      .select("id, due_date, amount, note")
      .eq("operation_id", operationId)
      .order("due_date", { ascending: true });
    return ((data ?? []) as InstallmentRow[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  } catch {
    return [];
  }
}

/**
 * Replace the schedule as a whole — it is edited as one table, so it is saved as
 * one. An empty list goes back to the default terms.
 *
 * ponytail: delete-then-insert is two statements; a failed insert leaves the
 * default schedule in force (visible, not silent). An RPC makes it atomic if
 * that ever matters.
 */
export async function saveInstallments(
  operationId: string,
  rows: { due_date: string; amount: number; note?: string | null }[],
): Promise<{ ok: true } | Fail> {
  const denied = await gateManager();
  if (denied) return { ok: false, error: denied };
  if (rows.length > MAX_INSTALLMENTS || rows.some((r) => !isIsoDate(r.due_date) || !(Number.isFinite(r.amount) && r.amount > 0))) {
    return { ok: false, error: "ops.pay.err.invalid" };
  }
  try {
    const supabase = await db();
    const cleared = await supabase.from("operation_installments").delete().eq("operation_id", operationId);
    if (cleared.error) return { ok: false, error: "err.updateFailed" };
    if (rows.length > 0) {
      const createdBy = await getCurrentEmployeeId();
      const { error } = await supabase.from("operation_installments").insert(
        rows.map((r) => ({
          operation_id: operationId,
          due_date: r.due_date,
          amount: Math.round(r.amount * 100) / 100,
          note: r.note?.trim() || null,
          created_by: createdBy,
        })),
      );
      if (error) return { ok: false, error: "err.updateFailed" };
    }
    await logAudit({
      action: "payment.schedule_set",
      entity: "operations",
      entity_id: operationId,
      meta: { rows: rows.map((r) => ({ due_date: r.due_date, amount: r.amount })) },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
