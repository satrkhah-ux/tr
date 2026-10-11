"use server";

import type { TranslationKey } from "@/lib/i18n";
import { normalizeDraftData } from "@/lib/offer/draft-types";
import { createDraft } from "@/lib/data/drafts";
import { listDraftRows } from "@/lib/data/draft-store";
import { getPartnerSession } from "./session";

/**
 * A partner's own files.
 *
 * Every draft is stamped with their company on creation, which is what makes
 * two things true at once: draft-store.ts only ever hands them their own rows,
 * and the document comes out under their name without anyone choosing a brand —
 * `resolveDocBrand` already reads that same column.
 *
 * No query of our own here: a draft holds our cost, so 0047 closed the table to
 * every session, and the ownership rule lives once, in draft-store.ts.
 */

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
    return (await listDraftRows()).map(
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

  // Same creation path as everyone else — createDraft() stamps the company and
  // seeds the approved default wording. A second insert here would be a second
  // definition of what a new file starts with.
  const res = await createDraft();
  return res.ok ? { ok: true, id: res.id } : { ok: false, error: "err.createFailed" };
}
