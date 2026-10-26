"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { gateOperation } from "@/lib/operations/access";
import { composeRequest } from "@/lib/data/supplier-work";
import type { RequestDraft } from "@/lib/data/operation-assign";

/**
 * «أرسل كل الطلبات» (the owner, 2026-10-26): every booking of the case that has
 * its supplier and was never asked, grouped into ONE prepared message per
 * supplier — reviewed by the clerk, then sent through the existing channel
 * (sendBookingRequest), never automatically.
 */

type Fail = { ok: false; error: TranslationKey };
export type AllRequestDraft = { supplierId: string; bookingIds: string[]; draft: RequestDraft };

export async function draftAllRequests(operationId: string): Promise<{ ok: true; drafts: AllRequestDraft[] } | Fail> {
  const denied = await gateOperation(operationId);
  if (denied) return { ok: false, error: denied };
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    // service: 0063's supplier column is not granted to sessions — the gate above is the check
    const { data, error } = await service
      .from("operation_bookings")
      .select("id, assignee_supplier_id, start_date")
      .eq("operation_id", operationId)
      .eq("assignee_kind", "supplier")
      .not("assignee_supplier_id", "is", null)
      .in("status", ["pending", "prebooked", "failed"])
      .or("request_status.is.null,request_status.neq.sent")
      .order("start_date", { ascending: true, nullsFirst: false });
    if (error) return { ok: false, error: "err.loadFailed" };
    const groups = new Map<string, string[]>();
    for (const r of (data ?? []) as { id: string; assignee_supplier_id: string }[]) {
      groups.set(r.assignee_supplier_id, [...(groups.get(r.assignee_supplier_id) ?? []), r.id]);
    }
    const drafts: AllRequestDraft[] = [];
    for (const [supplierId, ids] of groups) {
      const res = await composeRequest(ids[0], ids.slice(1));
      if (res.ok) drafts.push({ supplierId, bookingIds: ids, draft: res.draft });
    }
    return { ok: true, drafts };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
