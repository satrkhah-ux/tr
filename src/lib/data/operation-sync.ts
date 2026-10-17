import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyPartnerCase } from "@/lib/data/ops-notify";
import { translate, type TranslationKey } from "@/lib/i18n";
import { aheadOfClient, aheadOfExecution, derivedClient, derivedExecution, readiness, type ReadinessItem } from "@/lib/operations/progress";
import { kanbanStageFor, type ClientStatus, type ExecutionStatus } from "@/lib/operations/state";
import { CLIENT_DOCUMENT_KINDS } from "@/lib/operations/voucher-dto";
import type { TravelerRow } from "@/lib/operations/traveler-dto";
import { MESSAGE_ON_STATE } from "@/lib/operations/client-messages";
import { sendClientMessage } from "@/lib/data/client-messages";
import { autoIssueDocuments } from "@/lib/data/wizard-sync";

/**
 * The ONE place a case's statuses move by themselves (operations order 6):
 * called after every confirmation, cancellation, issued document and payment.
 * Reads where the case actually stands (progress.ts) and moves each track
 * FORWARD only — a status an agent set by hand ahead of this is never pulled
 * back, and a cancelled case never moves. The kanban stage follows, as with a
 * manual change. Service role: every caller has already checked the agent's
 * permission for the action that triggered it. Best-effort: a failed sync never
 * fails the confirmation or the payment it follows.
 *
 * First, the documents whose data just became final are issued (and the
 * wizard's stale waits dropped — wizard-sync.ts), so the statuses below
 * already count them.
 */
export async function syncOperation(operationId: string): Promise<void> {
  try {
    await autoIssueDocuments(operationId);
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: op } = await supabase
      .from("operations")
      .select("id, offer_id, client_status, execution_status, offers(total)")
      .eq("id", operationId)
      .maybeSingle();
    const row = op as unknown as {
      id: string;
      offer_id: string;
      client_status: ClientStatus;
      execution_status: ExecutionStatus;
      offers: { total: number | string | null } | { total: number | string | null }[] | null;
    } | null;
    if (!row) return;
    const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers;

    const [bookings, documents, payments] = await Promise.all([
      supabase.from("operation_bookings").select("kind, status").eq("operation_id", operationId),
      supabase.from("operation_documents").select("kind").eq("operation_id", operationId).is("revoked_at", null).in("kind", CLIENT_DOCUMENT_KINDS),
      supabase.from("operation_payments").select("amount, kind").eq("operation_id", operationId),
    ]);

    const execTo = derivedExecution((bookings.data ?? []) as { kind: string; status: string }[], (documents.data ?? []) as { kind: string }[]);
    if (aheadOfExecution(row.execution_status, execTo)) {
      await supabase.from("operations").update({ execution_status: execTo, updated_at: new Date().toISOString() }).eq("id", operationId);
      const stage = kanbanStageFor(execTo);
      if (stage) await supabase.from("offers").update({ pipeline_stage: stage }).eq("id", row.offer_id);
      await logAudit({ action: "operation.execution_status", entity: "operations", entity_id: operationId, meta: { from: row.execution_status, to: execTo, auto: true } });
      await notifyPartnerCase({ offerId: row.offer_id, what: translate("ar", `ops.exec.${execTo}` as TranslationKey) });
      const message = MESSAGE_ON_STATE[execTo];
      if (message) await sendClientMessage(operationId, message);
    }

    const paid = ((payments.data ?? []) as { amount: number | string; kind: string }[]).reduce(
      (sum, p) => sum + (p.kind === "refund" ? -1 : 1) * (Number(p.amount) || 0),
      0,
    );
    const total = offer?.total != null ? Number(offer.total) : null;
    const clientTo = derivedClient(paid, total);
    if (aheadOfClient(row.client_status, clientTo)) {
      await supabase.from("operations").update({ client_status: clientTo, updated_at: new Date().toISOString() }).eq("id", operationId);
      await logAudit({ action: "operation.client_status", entity: "operations", entity_id: operationId, meta: { from: row.client_status, to: clientTo, auto: true } });
    }
  } catch {
    /* best-effort — the action it follows has already succeeded */
  }
}

/** The same, from a booking (its operation looked up first). */
export async function syncOperationOfBooking(bookingId: string): Promise<void> {
  try {
    const { data } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
      .from("operation_bookings")
      .select("operation_id")
      .eq("id", bookingId)
      .maybeSingle();
    const operationId = (data as { operation_id: string } | null)?.operation_id;
    if (operationId) await syncOperation(operationId);
  } catch {
    /* best-effort */
  }
}

/**
 * The «جاهز للسفر» checklist for one case — read with the service role, so the
 * caller must already have checked the agent may see the case.
 */
export async function readinessFor(operationId: string): Promise<ReadinessItem[] | null> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: op } = await supabase.from("operations").select("travel_start, travel_end, offers(total)").eq("id", operationId).maybeSingle();
    const row = op as unknown as { travel_start: string | null; travel_end: string | null; offers: { total: number | string | null } | { total: number | string | null }[] | null } | null;
    if (!row) return null;
    const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers;
    const [bookings, documents, payments, travelers] = await Promise.all([
      supabase.from("operation_bookings").select("kind, status").eq("operation_id", operationId),
      supabase.from("operation_documents").select("kind").eq("operation_id", operationId).is("revoked_at", null).in("kind", CLIENT_DOCUMENT_KINDS),
      supabase.from("operation_payments").select("amount, kind").eq("operation_id", operationId),
      supabase.from("operation_travelers").select("display_name, traveler_kind, passport_encrypted, passport_expiry, birth_date, age, nationality, visa_status").eq("operation_id", operationId).order("sort"),
    ]);
    const paid = ((payments.data ?? []) as { amount: number | string; kind: string }[]).reduce((s, p) => s + (p.kind === "refund" ? -1 : 1) * (Number(p.amount) || 0), 0);
    return readiness({
      bookings: (bookings.data ?? []) as { kind: string; status: string }[],
      documents: (documents.data ?? []) as { kind: string }[],
      paid,
      total: offer?.total != null ? Number(offer.total) : null,
      // the ciphertext is read only to become a yes/no, here, server-side
      travelers: ((travelers.data ?? []) as Pick<TravelerRow, "display_name" | "traveler_kind" | "passport_encrypted" | "passport_expiry" | "birth_date" | "age" | "nationality" | "visa_status">[]).map((t) => ({
        name: t.display_name || "—",
        has_passport: Boolean(t.passport_encrypted),
        passport_expiry: t.passport_expiry,
        birth_date: t.birth_date ?? null,
        age: t.age ?? null,
        traveler_kind: t.traveler_kind,
        nationality: t.nationality ?? null,
        visa_status: t.visa_status ?? "not_required",
      })),
      travelStart: row.travel_start,
      travelEnd: row.travel_end,
      today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
    });
  } catch {
    return null;
  }
}
