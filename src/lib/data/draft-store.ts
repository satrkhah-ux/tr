import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getPartnerSession } from "@/lib/partners/session";
import { currentCan } from "@/lib/roles/current";
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

export type DraftRecord = { id: string; data: DraftData; updated_at: string };
export type DraftRow = { id: string; title: string | null; data: Record<string, unknown>; updated_at: string };
export type SaveDraftResult = { ok: boolean; error?: TranslationKey };
export type InsertDraftResult = { ok: true; id: string } | { ok: false; error: TranslationKey };

/** The latest 100 drafts this caller may see. */
export async function listDraftRows(): Promise<DraftRow[]> {
  const a = await access();
  if (!a) return [];
  let query = a.db.from("offer_drafts").select("id, title, data, updated_at");
  if (a.partnerId) query = query.eq("partner_company_id", a.partnerId);
  const { data } = await query.order("updated_at", { ascending: false }).limit(100);
  return (data ?? []) as DraftRow[];
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
      ...(a.partnerId ? { partner_company_id: a.partnerId } : {}),
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
    let query = a.db.from("offer_drafts").select("id, data, updated_at").eq("id", draftId);
    if (a.partnerId) query = query.eq("partner_company_id", a.partnerId);
    const { data } = await query.maybeSingle();
    if (!data) return null;
    const row = data as { id: string; data: Record<string, unknown>; updated_at: string };
    return { id: row.id, data: normalizeDraftData(row.data), updated_at: row.updated_at };
  } catch {
    return null;
  }
}

/**
 * Merge slices into the stored draft (shallow, top-level keys). `restore`
 * rewrites the slices against what is stored before the merge — drafts.ts uses
 * it to put back the cost a redacted browser could not send.
 */
export async function writeDraftStages(
  draftId: string,
  slices: Partial<DraftData>,
  restore?: (slices: Partial<DraftData>, stored: DraftData) => Partial<DraftData>,
): Promise<SaveDraftResult> {
  try {
    const a = await access();
    if (!a) return { ok: false, error: "err.forbidden" };
    const record = await loadDraft(draftId);
    if (!record) return { ok: false, error: "err.loadFailed" };
    const merged: DraftData = { ...record.data, ...(restore ? restore(slices, record.data) : slices) };
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
