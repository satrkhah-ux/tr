import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { issueDocumentNow } from "@/lib/data/document-issue";
import type { OperationBooking, OperationDocument } from "@/lib/data/operation-bookings";
import { CLIENT_DOCUMENT_KINDS, HOTEL_ID_KEY } from "@/lib/operations/voucher-dto";
import { toTravelerListItem, type TravelerRow } from "@/lib/operations/traveler-dto";
import { dueDocuments } from "@/lib/operations/wizard/documents";
import { readWaits, withoutWaits } from "@/lib/operations/wizard/followup";
import { bookingStepStates, staleWaits } from "@/lib/operations/wizard/index";
import type { CaseWaits } from "@/lib/operations/wizard/types";

/**
 * «معالج الحجوزات» on the server, after every change to a case: what the
 * wizard used to do only when someone opened the case — issue the documents
 * whose data just became final, mint the client's link with the first one out,
 * and drop the «ينتظر» of a step that is now done. A confirmation made on
 * «عرض الكل», through a supplier's link or by the supplier's API counts the
 * same as one made in the wizard.
 */

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/**
 * operations.waits, changed by `change` — which gets what is stored now and
 * returns the waits to write, or null for nothing to write. Written only if
 * the case was not written since it was read (guarded by updated_at, which
 * every waits write moves), else read again and retried: two people setting
 * «ينتظر» on two steps at the same second both keep theirs.
 */
export async function writeWaits(
  supabase: SupabaseClient,
  operationId: string,
  change: (waits: CaseWaits) => CaseWaits | null,
): Promise<{ ok: true; waits: CaseWaits | null } | { ok: false }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase.from("operations").select("waits, updated_at").eq("id", operationId).maybeSingle();
    if (error || !data) return { ok: false };
    const row = data as { waits: unknown; updated_at: string };
    const next = change(readWaits(row.waits));
    if (!next) return { ok: true, waits: null };
    const { data: written, error: writeError } = await supabase
      .from("operations")
      .update({ waits: next, updated_at: new Date().toISOString() })
      .eq("id", operationId)
      .eq("updated_at", row.updated_at)
      .select("id");
    if (writeError) return { ok: false };
    if ((written ?? []).length > 0) return { ok: true, waits: next };
  }
  return { ok: false };
}

/**
 * The vouchers that waited on a hotel's data (document-issue.ts «waiting»),
 * now that the data team has given it — every open case with a booking in
 * this hotel, by its catalogue id or its name. Best-effort, like the rest.
 */
export async function issueVouchersForHotel(hotelId: string): Promise<void> {
  try {
    const supabase = service();
    const { data: hotel } = await supabase.from("hotels").select("arabic_name").eq("id", hotelId).maybeSingle();
    const name = (hotel as { arabic_name: string } | null)?.arabic_name?.trim();
    const [byId, byName] = await Promise.all([
      supabase.from("operation_bookings").select("operation_id").eq("kind", "hotel").eq(`detail->>${HOTEL_ID_KEY}`, hotelId),
      name ? supabase.from("operation_bookings").select("operation_id").eq("kind", "hotel").eq("title", name) : Promise.resolve({ data: [] }),
    ]);
    const ids = [...new Set([...(byId.data ?? []), ...(byName.data ?? [])].map((r) => (r as { operation_id: string }).operation_id))];
    if (ids.length === 0) return;
    // a popular hotel's old trips are long done — only the open cases are worth a look
    const { data: open } = await supabase.from("operations").select("id").in("id", ids.slice(0, 500)).not("execution_status", "in", "(cancelled,travelled)");
    for (const { id } of (open ?? []) as { id: string }[]) await autoIssueDocuments(id);
  } catch {
    /* the wizard issues them on its next visit all the same */
  }
}

/**
 * Issue every document whose data is final, mint the link, clear the stale
 * waits — for one case. Run by operation-sync (syncOperation) after every
 * confirmation, cancellation, issued document and payment; best-effort, like
 * it. Service role: the caller's action was gated, or it is the server's own
 * (a supplier's link has no session). A case cancelled or travelled gets no
 * new paper.
 */
export async function autoIssueDocuments(operationId: string): Promise<void> {
  try {
    const supabase = service();
    const { data: op } = await supabase
      .from("operations")
      .select("offer_id, execution_status, client_token, client_token_revoked_at, waits")
      .eq("id", operationId)
      .maybeSingle();
    const row = op as { offer_id: string; execution_status: string; client_token: string | null; client_token_revoked_at: string | null; waits: unknown } | null;
    if (!row || row.execution_status === "cancelled" || row.execution_status === "travelled") return;

    const [bookingsRes, documentsRes, daysRes, travelersRes] = await Promise.all([
      // every column: the plan and the step rules read the same rows the case page does (the nets never leave here)
      supabase.from("operation_bookings").select("*").eq("operation_id", operationId).order("start_date", { ascending: true, nullsFirst: false }),
      supabase.from("operation_documents").select("id, kind, booking_id, version, token, revoked_at, created_at").eq("operation_id", operationId),
      supabase.from("offer_days").select("id", { count: "exact", head: true }).eq("offer_id", row.offer_id),
      supabase.from("operation_travelers").select("*").eq("operation_id", operationId).order("sort", { ascending: true }),
    ]);
    if (bookingsRes.error || documentsRes.error) return;
    const data = {
      bookings: (bookingsRes.data ?? []) as OperationBooking[],
      documents: (documentsRes.data ?? []) as OperationDocument[],
      hasDays: (daysRes.count ?? 0) > 0,
      // redacted as the case page reads them — the lead traveller's name is all the plan wants
      travelers: ((travelersRes.data ?? []) as TravelerRow[]).map(toTravelerListItem),
      clientToken: row.client_token_revoked_at ? null : row.client_token,
      supplierWork: null,
    };

    const due = dueDocuments(data);
    const by = due.length > 0 ? await getCurrentEmployeeId() : null;
    for (const line of due) {
      // a refusal (a hotel without its English name …) waits for the wizard, which says why
      const res = await issueDocumentNow({ operation_id: operationId, kind: line.kind, booking_id: line.booking_id }, by, true);
      if (res.ok) {
        data.documents.push({ id: res.id, kind: line.kind, booking_id: line.booking_id, version: 0, token: res.token, revoked_at: null, created_at: new Date().toISOString() });
      }
    }

    // the client's one link carries every document — minted with the first one out; a link
    // someone stopped keeps its token (revoked) and is never opened again from here
    if (!row.client_token && data.documents.some((d) => !d.revoked_at && CLIENT_DOCUMENT_KINDS.includes(d.kind))) {
      const token = randomBytes(24).toString("base64url");
      const { data: minted } = await supabase.from("operations").update({ client_token: token }).eq("id", operationId).is("client_token", null).select("id");
      if ((minted ?? []).length > 0) {
        data.clientToken = token;
        await logAudit({ action: "voucher.issued", entity: "operations", entity_id: operationId, meta: { client_link: true, auto: true } });
      }
    }

    // a step finished elsewhere no longer waits on anyone (the passports and the payment: loadWizardCase)
    const stale = staleWaits(readWaits(row.waits), bookingStepStates(data));
    if (stale.length > 0) await writeWaits(supabase, operationId, (waits) => withoutWaits(waits, stale));
  } catch {
    /* best-effort — the action it follows has already succeeded */
  }
}
