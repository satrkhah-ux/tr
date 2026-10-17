import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getPartnerSession } from "@/lib/partners/session";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { normalizeDraftData, type DraftData } from "@/lib/offer/draft-types";

/**
 * `offer_drafts` — every read and write of it, the FULL draft, cost included.
 *
 * A draft carries buy prices and supplier nets inside its jsonb, and a column
 * grant cannot hide part of a json value, so 0047 closed the table to every
 * session. Partners too: a stay a partner priced from a supplier put our net and
 * markup in their own row, one GET away from their token. So the service role
 * here, behind the one rule this file states: offers.write reaches every draft;
 * a partner reaches their own company's and no other (the filter below is what
 * 0035's policy was); anyone else, nothing.
 *
 * Server-side callers only (pricing, supplier rates, the producer). What goes
 * back to a browser passes through drafts.ts, which redacts the cost for anyone
 * without pricing.internal.
 */
type Access = { db: SupabaseClient; partnerId: string | null };

async function access(): Promise<Access | null> {
  let partnerId: string | null = null;
  if (!(await currentCan("offers.write"))) {
    const partner = await getPartnerSession();
    if (!partner) return null;
    partnerId = partner.partner_id;
  }
  return { db: createSupabaseServiceClient() as unknown as SupabaseClient, partnerId };
}

/** `partner_company_id`: the partner company the draft belongs to — its prices are quoted at their terms. */
export type DraftRecord = { id: string; data: DraftData; updated_at: string; partner_company_id: string | null };
export type DraftRow = {
  id: string;
  title: string | null;
  data: Record<string, unknown>;
  updated_at: string;
  created_at: string;
  /** the employee who started the file (null: a partner's, or one made before it was recorded) */
  created_by: string | null;
  maker: { arabic_name: string | null } | null;
};
export type SaveDraftResult = { ok: boolean; error?: TranslationKey };
export type InsertDraftResult = { ok: true; id: string } | { ok: false; error: TranslationKey };

/** The latest 100 drafts this caller may see. */
export async function listDraftRows(): Promise<DraftRow[]> {
  const a = await access();
  if (!a) return [];
  let query = a.db.from("offer_drafts").select("id, title, data, updated_at, created_at, created_by, maker:employees!created_by(arabic_name)");
  if (a.partnerId) query = query.eq("partner_company_id", a.partnerId);
  const { data } = await query.order("updated_at", { ascending: false }).limit(100);
  // the embed is typed as an array; a many-to-one key yields one row or null
  return (data ?? []) as unknown as DraftRow[];
}

/** A new draft. A partner's is stamped with their company — that stamp is what makes it theirs. */
export async function insertDraft(data: DraftData, title?: string | null): Promise<InsertDraftResult> {
  const a = await access();
  if (!a) return { ok: false, error: "err.forbidden" };
  const { data: row, error } = await a.db
    .from("offer_drafts")
    .insert({
      data: data as unknown as Record<string, unknown>,
      ...(title !== undefined ? { title } : {}),
      // who started it — «ملفاتي» on Basic's home (a partner's file is its company's)
      ...(a.partnerId ? { partner_company_id: a.partnerId } : { created_by: await getCurrentEmployeeId() }),
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: "err.createFailed" };
  return { ok: true, id: (row as { id: string }).id };
}

export async function deleteDraftRow(draftId: string): Promise<SaveDraftResult> {
  const a = await access();
  if (!a) return { ok: false, error: "err.forbidden" };
  let query = a.db.from("offer_drafts").delete().eq("id", draftId);
  if (a.partnerId) query = query.eq("partner_company_id", a.partnerId);
  const { error } = await query;
  return error ? { ok: false, error: "err.deleteFailed" } : { ok: true };
}

export async function loadDraft(draftId: string): Promise<DraftRecord | null> {
  try {
    const a = await access();
    if (!a) return null;
    let query = a.db.from("offer_drafts").select("id, data, updated_at, partner_company_id").eq("id", draftId);
    if (a.partnerId) query = query.eq("partner_company_id", a.partnerId);
    const { data } = await query.maybeSingle();
    if (!data) return null;
    const row = data as { id: string; data: Record<string, unknown>; updated_at: string; partner_company_id: string | null };
    return {
      id: row.id,
      data: normalizeDraftData(row.data),
      updated_at: row.updated_at,
      partner_company_id: row.partner_company_id ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Merge slices into the stored draft (shallow, top-level keys). `restore`
 * rewrites the slices against what is stored before the merge — drafts.ts uses
 * it to put back the cost a redacted browser could not send, and a partner's
 * prices a staff browser must not overwrite (`owner`: the draft's partner company).
 */
export async function writeDraftStages(
  draftId: string,
  slices: Partial<DraftData>,
  restore?: (slices: Partial<DraftData>, stored: DraftData, owner: string | null) => Partial<DraftData>,
): Promise<SaveDraftResult> {
  try {
    const a = await access();
    if (!a) return { ok: false, error: "err.forbidden" };
    const record = await loadDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };
    const merged: DraftData = { ...record.data, ...(restore ? restore(slices, record.data, record.partner_company_id) : slices) };
    const title = merged.customer.customer_name || merged.trip.destination || merged.trip.country || null;
    let query = a.db
      .from("offer_drafts")
      .update({ data: merged as unknown as Record<string, unknown>, title, updated_at: new Date().toISOString() })
      .eq("id", draftId);
    if (a.partnerId) query = query.eq("partner_company_id", a.partnerId);
    const { error } = await query;
    if (error) return { ok: false, error: "err.updateFailed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * The signed-in employee's own files not yet issued — «غير مكتملة» on «لوحتي».
 * The employee comes from the session, never from an argument, so no caller can
 * ask for a colleague's. Full rows, cost included: the dashboard loader keeps
 * only the sell total and the steps still missing.
 */
export async function listMyOpenDraftRows(): Promise<Pick<DraftRow, "id" | "title" | "data" | "updated_at">[]> {
  const a = await access();
  if (!a || a.partnerId) return [];
  const me = await getCurrentEmployeeId();
  if (!me) return [];
  const { data } = await a.db
    .from("offer_drafts")
    .select("id, title, data, updated_at")
    .eq("created_by", me)
    .is("data->>produced_serial", null)
    .order("updated_at", { ascending: false });
  return (data ?? []) as Pick<DraftRow, "id" | "title" | "data" | "updated_at">[];
}
