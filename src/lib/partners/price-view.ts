import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getPartnerSession, partnerTermsById, type PartnerSession } from "./session";
import type { PartnerTerms } from "./pricing";

/**
 * Whose terms a price is quoted at — the one question every partner-facing
 * price asks before it leaves the server (see partnerPrice / partnerSheet).
 *
 * Not a server action ("use server" would expose it): server code only.
 */

function db(): SupabaseClient {
  // the terms are on booking_partners, which a staff caller pricing a partner's
  // file reads too — and the margin below is closed to partners (0054)
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

/** The partner behind this call — never asked of staff who build offers (draft-store's own rule). */
export async function partnerCaller(): Promise<PartnerSession | null> {
  return (await currentCan("offers.write")) ? null : getPartnerSession();
}

/**
 * The terms for this caller: null for staff (our price, untouched), the
 * partner's own otherwise.
 *
 * `draftOwner` — the partner company a draft belongs to. A partner's file is
 * priced at THEIR terms whoever prices it: a staff member filling it in would
 * otherwise write our figures into a draft the partner reads. Throws when that
 * company cannot be read, so the caller fails rather than quoting our price.
 */
export async function viewerTerms(draftOwner?: string | null): Promise<PartnerTerms | null> {
  if (!draftOwner) return (await getPartnerSession())?.terms ?? null;
  // the terms in force — the commission ladder's step this quarter, as the partner's own session sees them
  const terms = await partnerTermsById(draftOwner);
  if (!terms) throw new Error("partner terms unavailable");
  return terms;
}

/** The administration's default package margin (app_settings, 0054) — our sell's basis on a partner's file. */
export async function ourDefaultMarginPct(): Promise<number | null> {
  const { data } = await db().from("app_settings").select("value").eq("key", "profit_default_pct").maybeSingle();
  const pct = Number((data as { value?: string } | null)?.value);
  return Number.isFinite(pct) && pct > 0 ? pct : null;
}
