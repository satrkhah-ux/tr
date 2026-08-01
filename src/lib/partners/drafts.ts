"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emptyDraftData, normalizeDraftData } from "@/lib/offer/draft-types";
import { getPartnerSession } from "./session";

/**
 * A partner's own files.
 *
 * Every draft is stamped with their company on creation, which is what makes
 * two things true at once: the database only ever shows them their own rows
 * (0035), and the document comes out under their name without anyone choosing
 * a brand — `resolveDocBrand` already reads that same column.
 *
 * The USER client throughout, deliberately. A partner's own policies are the
 * check; reaching for the service role here would mean writing the ownership
 * rule a second time in TypeScript, and the two would eventually disagree.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

export type PartnerFile = {
  id: string;
  title: string | null;
  destination: string | null;
  travelers: number;
  nights: number;
  travel_date: string | null;
  serial: string | null;
  updated_at: string;
};

export async function listPartnerFiles(): Promise<PartnerFile[]> {
  const partner = await getPartnerSession();
  if (!partner) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("offer_drafts")
      .select("id, title, data, updated_at")
      .eq("partner_company_id", partner.partner_id)
      .order("updated_at", { ascending: false })
      .limit(100);

    return ((data ?? []) as { id: string; title: string | null; data: Record<string, unknown>; updated_at: string }[]).map(
      (row) => {
        const draft = normalizeDraftData(row.data);
        return {
          id: row.id,
          title: row.title,
          destination: draft.trip.destination || draft.trip.country || null,
          travelers: draft.trip.adults + draft.trip.children + draft.trip.infants,
          nights: draft.trip.nights,
          travel_date: draft.trip.arrival_date || null,
          serial: draft.produced_serial,
          updated_at: row.updated_at,
        };
      },
    );
  } catch {
    return [];
  }
}

export type CreateResult = { ok: true; id: string } | { ok: false; error: TranslationKey };

/**
 * Start a file for this partner.
 *
 * The company is written at creation and not offered as a choice: a partner
 * building under someone else's name is not a feature, and leaving the column
 * null would produce a file the database refuses to show back to them.
 */
export async function createPartnerFile(): Promise<CreateResult> {
  const partner = await getPartnerSession();
  if (!partner) return { ok: false, error: "err.session" };

  try {
    const supabase = await db();
    const base = emptyDraftData();
    // The customer stage's company field, pre-answered — this file belongs to
    // them, so the document's identity is settled before the first screen.
    base.customer = { ...base.customer, company: partner.partner_name };

    const { data, error } = await supabase
      .from("offer_drafts")
      .insert({
        data: base as unknown as Record<string, unknown>,
        title: partner.partner_name,
        partner_company_id: partner.partner_id,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "err.createFailed" };
    return { ok: true, id: (data as { id: string }).id };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
